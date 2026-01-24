import { Injectable, Logger, ConflictException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegisterSellerDto } from './dto/create-seller.dto';
import { UpdateSellerDto } from './dto/update-seller.dto';
import { Seller, SellerDocument } from './schemas/seller.schema';
import * as bcrypt from "bcrypt";
import { AuthService } from '../auth/auth.service';
import { MailService, ILLUSTRATION_ATTACHMENT } from '../mail/mail.service';
import { genericEmailTemplate } from '../mail/generic-email.template';

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);

  constructor(
    @InjectModel(Seller.name) private sellerModel: Model<SellerDocument>,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService,
    private readonly mailService: MailService
  ) {}

  async create(createSellerDto: RegisterSellerDto): Promise<Seller> {
    try {
      const existingSeller = await this.sellerModel.findOne({ email: createSellerDto.email }).exec();
      if (existingSeller) {
        throw new ConflictException('An account with this email already exists. Please try logging in instead.');
      }
      // Hash the password before saving
      const hashedPassword = await bcrypt.hash(createSellerDto.password, 10);
      const createdSeller = new this.sellerModel({
        ...createSellerDto,
        password: hashedPassword,
        role: 'seller',
        isEmailVerified: true, // Auto-verify since we removed email verification
      });
      const savedSeller = await createdSeller.save();
      // Send welcome email instead of verification email
      await this.authService.sendWelcomeEmail(savedSeller, 'seller');

      // Send notification email to canotifications@amp-ven.com
      const website = savedSeller.website || 'Not provided';
      const ownerSubject = `New Advisor ${savedSeller.companyName}`;
      const ownerHtmlBody = genericEmailTemplate(ownerSubject, "John", `
        <p><b>Company Name</b>: ${savedSeller.companyName}</p>
        <p><b>Website</b>: ${website}</p>
        <p><b>Main Contact</b>: ${savedSeller.fullName}</p>
        <p><b>Main Contact Email</b>: ${savedSeller.email}</p>
        <p><b>Main Contact Phone</b>: ${savedSeller.phoneNumber || 'Not provided'}</p>
        <p><b>Title</b>: ${savedSeller.title || 'Not provided'}</p>
      `);

      await this.mailService.sendEmailWithLogging(
        "canotifications@amp-ven.com",
        "admin",
        ownerSubject,
        ownerHtmlBody,
        [ILLUSTRATION_ATTACHMENT],
      );

      return savedSeller;
    } catch (error) {
      this.logger.error(`Error creating seller: ${error.message}`, error.stack);
      throw error;
    }
  }

  async findAll(page: number = 1, limit: number = 10, search: string = '', sortBy: string = '', activeOnly: string = ''): Promise<any> {
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

      // Use aggregation pipeline to include deal counts
      const [sortField, sortDirection] = (sortBy || '').split(':');
      const isDesc = (sortDirection || 'asc').toLowerCase() === 'desc';
      const nameSort = sortField === 'name';
      const activeDealsSort = sortField === 'activeDeals';
      const offMarketDealsSort = sortField === 'offMarketDeals';
      const allDealsSort = sortField === 'allDeals';
      let sortStage: any;
      if (activeDealsSort) {
        sortStage = { $sort: { activeDealsCount: isDesc ? -1 : 1, sortKey: 1 as const, _id: 1 as const } };
      } else if (offMarketDealsSort) {
        sortStage = { $sort: { offMarketDealsCount: isDesc ? -1 : 1, sortKey: 1 as const, _id: 1 as const } };
      } else if (allDealsSort) {
        sortStage = { $sort: { allDealsCount: isDesc ? -1 : 1, sortKey: 1 as const, _id: 1 as const } };
      } else if (nameSort) {
        sortStage = { $sort: { sortKey: isDesc ? -1 : 1, _id: 1 as const } };
      } else {
        sortStage = { $sort: { sortKey: 1 as const, _id: 1 as const } };
      }

      const pipeline: any[] = [
        { $match: searchQuery },
        {
          $lookup: {
            from: "deals",
            localField: "_id",
            foreignField: "seller",
            as: "deals"
          }
        },
        {
          $addFields: {
            activeDealsCount: {
              $size: {
                $filter: {
                  input: "$deals",
                  cond: {
                    $and: [
                      { $ne: ["$$this.status", "completed"] },
                      { $ne: ["$$this.status", "loi"] },
                      {
                        $gt: [
                          {
                            $size: {
                              $filter: {
                                input: { $objectToArray: "$$this.invitationStatus" },
                                as: "inv",
                                cond: { $eq: ["$$inv.v.response", "accepted"] }
                              }
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                }
              }
            },
            offMarketDealsCount: {
              $size: {
                $filter: {
                  input: "$deals",
                  cond: { $eq: ["$$this.status", "completed"] }
                }
              }
            },
            loiDealsCount: {
              $size: {
                $filter: {
                  input: "$deals",
                  cond: { $eq: ["$$this.status", "loi"] }
                }
              }
            },
            allDealsCount: {
              $size: {
                $filter: {
                  input: "$deals",
                  cond: { $ne: ["$$this.status", "completed"] }
                }
              }
            }
          }
        },
        {
          $addFields: {
            sortKey: { $toLower: '$companyName' }
          }
        },
        ...(activeOnly && activeOnly.toLowerCase() === 'true' ? [{ $match: { activeDealsCount: { $gt: 0 } } }] : []),
        sortStage,
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
            createdAt: 1,
            updatedAt: 1,
            activeDealsCount: 1,
            offMarketDealsCount: 1,
            loiDealsCount: 1,
            allDealsCount: 1,
            referralSource: 1,
            isEmailVerified: 1,
            isGoogleAccount: 1,
            managementPreferences: 1
          }
        }
      ];

      const sellers = await this.sellerModel.aggregate(pipeline).exec();
      const totalPipeline: any[] = [
        { $match: searchQuery },
        {
          $lookup: {
            from: "deals",
            localField: "_id",
            foreignField: "seller",
            as: "deals"
          }
        },
        {
          $addFields: {
            activeDealsCount: {
              $size: {
                $filter: {
                  input: "$deals",
                  cond: {
                    $and: [
                      { $ne: ["$$this.status", "completed"] },
                      { $ne: ["$$this.status", "loi"] },
                      {
                        $gt: [
                          {
                            $size: {
                              $filter: {
                                input: { $objectToArray: "$$this.invitationStatus" },
                                as: "inv",
                                cond: { $eq: ["$$inv.v.response", "accepted"] }
                              }
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        ...(activeOnly && activeOnly.toLowerCase() === 'true' ? [{ $match: { activeDealsCount: { $gt: 0 } } }] : []),
        { $count: 'count' }
      ];
      const totalAgg = await this.sellerModel.aggregate(totalPipeline).exec();
      const total = totalAgg.length > 0 ? (totalAgg[0] as any).count : 0;

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

        // Send notification email to canotifications@amp-ven.com for new advisors
        const website = seller.website || 'Not provided';
        const ownerSubject = `New Advisor ${seller.companyName}`;
        const ownerHtmlBody = genericEmailTemplate(ownerSubject, "John", `
          <p><b>Company Name</b>: ${seller.companyName}</p>
          <p><b>Website</b>: ${website}</p>
          <p><b>Main Contact</b>: ${seller.fullName}</p>
          <p><b>Main Contact Email</b>: ${seller.email}</p>
          <p><b>Main Contact Phone</b>: ${seller.phoneNumber || 'Not provided'}</p>
          <p><b>Title</b>: ${seller.title || 'Not provided'}</p>
          <p><b>Registration Method</b>: Google OAuth</p>
        `);

        await this.mailService.sendEmailWithLogging(
          "canotifications@amp-ven.com",
          "admin",
          ownerSubject,
          ownerHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
        );
      }
      return { seller, isNewUser };
    } catch (error) {
      this.logger.error(`Failed to create seller from Google: ${error.message}`, error.stack);
      throw new Error("Failed to create seller from Google account");
    }
  }
}
