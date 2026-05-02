import { Injectable, Inject, forwardRef, Logger,NotFoundException, BadRequestException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import * as crypto from 'crypto'
import { BuyersService } from "../buyers/buyers.service";
import { AdminService } from "../admin/admin.service";
import { SellersService } from "../sellers/sellers.service";
import { Buyer, BuyerDocument } from '../buyers/schemas/buyer.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ILLUSTRATION_ATTACHMENT, MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config'
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Seller } from '../sellers/schemas/seller.schema';
import { v4 as uuidv4 } from 'uuid';
import { User, User as UserType } from './interfaces/user.interface'; // create if missing
import { genericEmailTemplate, emailButton } from '../mail/generic-email.template';
import { RevokedToken, RevokedTokenDocument } from "./schemas/revoked-token.schema";
import { ActivityLog, ActivityLogDocument } from "./schemas/activity-log.schema";
import { TeamMember, TeamMemberDocument } from "../team/schemas/team-member.schema";
import { getFrontendUrl } from "../common/frontend-url";


interface JwtPayloadWithMetadata {
  sub: string;
  email: string;
  role: string;
  type?: "refresh";
  exp?: number;
  jti?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack || error.message;
    }
    return String(error);
  }

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => BuyersService)) private buyersService: BuyersService,
    private jwtService: JwtService,
    @Inject(forwardRef(() => AdminService)) private adminService: AdminService,
    @Inject(forwardRef(() => SellersService)) private sellersService: SellersService,
    @InjectModel(Buyer.name)
    private buyerModel: Model<BuyerDocument>,
    @InjectModel(Seller.name)
    private sellerModel: Model<Seller>,
    @InjectModel(RevokedToken.name)
    private readonly revokedTokenModel: Model<RevokedTokenDocument>,
    @InjectModel(ActivityLog.name)
    private readonly activityLogModel: Model<ActivityLogDocument>,
    @InjectModel(TeamMember.name)
    private readonly teamMemberModel: Model<TeamMemberDocument>,
    private readonly mailService: MailService
  ) { }

  verifyToken(token: string): any {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      this.logger.error('Token verification failed', error.stack);
      throw new UnauthorizedException('Invalid token');
    }
  }

  async validateUser(email: string, password: string, userType: "buyer" | "seller" | "admin" = "buyer"): Promise<any> {
    try {
      const normalizedEmail = this.normalizeEmail(email);
      let user;

      if (userType === "admin") {
        user = await this.adminService.findByEmail(normalizedEmail);
      } else if (userType === "seller") {
        user = await this.sellersService.findByEmail(normalizedEmail);
      } else {
        try {
          user = await this.buyersService.findByEmail(normalizedEmail);
        } catch {
          // findByEmail throws NotFoundException if buyer not found
          // We need to catch this so team member check below can proceed
          user = null;
        }
      }

      if (user && (await bcrypt.compare(password, user.password))) {
        const result = user.toObject ? user.toObject() : { ...user };
        delete result.password;
        return result;
      }

      // If primary user not found, check TeamMember collection (for seller/buyer login)
      if (!user && userType !== "admin") {
        const teamMember = await this.teamMemberModel
          .findOne({ email: normalizedEmail, isActive: true })
          .exec();

        if (teamMember && (await bcrypt.compare(password, teamMember.password))) {
          // Verify the member's ownerType matches the login type
          if (
            (userType === "seller" && teamMember.ownerType === "seller") ||
            (userType === "buyer" && teamMember.ownerType === "buyer")
          ) {
            const result: any = teamMember.toObject ? teamMember.toObject() : { ...teamMember };
            delete result.password;
            result._isTeamMember = true;
            return result;
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Validation error: ${error.message}`, error.stack);
      throw error;
    }
  }

  private generateTokens(payload: { email: string; sub: string; role: string }) {
    const accessJti = uuidv4();
    const refreshJti = uuidv4();

    const accessToken = this.jwtService.sign({ ...payload, jti: accessJti }, {
      expiresIn: '1d', // Access token expires in 1 day
    });

    const refreshToken = this.jwtService.sign(
      { ...payload, type: 'refresh', jti: refreshJti },
      {
        expiresIn: '7d', // Refresh token expires in 7 days
      }
    );

    return { accessToken, refreshToken };
  }

  private async isRevoked(jti?: string): Promise<boolean> {
    if (!jti) {
      return true;
    }
    const revoked = await this.revokedTokenModel.findOne({ jti }).lean().exec();
    return !!revoked;
  }

  private async revokeTokenByPayload(payload: JwtPayloadWithMetadata): Promise<void> {
    if (!payload?.jti || !payload?.exp || !payload?.sub) {
      return;
    }

    const tokenType: "access" | "refresh" = payload.type === "refresh" ? "refresh" : "access";
    await this.revokedTokenModel.updateOne(
      { jti: payload.jti },
      {
        $setOnInsert: {
          jti: payload.jti,
          tokenType,
          userId: payload.sub,
          expiresAt: new Date(payload.exp * 1000),
        },
      },
      { upsert: true },
    ).exec();
  }

  private async logActivity(
    event: string,
    payload: { userId?: string; email?: string; role?: string; metadata?: Record<string, unknown> },
  ): Promise<void> {
    try {
      await this.activityLogModel.create({
        event,
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        metadata: payload.metadata || {},
      });
    } catch (error) {
      this.logger.warn(`Failed to persist activity log for event ${event}: ${this.formatError(error)}`);
    }
  }

  async logout(accessToken?: string, refreshToken?: string): Promise<{ message: string }> {
    const candidates = [accessToken, refreshToken].filter(Boolean) as string[];

    for (const token of candidates) {
      try {
        const payload = this.jwtService.verify<JwtPayloadWithMetadata>(token, { ignoreExpiration: true });
        await this.revokeTokenByPayload(payload);
        await this.logActivity("auth.logout", {
          userId: payload.sub,
          email: payload.email,
          role: payload.role,
          metadata: { tokenType: payload.type === "refresh" ? "refresh" : "access" },
        });
      } catch {
        // Ignore malformed/expired tokens on logout to keep endpoint idempotent.
      }
    }

    return { message: "Logged out successfully." };
  }

  async login(user: any) {
    try {
      // Handle team member login
      if (user._isTeamMember) {
        return this.loginTeamMember(user);
      }

      const userId = user._id?.toString() || user.id?.toString();
      if (!userId) {
        throw new BadRequestException("User ID is missing");
      }

      const payload = {
        email: user.email,
        sub: userId,
        role: user.role || "buyer"
      };

      const { accessToken, refreshToken } = this.generateTokens(payload);
      await this.logActivity("auth.login", {
        userId,
        email: user.email,
        role: user.role || "buyer",
      });

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 86400, // 1 day in seconds
        user: {
          id: userId,
          email: user.email,
          fullName: user.fullName,
          phone: user.phone || null,
          companyProfileId: user.companyProfileId ? user.companyProfileId.toString() : null,
          companyName: user.companyName,
          profilePicture: user.profilePicture,
          role: user.role || "buyer",
        },
      };
    } catch (error) {
      this.logger.error(`Login error: ${error.message}`, error.stack);
      throw new UnauthorizedException("Login failed");
    }
  }

  async refreshToken(refreshToken: string) {
    try {
      const decoded = this.jwtService.verify<JwtPayloadWithMetadata>(refreshToken);

      if (decoded.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }
      if (await this.isRevoked(decoded.jti)) {
        throw new UnauthorizedException('Refresh token has been revoked');
      }

      const payload = {
        email: decoded.email,
        sub: decoded.sub,
        role: decoded.role,
      };

      await this.revokeTokenByPayload(decoded);

      const { accessToken, refreshToken: newRefreshToken } = this.generateTokens(payload);

      await this.logActivity("auth.refresh", {
        userId: decoded.sub,
        email: decoded.email,
        role: decoded.role,
      });

      return {
        access_token: accessToken,
        refresh_token: newRefreshToken,
        expires_in: 86400, // 1 day in seconds
      };
    } catch (error) {
      this.logger.error(`Refresh token error: ${error.message}`, error.stack);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async loginAdmin(admin: any) {
    try {
      const adminId = admin._id?.toString() || admin.id?.toString();
      if (!adminId) {
        throw new BadRequestException("Admin ID is missing");
      }

      const payload = {
        email: admin.email,
        sub: adminId,
        role: "admin"
      };

      const { accessToken, refreshToken } = this.generateTokens(payload);
      await this.logActivity("auth.login", {
        userId: adminId,
        email: admin.email,
        role: "admin",
      });

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 86400, // 1 day in seconds
        user: {
          id: adminId,
          email: admin.email,
          fullName: admin.fullName,
          role: "admin",
        },
      };
    } catch (error) {
      this.logger.error(`Admin login error: ${error.message}`, error.stack);
      throw new UnauthorizedException("Admin login failed");
    }
  }

  async loginSeller(seller: any) {
    try {
      // Handle team member login
      if (seller._isTeamMember) {
        return this.loginTeamMember(seller);
      }

      const sellerId = seller._id?.toString() || seller.id?.toString();
      if (!sellerId) {
        throw new BadRequestException("Seller ID is missing");
      }

      const payload = {
        email: seller.email,
        sub: sellerId,
        role: "seller"
      };

      const { accessToken, refreshToken } = this.generateTokens(payload);
      await this.logActivity("auth.login", {
        userId: sellerId,
        email: seller.email,
        role: "seller",
      });

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 86400, // 1 day in seconds
        user: {
          id: sellerId,
          email: seller.email,
          fullName: seller.fullName,
          companyName: seller.companyName,
          profilePicture: seller.profilePicture,
          role: "seller",
        },
      };
    } catch (error) {
      this.logger.error(`Seller login error: ${error.message}`, error.stack);
      throw new UnauthorizedException("Seller login failed");
    }
  }

  async loginTeamMember(member: any) {
    try {
      const memberId = member._id?.toString() || member.id?.toString();
      if (!memberId) {
        throw new BadRequestException("Team member ID is missing");
      }

      const role = member.ownerType === "seller" ? "seller-member" : "buyer-member";

      const payload = {
        email: member.email,
        sub: memberId,
        role,
        isTeamMember: true,
        ownerId: member.ownerId?.toString(),
        ownerType: member.ownerType,
        permissions: member.permissions || [],
      };

      const { accessToken, refreshToken } = this.generateTokens(payload);
      await this.logActivity("auth.login.team-member", {
        userId: memberId,
        email: member.email,
        role,
        metadata: { ownerId: member.ownerId?.toString(), ownerType: member.ownerType },
      });

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 86400,
        user: {
          id: memberId,
          email: member.email,
          fullName: member.fullName,
          profilePicture: member.profilePicture,
          role,
          isTeamMember: true,
          ownerId: member.ownerId?.toString(),
          ownerType: member.ownerType,
          permissions: member.permissions || [],
          isTemporaryPassword: member.isTemporaryPassword,
        },
      };
    } catch (error) {
      this.logger.error(`Team member login error: ${error.message}`, error.stack);
      throw new UnauthorizedException("Login failed");
    }
  }

// forget password

async forgotPassword(email: string): Promise<string> {
  const normalizedEmail = this.normalizeEmail(email);
  // 1. Check if user is a buyer, seller, or team member
  const buyer = await this.buyerModel.findOne({ email: normalizedEmail }).exec()
  const seller = await this.sellerModel.findOne({ email: normalizedEmail }).exec()
  const teamMember = await this.teamMemberModel.findOne({ email: normalizedEmail, isActive: true }).exec()

  // 2. If none exist, throw error
  if (!buyer && !seller && !teamMember) {
    throw new NotFoundException('No account found with this email')
  }

  // Handle team member password reset
  if (teamMember && !buyer && !seller) {
    const resetToken = crypto.randomBytes(32).toString('hex')
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex')
    teamMember.resetPasswordToken = hashedToken
    teamMember.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000)
    await teamMember.save()

    const frontendUrl = getFrontendUrl()
    const loginPath = teamMember.ownerType === 'seller' ? '/seller/reset-password' : '/buyer/reset-password'
    const resetUrl = `${frontendUrl}${loginPath}?token=${resetToken}&role=${teamMember.ownerType}-member`
    await this.mailService.sendResetPasswordEmail(teamMember.email, teamMember.fullName, resetUrl)
    return 'Reset password email sent successfully'
  }

  // 3. Select the correct user
  const user: any = buyer || seller

  // 4. Generate raw reset token
  const resetToken = crypto.randomBytes(32).toString('hex')

  // 5. Hash and store in DB
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex')
  user.resetPasswordToken = hashedToken
  user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

  await user.save()

  // 6. Build reset URL
  const frontendUrl = getFrontendUrl()
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`

  // 7. Send email
  await this.mailService.sendResetPasswordEmail(user.email, user.fullName, resetUrl)

  return 'Reset password email sent successfully'
}

  
  

// forget password for buyer

async forgotPasswordBuyer(email: string) {
  const normalizedEmail = this.normalizeEmail(email);
  const buyer = await this.buyerModel.findOne({ email: normalizedEmail }).exec()
  if (!buyer) throw new NotFoundException('Buyer with this email does not exist')

  const resetToken = crypto.randomBytes(32).toString('hex')
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex')

  buyer.resetPasswordToken = hashedToken
  buyer.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000)
  await buyer.save()

  const resetUrl = `${getFrontendUrl()}/buyer/reset-password?token=${resetToken}&role=buyer`
  await this.mailService.sendResetPasswordEmail(buyer.email, buyer.fullName, resetUrl)
  return 'Reset password email sent successfully'
}

async resetPasswordBuyer(dto: ResetPasswordDto) {
  const { token, newPassword } = dto
  const hashedToken = crypto.createHash('sha256').update(token.trim()).digest('hex')

  // Atomically claim the token: clear it on the same query that finds it.
  // Two simultaneous requests with the same token can no longer both succeed
  // — the second one gets null back and exits before the password is changed.
  const buyer = await this.buyerModel.findOneAndUpdate(
    {
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    },
    {
      $set: {
        resetPasswordToken: '',
        resetPasswordExpires: new Date(0),
      },
    },
  ).exec()

  if (!buyer) throw new BadRequestException('Invalid or expired token')

  buyer.password = await bcrypt.hash(newPassword, 12)
  await buyer.save()

  return 'Password has been updated successfully'
}

// forget password for seller
  
async forgotPasswordSeller(email: string) {
  const normalizedEmail = this.normalizeEmail(email);
  const seller = await this.sellerModel.findOne({ email: normalizedEmail }).exec()
  if (!seller) throw new NotFoundException('Seller with this email does not exist')

  const resetToken = crypto.randomBytes(32).toString('hex')
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex')

  seller.resetPasswordToken = hashedToken
  seller.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000)
  await seller.save()

  const resetUrl = `${getFrontendUrl()}/seller/reset-password?token=${resetToken}&role=seller`
  await this.mailService.sendResetPasswordEmail(seller.email, seller.fullName, resetUrl)
  return 'Reset password email sent successfully'
}

async resetPasswordSeller(dto: ResetPasswordDto) {
  const { token, newPassword } = dto
  const hashedToken = crypto.createHash('sha256').update(token.trim()).digest('hex')

  // Atomically claim the token (see buyer flow above for rationale).
  const seller = await this.sellerModel.findOneAndUpdate(
    {
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    },
    {
      $set: {
        resetPasswordToken: '',
        resetPasswordExpires: new Date(0),
      },
    },
  ).exec()

  if (!seller) throw new BadRequestException('Invalid or expired token')

  seller.password = await bcrypt.hash(newPassword, 12)
  await seller.save()

  return 'Password has been updated successfully'
}

  async sendWelcomeEmail(user: any, role: 'buyer' | 'seller'): Promise<void> {
    try {
      const firstName = (user.fullName || '').trim().split(/\s+/)[0] || (role === 'seller' ? 'Advisor' : 'Buyer');
      const subject = 'Welcome to CIM Amplify';
      const dashboardLink = role === 'seller'
        ? `${getFrontendUrl()}/seller/dashboard`
        : `${getFrontendUrl()}/buyer/deals`;
      const content = `
        <p>Thanks for signing up. Your account is ready to use.</p>
        ${emailButton('Go to your dashboard', dashboardLink)}
        <p>If you have any questions, just reply to this email.</p>
      `;
      const body = genericEmailTemplate(subject, firstName, content);
      await this.mailService.sendEmailWithLogging(user.email, role, subject, body, [ILLUSTRATION_ATTACHMENT]);
    } catch (error) {
      this.logger.error(`Failed to send welcome email to ${user.email}`, this.formatError(error));
    }
  }

}
