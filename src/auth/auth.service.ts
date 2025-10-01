import { Injectable, Inject, forwardRef, Logger,NotFoundException, BadRequestException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import * as crypto from 'crypto'
import { BuyersService } from "../buyers/buyers.service";
import { GoogleLoginResult } from "./interfaces/google-login-result.interface";
import { AdminService } from "../admin/admin.service";
import { SellersService } from "../sellers/sellers.service";
import { GoogleSellerLoginResult } from "./interfaces/google-seller-login-result.interface";
import { Buyer, BuyerDocument } from '../buyers/schemas/buyer.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ILLUSTRATION_ATTACHMENT, MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config'
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Seller } from '../sellers/schemas/seller.schema';
import { v4 as uuidv4 } from 'uuid';
import { EmailVerification, EmailVerificationDocument } from './schemas/email-verification.schema';
import { User, User as UserType } from './interfaces/user.interface'; // create if missing
import { genericEmailTemplate } from '../mail/generic-email.template';


type VerificationEmailContext = 'initial' | 'resend' | 'login-reminder';

interface VerificationEmailCopy {
  subject: string;
  title: string;
  body: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
    @InjectModel(EmailVerification.name)
  private readonly emailVerificationModel: Model<EmailVerificationDocument>,
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
      let user;
  
      if (userType === "admin") {
        user = await this.adminService.findByEmail(email);
      } else if (userType === "seller") {
        user = await this.sellersService.findByEmail(email);
      } else {
        user = await this.buyersService.findByEmail(email);
      }
  
      if (user && (await bcrypt.compare(password, user.password))) {
        // Admin users don't have an isEmailVerified property
        if (userType !== 'admin' && !user.isEmailVerified) {
          this.logger.log(`User ${user.email} attempted login but email not verified. Sending reminder...`);
          
          try {
            await this.sendVerificationEmail(user, { context: 'login-reminder' });
            this.logger.log(`Login reminder verification email sent to ${user.email}`);
          } catch (sendError) {
            this.logger.error(
              `Failed to send login reminder verification email to ${user.email}: ${sendError.message}`,
              sendError.stack,
            );
          }
          
          throw new UnauthorizedException('Please verify your email before logging in. A verification email has been sent to your inbox.');
        }
        const result = user.toObject ? user.toObject() : { ...user };
        delete result.password;
        return result;
      }
      return null;
    } catch (error) {
      this.logger.error(`Validation error: ${error.message}`, error.stack);
      throw error;
    }
  }

  async login(user: any) {
    try {
      const userId = user._id?.toString() || user.id?.toString();
      if (!userId) {
        throw new BadRequestException("User ID is missing");
      }

      const payload = {
        email: user.email,
        sub: userId,
        role: user.role || "buyer"
      };

      return {
        access_token: this.jwtService.sign(payload),
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

      return {
        access_token: this.jwtService.sign(payload),
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
      const sellerId = seller._id?.toString() || seller.id?.toString();
      if (!sellerId) {
        throw new BadRequestException("Seller ID is missing");
      }

      const payload = {
        email: seller.email,
        sub: sellerId,
        role: "seller"
      };

      return {
        access_token: this.jwtService.sign(payload),
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

  async loginSellerWithGoogle(googleUser: any): Promise<GoogleSellerLoginResult> {
    try {
      this.logger.debug(`Processing Google seller login for: ${googleUser.email}`);

      const { seller, isNewUser } = await this.sellersService.createFromGoogle(googleUser);

      const sellerId = (seller as any)._id?.toString() || (seller as any).id?.toString();
      if (!sellerId) {
        this.logger.error("No ID found in seller object:", seller);
        throw new BadRequestException("Failed to get user ID from seller object");
      }

      const payload = {
        email: seller.email,
        sub: sellerId,
        role: "seller",
      };

      const token = this.jwtService.sign(payload);

      return {
        access_token: token,
        isNewUser,
        user: {
          ...(seller.toObject ? seller.toObject() : seller),
          _id: sellerId,
        },
      };
    } catch (error) {
      this.logger.error(`Google seller login error: ${error.message}`, error.stack);
      throw new BadRequestException(`Google login failed: ${error.message}`);
    }
  }

  async loginWithGoogle(googleUser: any): Promise<GoogleLoginResult> {
    try {
      this.logger.debug(`Processing Google buyer login for: ${googleUser.email}`);

      const { buyer, isNewUser } = await this.buyersService.createFromGoogle(googleUser);

      const buyerId = (buyer as any)._id?.toString() || (buyer as any).id?.toString();
      if (!buyerId) {
        this.logger.error("No ID found in buyer object:", buyer);
        throw new BadRequestException("Failed to get user ID from buyer object");
      }

      const payload = {
        email: buyer.email,
        sub: buyerId,
        role: (buyer as any).role || "buyer",
      };

      const token = this.jwtService.sign(payload);

      return {
        access_token: token,
        isNewUser,
        user: {
          ...(buyer.toObject ? buyer.toObject() : buyer),
          _id: buyerId,
        },
      };
    } catch (error) {
      this.logger.error(`Google buyer login error: ${error.message}`, error.stack);
      throw new BadRequestException(`Google login failed: ${error.message}`);
    }
  }

// forget password

async forgotPassword(email: string): Promise<string> {
  // 1. Check if user is a buyer or seller
  const buyer = await this.buyerModel.findOne({ email }).exec()
  const seller = await this.sellerModel.findOne({ email }).exec()

  // 2. If neither exists, throw error
  if (!buyer && !seller) {
    throw new NotFoundException('No account found with this email')
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
  const frontendUrl = this.configService.get<string>('FRONTEND_URL')
  const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`

  // 7. Send email
  await this.mailService.sendResetPasswordEmail(user.email, user.fullName, resetUrl)

  return 'Reset password email sent successfully'
}

  
  

// forget password for buyer

async forgotPasswordBuyer(email: string) {
  const buyer = await this.buyerModel.findOne({ email }).exec()
  if (!buyer) throw new NotFoundException('Buyer with this email does not exist')

  const resetToken = crypto.randomBytes(32).toString('hex')
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex')

  buyer.resetPasswordToken = hashedToken
  buyer.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000)
  await buyer.save()

  const resetUrl = `${this.configService.get('FRONTEND_URL')}/buyer/reset-password?token=${resetToken}&role=buyer`
  await this.mailService.sendResetPasswordEmail(buyer.email, buyer.fullName, resetUrl)
  return 'Reset password email sent successfully'
}

async resetPasswordBuyer(dto: ResetPasswordDto) {
  const { token, newPassword } = dto
  const hashedToken = crypto.createHash('sha256').update(token.trim()).digest('hex')

  const buyer = await this.buyerModel.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  }).exec()

  if (!buyer) throw new BadRequestException('Invalid or expired token')

  const salt = await bcrypt.genSalt()
  buyer.password = await bcrypt.hash(newPassword, salt)
  buyer.resetPasswordToken = ''
  buyer.resetPasswordExpires = new Date(0)
  await buyer.save()

  return 'Password has been updated successfully'
}

// forget password for seller
  
async forgotPasswordSeller(email: string) {
  const seller = await this.sellerModel.findOne({ email }).exec()
  if (!seller) throw new NotFoundException('Seller with this email does not exist')

  const resetToken = crypto.randomBytes(32).toString('hex')
  const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex')

  seller.resetPasswordToken = hashedToken
  seller.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000)
  await seller.save()

  const resetUrl = `${this.configService.get('FRONTEND_URL')}/seller/reset-password?token=${resetToken}&role=seller`
  await this.mailService.sendResetPasswordEmail(seller.email, seller.fullName, resetUrl)
  return 'Reset password email sent successfully'
}

async resetPasswordSeller(dto: ResetPasswordDto) {
  const { token, newPassword } = dto
  const hashedToken = crypto.createHash('sha256').update(token.trim()).digest('hex')

  const seller = await this.sellerModel.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  }).exec()

  if (!seller) throw new BadRequestException('Invalid or expired token')

  const salt = await bcrypt.genSalt()
  seller.password = await bcrypt.hash(newPassword, salt)
  seller.resetPasswordToken = ''
  seller.resetPasswordExpires = new Date(0)
  await seller.save()

  return 'Password has been updated successfully'
}

//Email verification



async sendVerificationEmail(user: User, options: { context?: VerificationEmailContext } = {}) {
  const context = options.context ?? 'initial';
  this.logger.debug(`Preparing to send verification email (context: ${context}) for user: ${user.email}`);

  if (context !== 'initial') {
    const updateResult = await this.emailVerificationModel.updateMany(
      { userId: user._id, isUsed: false },
      { $set: { isUsed: true } },
    ).exec();
    this.logger.debug(`Invalidated ${updateResult.modifiedCount ?? 0} previous verification tokens for user: ${user._id}`);
  }

  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  this.logger.debug(`Generated token: ${token}, expiresAt: ${expiresAt}`);

  await this.emailVerificationModel.create({
    userId: user._id,
    token,
    isUsed: false,
    expiresAt,
  });
  this.logger.debug(`Saved email verification record for user: ${user._id}`);

  const verificationLink = `${process.env.BACKEND_URL}/auth/verify-email?token=${token}`;
  this.logger.debug(`Verification link: ${verificationLink}`);

  const copy = this.buildVerificationEmailContent(context, verificationLink);
  const recipientName = user.fullName || user.email;
  const emailBody = genericEmailTemplate(copy.title, recipientName, copy.body);
  const recipientType = this.resolveRecipientType(user);

  await this.mailService.sendEmailWithLogging(
    user.email,
    recipientType,
    copy.subject,
    emailBody,
    [ILLUSTRATION_ATTACHMENT],
  );
  this.logger.debug(`Triggered verification email (context: ${context}) for ${user.email}`);
}

  private resolveRecipientType(user: User): string {
    if (user?.role === 'seller') {
      return 'seller';
    }

    if (user?.role === 'admin') {
      return 'admin';
    }

    return 'buyer';
  }

  private buildVerificationEmailContent(context: VerificationEmailContext, verificationLink: string): VerificationEmailCopy {
    const buttonMarkup = `
      <table border="0" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
          <tr>
              <td align="center" style="border-radius: 5px; background-color: #3aafa9;">
                  <a href="${verificationLink}" target="_blank" style="font-size: 16px; color: #ffffff; text-decoration: none; padding: 12px 25px; border-radius: 5px; display: inline-block;">Verify Your Email Address</a>
              </td>
          </tr>
      </table>
    `.trim();

    if (context === 'login-reminder') {
      return {
        subject: 'Verify your email to access CIM Amplify',
        title: 'Verify Your Email to Access CIM Amplify',
        body: `
          <p>We noticed you tried to sign in, but your email hasn't been verified yet.</p>
          ${buttonMarkup}
          <p>Once your email is confirmed, you can log back in and start exploring your dashboard.</p>
          <p>If you didn't try to log in, you can ignore this message.</p>
        `.trim(),
      };
    }

    const intro = context === 'resend'
      ? `<p>Here's a fresh link to verify your CIM Amplify account. Please confirm your email by clicking below:</p>`
      : `<p>Thank you for registering with CIM Amplify! To complete your registration and activate your account, please verify your email address by clicking the link below:</p>`;

    return {
      subject: 'CIM Amplify Verification',
      title: 'CIM Amplify Verification',
      body: `
        ${intro}
        ${buttonMarkup}
        <p>This link is valid for 24 hours. If you did not register for an account with CIM Amplify, please disregard this email.</p>
        <p>We look forward to helping you with your deal-making.</p>
      `.trim(),
    };
  }

async verifyEmailToken(token: string): Promise<{ verified: boolean; role: string | null; accessToken?: string; userId?: string; fullName?: string }> {
  this.logger.debug(`Attempting to verify token: ${token}`);
  const emailVerification = await this.emailVerificationModel.findOne({ token }).exec();

  if (!emailVerification) {
    this.logger.debug(`Verification failed: Token not found for ${token}`);
    return { verified: false, role: null };
  }

  this.logger.debug(`Found emailVerification: ${JSON.stringify(emailVerification)}`);

  if (emailVerification.isUsed) {
    this.logger.debug(`Verification failed: Token ${token} already used.`);
    return { verified: false, role: null };
  }

  if (emailVerification.expiresAt < new Date()) {
    this.logger.debug(`Verification failed: Token ${token} expired. Expires at: ${emailVerification.expiresAt}, Current time: ${new Date()}`);
    return { verified: false, role: null };
  }

  // Mark token as used
  emailVerification.isUsed = true;
  await emailVerification.save();
  this.logger.debug(`Token ${token} marked as used.`);

  const userId = emailVerification.userId;
  let user: any;
  let role: string | null = null;

  const buyer = await this.buyerModel.findById(userId).exec();
  if (buyer) {
    buyer.isEmailVerified = true;
    await buyer.save();
    user = buyer;
    role = 'buyer';
    this.logger.debug(`Buyer ${user.email} verified.`);
  }

  const seller = await this.sellerModel.findById(userId).exec();
  if (seller) {
    seller.isEmailVerified = true;
    await seller.save();
    user = seller;
    role = 'seller';
    this.logger.debug(`Seller ${user.email} verified.`);
  }

  if (user && role) {
    const payload = { email: user.email, sub: user._id.toString(), role };
    const accessToken = this.jwtService.sign(payload);
    this.logger.debug(`User ${user.email} successfully verified. Access token generated.`);
    this.logger.debug(`User object before returning: ${JSON.stringify(user)}`);
    return { verified: true, role, accessToken, userId: user._id.toString(), fullName: user.fullName };
  }

  this.logger.debug(`Verification failed: User not found for userId: ${userId}`);
  return { verified: false, role: null };
}

  async resendVerificationEmail(email: string): Promise<string> {
    this.logger.debug(`Attempting to resend verification email for: ${email}`);
    const buyer = await this.buyerModel.findOne({ email }).exec();
    const seller = await this.sellerModel.findOne({ email }).exec();

    if (!buyer && !seller) {
      this.logger.warn(`No account found for email: ${email}`);
      throw new NotFoundException('No account found with this email.');
    }

    const user: any = buyer || seller;
    this.logger.debug(`Found user: ${user.email}, isEmailVerified: ${user.isEmailVerified}`);

    if (user.isEmailVerified) {
      this.logger.warn(`Email ${user.email} is already verified.`);
      throw new BadRequestException('Email is already verified.');
    }

    // Invalidate any existing tokens for this user
    const updateResult = await this.emailVerificationModel.updateMany(
      { userId: user._id, isUsed: false },
      { $set: { isUsed: true } },
    ).exec();
    this.logger.debug(`Invalidated ${updateResult.modifiedCount} old verification tokens for user ${user._id}`);

    // Generate a new token and send email
    await this.sendVerificationEmail(user, { context: 'resend' });
    this.logger.debug(`New verification email triggered for ${user.email}`);

    return 'Verification email resent successfully.';
  }
}
