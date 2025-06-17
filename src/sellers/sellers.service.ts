import { Injectable, ConflictException, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import * as bcrypt from "bcrypt";
import { Seller, SellerDocument } from "./schemas/seller.schema";
import { GoogleSellerDto, RegisterSellerDto } from "./dto/create-seller.dto";

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    @InjectModel(Seller.name) private sellerModel: Model<SellerDocument>,
  ) { }

  async create(createSellerDto: RegisterSellerDto): Promise<Seller> {
    try {
      const { email, password } = createSellerDto;

      // Check if seller with this email already exists
      const existingSeller = await this.sellerModel.findOne({ email }).exec();
      if (existingSeller) {
        throw new ConflictException("Email already exists");
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create new seller
      const newSeller = new this.sellerModel({
        ...createSellerDto,
        password: hashedPassword,
        role: "seller",
      });

      // Save and return the seller (without password)
      return newSeller.save();
    } catch (error) {
      this.logger.error(`Failed to create seller: ${error.message}`, error.stack);
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new BadRequestException("Failed to create seller account");
    }
  }

  async findByEmail(email: string): Promise<Seller> {
    try {
      const seller = await this.sellerModel.findOne({ email }).exec();
      if (!seller) {
        throw new NotFoundException("Seller not found");
      }
      return seller;
    } catch (error) {
      this.logger.error(`Failed to find seller by email: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findById(id: string): Promise<Seller> {
    try {
      const seller = await this.sellerModel.findById(id).exec();
      if (!seller) {
        throw new NotFoundException("Seller not found");
      }
      return seller;
    } catch (error) {
      this.logger.error(`Failed to find seller by ID: ${error.message}`, error.stack);
      throw new NotFoundException("Seller not found");
    }
  }


  async updateProfilePicture(id: string, profilePicturePath: string): Promise<Seller> {
    try {
      const seller = await this.sellerModel.findById(id).exec();
      if (!seller) {
        throw new NotFoundException("Seller not found");
      }

      seller.profilePicture = profilePicturePath;
      return seller.save();
    } catch (error) {
      this.logger.error(`Failed to update profile picture: ${error.message}`, error.stack);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException("Failed to update profile picture");
    }
  }

  async findAll(): Promise<Seller[]> {
    try {
      return this.sellerModel.find().select('-password').exec();
    } catch (error) {
      this.logger.error(`Failed to find all sellers: ${error.message}`, error.stack);
      throw new BadRequestException("Failed to retrieve sellers");
    }
  }

  async createFromGoogle(profile: any): Promise<{ seller: Seller; isNewUser: boolean }> {
    try {
      const { email, name, picture, sub } = profile;

      // Check if seller already exists
      let seller = await this.sellerModel.findOne({
        $or: [
          { email: email },
          { googleId: sub }
        ]
      }).exec();

      let isNewUser = false;

      if (seller) {
        // Update Google ID if not already set
        if (!seller.googleId) {
          seller.googleId = sub;
          seller.isGoogleAccount = true;

          // Update profile picture if available
          if (picture && !seller.profilePicture) {
            seller.profilePicture = picture;
          }

          seller = await seller.save();
        }
      } else {
        // Create new seller from Google data
        isNewUser = true;
        const newSeller = new this.sellerModel({
          email,
          fullName: name,
          companyName: "Set your company name", // Default value, user can update later
          password: await bcrypt.hash(Math.random().toString(36), 10), // Random password
          googleId: sub,
          isGoogleAccount: true,
          role: "seller",
          profilePicture: picture || null,
        });

        seller = await newSeller.save();
      }

      return { seller, isNewUser };
    } catch (error) {
      this.logger.error(`Failed to create seller from Google: ${error.message}`, error.stack);
      throw new BadRequestException("Failed to create seller from Google account");
    }
  }
  async update(id: string, updateSellerDto: any): Promise<Seller> {
    try {
      const seller = await this.sellerModel.findById(id).exec();
      if (!seller) {
        throw new NotFoundException("Seller not found");
      }

      // Create a copy of the update data to avoid modifying the original
      const updateData = { ...updateSellerDto };

      // If password is being updated, hash it
      if (updateData.password && updateData.password.trim()) {
        updateData.password = await bcrypt.hash(updateData.password, 10);
      } else {
        // Remove password field if it's empty, undefined, or null
        delete updateData.password;
      }

      // Update the seller
      Object.assign(seller, updateData);
      return seller.save();
    } catch (error) {
      this.logger.error(`Failed to update seller: ${error.message}`, error.stack);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException("Failed to update seller");
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const result = await this.sellerModel.findByIdAndDelete(id).exec();
      if (!result) {
        throw new NotFoundException("Seller not found");
      }
    } catch (error) {
      this.logger.error(`Failed to remove seller: ${error.message}`, error.stack);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException("Failed to remove seller");
    }
  }
}