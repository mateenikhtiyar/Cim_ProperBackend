import { Injectable, Logger, ConflictException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegisterSellerDto } from './dto/create-seller.dto';
import { UpdateSellerDto } from './dto/update-seller.dto';
import { Seller, SellerDocument } from './schemas/seller.schema';
import * as bcrypt from "bcrypt";
import { AuthService } from '../auth/auth.service';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    @InjectModel(Seller.name) private sellerModel: Model<SellerDocument>,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService
  ) {}

  async create(createSellerDto: RegisterSellerDto): Promise<Seller> {
    try {
      const existingSeller = await this.sellerModel.findOne({ email: createSellerDto.email }).exec();
      if (existingSeller) {
        throw new ConflictException('Email already exists');
      }
      // Hash the password before saving
      const hashedPassword = await bcrypt.hash(createSellerDto.password, 10);
      const createdSeller = new this.sellerModel({
        ...createSellerDto,
        password: hashedPassword,
        role: 'seller',
      });
      const savedSeller = await createdSeller.save();
      await this.authService.sendVerificationEmail(savedSeller);
      return savedSeller;
    } catch (error) {
      this.logger.error(`Error creating seller: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findAll(page: number = 1, limit: number = 10, search: string = '', sortBy: string = ''): Promise<any> {
    try {
      const skip = (page - 1) * limit;
      
      // Build search query
      const searchQuery = search ? {
        $or: [
          { fullName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { companyName: { $regex: search, $options: 'i' } },
          { phoneNumber: { $regex: search, $options: 'i' } }
        ]
      } : {};

      // Use aggregation pipeline for consistent results
      const pipeline = [
        { $match: searchQuery },
        {
          $addFields: {
            sortKey: { $toLower: '$companyName' }
          }
        },
        {
          $sort: { sortKey: 1 as const, _id: 1 as const }
        },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            companyName: 1,
            fullName: 1,
            email: 1,
            phoneNumber: 1,
            website: 1,
            title: 1,
            role: 1,
            profilePicture: 1,
            createdAt: 1
          }
        }
      ];

      const sellers = await this.sellerModel.aggregate(pipeline).exec();
      const total = await this.sellerModel.countDocuments(searchQuery).exec();

      return {
        data: sellers,
        total,
        page,
        lastPage: Math.ceil(total / limit),
      };
    } catch (error) {
      this.logger.error(`Error fetching all sellers: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findById(id: string): Promise<Seller> {
    try {
      const seller = await this.sellerModel.findById(id).select('-password').exec();
      if (!seller) {
        throw new NotFoundException(`Seller with ID ${id} not found`);
      }
      return seller;
    } catch (error) {
      this.logger.error(`Error finding seller by ID ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findByEmail(email: string): Promise<Seller | null> {
    try {
      return await this.sellerModel.findOne({ email }).exec();
    } catch (error) {
      this.logger.error(`Error finding seller by email ${email}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async update(id: string, updateSellerDto: UpdateSellerDto): Promise<Seller> {
    try {
      const updatedSeller = await this.sellerModel
        .findByIdAndUpdate(id, { $set: updateSellerDto }, { new: true, runValidators: true })
        .select('-password')
        .exec();
      if (!updatedSeller) {
        throw new NotFoundException(`Seller with ID ${id} not found`);
      }
      return updatedSeller;
    } catch (error) {
      this.logger.error(`Error updating seller with ID ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async updateProfilePicture(id: string, profilePicturePath: string): Promise<Seller> {
    try {
      const updatedSeller = await this.sellerModel
        .findByIdAndUpdate(id, { $set: { profilePicture: profilePicturePath } }, { new: true })
        .select('-password')
        .exec();
      if (!updatedSeller) {
        throw new NotFoundException(`Seller with ID ${id} not found`);
      }
      return updatedSeller;
    } catch (error) {
      this.logger.error(`Error updating profile picture for seller with ID ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const result = await this.sellerModel.findByIdAndDelete(id).exec();
      if (!result) {
        throw new NotFoundException(`Seller with ID ${id} not found`);
      }
    } catch (error) {
      this.logger.error(`Error removing seller with ID ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createFromGoogle(profile: any): Promise<{ seller: Seller; isNewUser: boolean }> {
    try {
      const { email, name, picture, sub } = profile;
      let seller = await this.sellerModel.findOne({
        $or: [
          { email: email },
          { googleId: sub }
        ]
      }).exec();
      let isNewUser = false;
      if (seller) {
        if (!seller.googleId) {
          seller.googleId = sub;
          seller.isGoogleAccount = true;
          if (picture && !seller.profilePicture) {
            seller.profilePicture = picture;
          }
          seller = await seller.save();
        }
      } else {
        isNewUser = true;
        const newSeller = new this.sellerModel({
          email,
          fullName: name,
          companyName: "Set your company name",
          password: Math.random().toString(36), // Set a random password (should be hashed if used)
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
      throw new Error("Failed to create seller from Google account");
    }
  }
}