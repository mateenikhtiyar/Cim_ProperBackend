import { Injectable, Inject, forwardRef, Logger, BadRequestException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { BuyersService } from "../buyers/buyers.service";
import type { GoogleLoginResult } from "./interfaces/google-login-result.interface";
import { AdminService } from "../admin/admin.service";
import { SellersService } from "../sellers/sellers.service";
import { GoogleSellerLoginResult } from "./interfaces/google-seller-login-result.interface";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(forwardRef(() => BuyersService)) private buyersService: BuyersService,
    private jwtService: JwtService,
    @Inject(forwardRef(() => AdminService)) private adminService: AdminService,
    @Inject(forwardRef(() => SellersService)) private sellersService: SellersService,
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
}