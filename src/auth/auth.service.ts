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
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config'
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Seller } from '../sellers/schemas/seller.schema';

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
    private readonly mailService: MailService
  ) { }

  async validateUser(email: string, password: string, userType: "buyer" | "admin" | "seller" = "buyer"): Promise<any> {
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
        const result = user.toObject ? user.toObject() : { ...user };
        delete result.password;
        return result;
      }
      return null;
    } catch (error) {
      this.logger.error(`Validation error: ${error.message}`, error.stack);
      return null;
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
  await this.mailService.sendResetPasswordEmail(user.email, resetUrl)

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
  await this.mailService.sendResetPasswordEmail(buyer.email, resetUrl)
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
  await this.mailService.sendResetPasswordEmail(seller.email, resetUrl)
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

}