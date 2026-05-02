import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common"
import { InjectModel } from "@nestjs/mongoose"
import { Model } from "mongoose"
import * as bcrypt from "bcrypt"
import * as crypto from "crypto"
import { ConfigService } from "@nestjs/config"
import { TeamMember, TeamMemberDocument } from "./schemas/team-member.schema"
import { CreateTeamMemberDto, SELLER_PERMISSIONS, BUYER_PERMISSIONS } from "./dto/create-team-member.dto"
import { UpdateTeamMemberDto, UpdateMemberProfileDto, ChangeMemberPasswordDto } from "./dto/update-team-member.dto"
import { Buyer, BuyerDocument } from "../buyers/schemas/buyer.schema"
import { Seller } from "../sellers/schemas/seller.schema"
import { MailService, ILLUSTRATION_ATTACHMENT } from "../mail/mail.service"
import { genericEmailTemplate, emailButton } from "../mail/generic-email.template"
import { getFrontendUrl } from "../common/frontend-url"

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name)

  constructor(
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(Buyer.name)
    private readonly buyerModel: Model<BuyerDocument>,
    @InjectModel(Seller.name)
    private readonly sellerModel: Model<Seller>,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  private generateTemporaryPassword(): string {
    // 16 bytes = 128 bits of entropy, ~22 chars in base64url. The previous
    // 6-byte (48-bit) value was small enough that an offline attacker with
    // the bcrypt hash could brute-force it in hours.
    return crypto.randomBytes(16).toString("base64url")
  }

  private validatePermissions(ownerType: "seller" | "buyer", permissions: string[]): void {
    const validPermissions = ownerType === "seller" ? SELLER_PERMISSIONS : BUYER_PERMISSIONS
    const invalid = permissions.filter(
      (p) => !(validPermissions as readonly string[]).includes(p),
    )
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid permissions for ${ownerType}: ${invalid.join(", ")}. Valid permissions: ${validPermissions.join(", ")}`,
      )
    }
  }

  private async checkEmailUniqueness(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim()

    const [existingMember, existingBuyer, existingSeller] = await Promise.all([
      this.teamMemberModel.findOne({ email: normalizedEmail }).lean().exec(),
      this.buyerModel.findOne({ email: normalizedEmail }).lean().exec(),
      this.sellerModel.findOne({ email: normalizedEmail }).lean().exec(),
    ])

    if (existingMember || existingBuyer || existingSeller) {
      throw new ConflictException("An account with this email already exists")
    }
  }

  private async getOwnerInfo(
    ownerId: string,
    ownerType: "seller" | "buyer",
  ): Promise<{ companyName: string; fullName: string }> {
    if (ownerType === "seller") {
      const seller = await this.sellerModel.findById(ownerId).lean().exec()
      if (!seller) throw new NotFoundException("Seller not found")
      return { companyName: (seller as any).companyName, fullName: (seller as any).fullName }
    } else {
      const buyer = await this.buyerModel.findById(ownerId).lean().exec()
      if (!buyer) throw new NotFoundException("Buyer not found")
      return { companyName: (buyer as any).companyName, fullName: (buyer as any).fullName }
    }
  }

  private async getOwnerContactEmail(
    ownerId: string,
    ownerType: "seller" | "buyer",
  ): Promise<string | null> {
    if (ownerType === "seller") {
      const seller = await this.sellerModel.findById(ownerId).select("email").lean().exec()
      return seller?.email ? String(seller.email).toLowerCase().trim() : null
    }

    const buyer = await this.buyerModel.findById(ownerId).select("email").lean().exec()
    return buyer?.email ? String(buyer.email).toLowerCase().trim() : null
  }

  private async getTeamNotificationRecipients(
    ownerId: string,
    ownerType: "seller" | "buyer",
    excludeEmails: string[] = [],
  ): Promise<string[]> {
    const normalizeEmail = (email: string): string => email.toLowerCase().trim()
    const isNonEmptyString = (value: string | null | undefined): value is string =>
      typeof value === "string" && value.trim().length > 0

    const normalizedExcludes = new Set(
      excludeEmails
        .map((email) => normalizeEmail(email))
        .filter(isNonEmptyString),
    )
    const ownerEmail = await this.getOwnerContactEmail(ownerId, ownerType)

    const teamMembers = await this.teamMemberModel
      .find({ ownerId, ownerType, isActive: true, permissions: "emails" }, { email: 1, permissions: 1 })
      .lean()
      .exec()

    const recipients = [
      ownerEmail,
      ...teamMembers
        .map((member) => (member?.email ? normalizeEmail(String(member.email)) : null))
        .filter(isNonEmptyString),
    ].filter((email): email is string => isNonEmptyString(email) && !normalizedExcludes.has(email))

    return Array.from(new Set(recipients))
  }

  private async sendTeamNotificationEmail(
    recipientEmail: string,
    ownerType: "seller" | "buyer",
    ownerInfo: { companyName: string; fullName: string },
    newMember: TeamMemberDocument,
  ): Promise<void> {
    const frontendUrl = getFrontendUrl()
    const dashboardUrl =
      ownerType === "seller"
        ? `${frontendUrl}/seller/team`
        : `${frontendUrl}/buyer/team`
    const roleLabel = ownerType === "seller" ? "Advisor" : "Buyer"

    const emailContent = `
      <p>A new ${roleLabel.toLowerCase()} team member has been added to <strong>${ownerInfo.companyName}</strong>'s team on CIM Amplify.</p>
      <p><strong>Name:</strong> ${newMember.fullName}</p>
      <p><strong>Email:</strong> ${newMember.email}</p>
      <p>You can review and manage team access from your team page.</p>
      ${emailButton("View Team", dashboardUrl)}
    `.trim()

    const emailBody = genericEmailTemplate(
      "New Team Member Added",
      ownerInfo.fullName,
      emailContent,
    )

    await this.mailService.sendEmailWithLogging(
      recipientEmail,
      ownerType === "seller" ? "seller" : "buyer",
      `New team member added at ${ownerInfo.companyName}`,
      emailBody,
      [ILLUSTRATION_ATTACHMENT],
    )
  }

  // ─── Owner endpoints ─────────────────────────────────

  async createMember(
    dto: CreateTeamMemberDto,
    invitedById: string,
    inviterRole: string,
  ): Promise<TeamMemberDocument> {
    // Determine ownerId: for owners it's their own ID, for admins it must be provided
    let ownerId = dto.ownerId
    let ownerType = dto.ownerType

    if (inviterRole === "seller" || inviterRole === "buyer") {
      ownerId = invitedById
      ownerType = inviterRole as "seller" | "buyer"
    } else if (inviterRole === "admin") {
      if (!ownerId) {
        throw new BadRequestException("ownerId is required when admin creates a team member")
      }
    } else {
      throw new ForbiddenException("Only owners or admins can add team members")
    }

    this.validatePermissions(ownerType, dto.permissions)
    await this.checkEmailUniqueness(dto.email)

    const tempPassword = this.generateTemporaryPassword()
    const hashedPassword = await bcrypt.hash(tempPassword, 12)

    const member = await this.teamMemberModel.create({
      fullName: dto.fullName,
      email: dto.email.toLowerCase().trim(),
      password: hashedPassword,
      profilePicture: dto.profilePicture || null,
      ownerId,
      ownerType,
      role: ownerType === "seller" ? "seller-member" : "buyer-member",
      permissions: dto.permissions,
      isTemporaryPassword: true,
      isActive: true,
      invitedBy: invitedById,
    })

    // Send invitation email
    await this.sendInvitationEmail(member, tempPassword, ownerType)

    this.logger.log(
      `Team member ${member.email} created for ${ownerType} ${ownerId} by ${inviterRole} ${invitedById}`,
    )

    return member
  }

  async getMembers(ownerId: string, ownerType?: "seller" | "buyer"): Promise<TeamMemberDocument[]> {
    const query: any = { ownerId, isActive: true }
    if (ownerType) query.ownerType = ownerType
    return this.teamMemberModel.find(query).select("-password").sort({ createdAt: -1 }).exec()
  }

  async getMemberById(memberId: string, ownerId: string): Promise<TeamMemberDocument> {
    const member = await this.teamMemberModel
      .findOne({ _id: memberId, ownerId })
      .select("-password")
      .exec()
    if (!member) throw new NotFoundException("Team member not found")
    return member
  }

  async updateMember(
    memberId: string,
    ownerId: string,
    dto: UpdateTeamMemberDto,
  ): Promise<TeamMemberDocument> {
    const member = await this.teamMemberModel.findOne({ _id: memberId, ownerId }).exec()
    if (!member) throw new NotFoundException("Team member not found")

    if (dto.permissions) {
      this.validatePermissions(member.ownerType, dto.permissions)
      member.permissions = dto.permissions
    }
    if (dto.fullName !== undefined) member.fullName = dto.fullName
    if (dto.profilePicture !== undefined) member.profilePicture = dto.profilePicture
    if (dto.isActive !== undefined) member.isActive = dto.isActive

    await member.save()
    const result: any = member.toObject()
    delete result.password
    return result
  }

  async deleteMember(memberId: string, ownerId: string): Promise<{ message: string }> {
    const member = await this.teamMemberModel.findOne({ _id: memberId, ownerId }).exec()
    if (!member) throw new NotFoundException("Team member not found")

    await this.teamMemberModel.deleteOne({ _id: memberId }).exec()
    this.logger.log(`Team member ${member.email} deleted by owner ${ownerId}`)
    return { message: "Team member removed successfully" }
  }

  async resetMemberPassword(
    memberId: string,
    ownerId: string,
  ): Promise<{ message: string }> {
    const member = await this.teamMemberModel.findOne({ _id: memberId, ownerId }).exec()
    if (!member) throw new NotFoundException("Team member not found")

    const tempPassword = this.generateTemporaryPassword()
    member.password = await bcrypt.hash(tempPassword, 12)
    member.isTemporaryPassword = true
    await member.save()

    await this.sendInvitationEmail(member, tempPassword, member.ownerType)

    return { message: "Password reset and email sent to team member" }
  }

  // ─── Member self-service ─────────────────────────────

  async getMemberProfile(memberId: string): Promise<TeamMemberDocument> {
    const member = await this.teamMemberModel
      .findById(memberId)
      .select("-password")
      .exec()
    if (!member) throw new NotFoundException("Team member not found")
    return member
  }

  async updateMemberProfile(
    memberId: string,
    dto: UpdateMemberProfileDto,
  ): Promise<TeamMemberDocument> {
    const member = await this.teamMemberModel.findById(memberId).exec()
    if (!member) throw new NotFoundException("Team member not found")

    if (dto.fullName !== undefined) member.fullName = dto.fullName
    if (dto.profilePicture !== undefined) member.profilePicture = dto.profilePicture

    await member.save()
    const result: any = member.toObject()
    delete result.password
    return result
  }

  async changeMemberPassword(
    memberId: string,
    dto: ChangeMemberPasswordDto,
  ): Promise<{ message: string }> {
    const member = await this.teamMemberModel.findById(memberId).exec()
    if (!member) throw new NotFoundException("Team member not found")

    // If not temporary password, verify current password
    if (!member.isTemporaryPassword) {
      if (!dto.currentPassword) {
        throw new BadRequestException("Current password is required")
      }
      const isMatch = await bcrypt.compare(dto.currentPassword, member.password)
      if (!isMatch) {
        throw new BadRequestException("Current password is incorrect")
      }
    }

    member.password = await bcrypt.hash(dto.newPassword, 12)
    member.isTemporaryPassword = false
    await member.save()

    return { message: "Password changed successfully" }
  }

  // ─── Admin endpoints ─────────────────────────────────

  async getAllMembers(page = 1, limit = 50): Promise<{
    members: any[]
    total: number
    page: number
    totalPages: number
  }> {
    const skip = (page - 1) * limit
    const [members, total] = await Promise.all([
      this.teamMemberModel
        .find()
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.teamMemberModel.countDocuments().exec(),
    ])

    // Enrich with owner info
    const enriched = await Promise.all(
      members.map(async (m) => {
        try {
          const ownerInfo = await this.getOwnerInfo(
            m.ownerId.toString(),
            m.ownerType,
          )
          return { ...m, ownerCompanyName: ownerInfo.companyName, ownerFullName: ownerInfo.fullName }
        } catch {
          return { ...m, ownerCompanyName: "Unknown", ownerFullName: "Unknown" }
        }
      }),
    )

    return {
      members: enriched,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    }
  }

  async getMembersByOwner(ownerId: string): Promise<TeamMemberDocument[]> {
    return this.teamMemberModel
      .find({ ownerId })
      .select("-password")
      .sort({ createdAt: -1 })
      .exec()
  }

  async adminUpdateMember(
    memberId: string,
    dto: UpdateTeamMemberDto,
  ): Promise<TeamMemberDocument> {
    const member = await this.teamMemberModel.findById(memberId).exec()
    if (!member) throw new NotFoundException("Team member not found")

    if (dto.permissions) {
      this.validatePermissions(member.ownerType, dto.permissions)
      member.permissions = dto.permissions
    }
    if (dto.fullName !== undefined) member.fullName = dto.fullName
    if (dto.profilePicture !== undefined) member.profilePicture = dto.profilePicture
    if (dto.isActive !== undefined) member.isActive = dto.isActive

    await member.save()
    const result: any = member.toObject()
    delete result.password
    return result
  }

  async adminDeleteMember(memberId: string): Promise<{ message: string }> {
    const member = await this.teamMemberModel.findById(memberId).exec()
    if (!member) throw new NotFoundException("Team member not found")

    await this.teamMemberModel.deleteOne({ _id: memberId }).exec()
    this.logger.log(`Team member ${member.email} deleted by admin`)
    return { message: "Team member removed successfully" }
  }

  async adminCreateMember(
    dto: CreateTeamMemberDto,
    adminId: string,
  ): Promise<TeamMemberDocument> {
    return this.createMember(dto, adminId, "admin")
  }

  // ─── Email ───────────────────────────────────────────

  private async sendInvitationEmail(
    member: TeamMemberDocument,
    tempPassword: string,
    ownerType: "seller" | "buyer",
  ): Promise<void> {
    try {
      const ownerInfo = await this.getOwnerInfo(
        member.ownerId.toString(),
        ownerType,
      )

      const frontendUrl = getFrontendUrl()
      const loginUrl =
        ownerType === "seller"
          ? `${frontendUrl}/seller/login`
          : `${frontendUrl}/buyer/login`

      const roleLabel = ownerType === "seller" ? "Advisor" : "Buyer"

      const emailContent = `
        <p>You have been invited to join <strong>${ownerInfo.companyName}</strong>'s team on CIM Amplify as a ${roleLabel} team member.</p>
        <p><strong>${ownerInfo.fullName}</strong> has granted you access to their ${roleLabel.toLowerCase()} dashboard.</p>

        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 4px solid #3aafa9;">
          <p style="margin: 0 0 8px 0; font-weight: 600; color: #1a1a2e;">Your Login Credentials</p>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 4px 0; color: #6b7280; width: 120px;">Email:</td>
              <td style="padding: 4px 0; font-weight: 600;">${member.email}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Temporary Password:</td>
              <td style="padding: 4px 0; font-weight: 600;">${tempPassword}</td>
            </tr>
          </table>
        </div>

        ${emailButton("Log In to CIM Amplify", loginUrl)}

        <p style="color: #6b7280; font-size: 13px; margin-top: 16px;">
          For your security, please change your password after your first login by visiting your profile page.
        </p>
      `.trim()

      const emailBody = genericEmailTemplate(
        "You're Invited to CIM Amplify",
        member.fullName,
        emailContent,
      )

      await this.mailService.sendEmailWithLogging(
        member.email,
        ownerType === "seller" ? "seller" : "buyer",
        `You've been invited to join ${ownerInfo.companyName} on CIM Amplify`,
        emailBody,
        [ILLUSTRATION_ATTACHMENT],
      )

      this.logger.log(`Invitation email sent to ${member.email}`)

      const sendTeamEmailNotifications = member.permissions.includes("emails")
      if (!sendTeamEmailNotifications) {
        this.logger.log(
          `Email notifications disabled for team member ${member.email}; skipping owner/team notification emails`,
        )
        return
      }

      const notificationRecipients = await this.getTeamNotificationRecipients(
        member.ownerId.toString(),
        ownerType,
        [member.email],
      )

      for (const recipientEmail of notificationRecipients) {
        try {
          await this.sendTeamNotificationEmail(
            recipientEmail,
            ownerType,
            ownerInfo,
            member,
          )
          this.logger.log(`Team notification email sent to ${recipientEmail}`)
        } catch (notificationError) {
          const error = notificationError instanceof Error ? notificationError.message : String(notificationError)
          this.logger.error(`Failed to send team notification email to ${recipientEmail}: ${error}`)
        }
      }
    } catch (error) {
      this.logger.error(`Failed to send invitation email to ${member.email}: ${error.message}`)
    }
  }

  // ─── Utility: used by auth service ───────────────────

  async findByEmail(email: string): Promise<TeamMemberDocument | null> {
    return this.teamMemberModel
      .findOne({ email: email.toLowerCase().trim(), isActive: true })
      .exec()
  }
}
