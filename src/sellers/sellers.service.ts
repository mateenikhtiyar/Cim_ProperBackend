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
import { getAdminNotificationEmail } from '../common/admin-notification-email';
import { cached, cacheInvalidate } from '../common/memory-cache';

const escapeRegexInput = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

@Injectable()
export class SellersService {
  private readonly logger = new Logger(SellersService.name);
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  constructor(
    @InjectModel(Seller.name) private sellerModel: Model<SellerDocument>,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService,
    private readonly mailService: MailService
  ) {}

  async create(createSellerDto: RegisterSellerDto): Promise<Seller> {
    try {
      const normalizedEmail = this.normalizeEmail(createSellerDto.email);
      const existingSeller = await this.sellerModel.findOne({ email: normalizedEmail }).exec();
      if (existingSeller) {
        throw new ConflictException('An account with this email already exists. Please try logging in instead.');
      }
      // Hash the password before saving
      const hashedPassword = await bcrypt.hash(createSellerDto.password, 12);
      const createdSeller = new this.sellerModel({
        ...createSellerDto,
        email: normalizedEmail,
        password: hashedPassword,
        role: 'seller',
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
        getAdminNotificationEmail(),
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
    if (!search) {
      // 15s cache — below user perception, eliminates repeat DB hits from admin tables
      // refreshing, pagination, and React Query refetches. No invalidation needed.
      const key = `sellers:list:${page}:${limit}:${sortBy}:${activeOnly}`;
      return cached(key, 15_000, () => this.findAllUncached(page, limit, search, sortBy, activeOnly));
    }
    return this.findAllUncached(page, limit, search, sortBy, activeOnly);
  }

  private async findAllUncached(page: number = 1, limit: number = 10, search: string = '', sortBy: string = '', activeOnly: string = ''): Promise<any> {
    try {
      const skip = (page - 1) * limit;
      
      // Build search query
      const safeSearch = search ? escapeRegexInput(search) : '';
      const searchQuery = safeSearch ? {
        $or: [
          { fullName: { $regex: safeSearch, $options: 'i' } },
          { email: { $regex: safeSearch, $options: 'i' } },
          { companyName: { $regex: safeSearch, $options: 'i' } },
          { phoneNumber: { $regex: safeSearch, $options: 'i' } }
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

      const basePipeline: any[] = [
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
      ];

      const [result] = await this.sellerModel.aggregate([
        ...basePipeline,
        {
          $facet: {
            data: [
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
                  managementPreferences: 1
                }
              }
            ],
            totalCount: [{ $count: 'count' }]
          }
        }
      ]).exec();

      const sellers = result?.data || [];
      const total = result?.totalCount?.[0]?.count || 0;

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
      return await this.sellerModel.findOne({ email: this.normalizeEmail(email) }).exec();
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


  async getPublicSellersByIds(sellerIds: string[]): Promise<Array<{
    id: string;
    fullName: string;
    companyName: string;
    profilePicture: string | null;
    email: string;
    phoneNumber: string;
    role: string;
    website: string;
  }>> {
    const uniqueIds = Array.from(new Set(sellerIds.filter(Boolean)));
    if (uniqueIds.length === 0) {
      return [];
    }

    const sellers = await this.sellerModel
      .find({ _id: { $in: uniqueIds } })
      .select("fullName companyName profilePicture email phoneNumber role website")
      .lean()
      .exec();

    return sellers.map((seller: any) => ({
      id: seller._id?.toString?.() || String(seller._id),
      fullName: seller.fullName || "N/A",
      companyName: seller.companyName || "N/A",
      profilePicture: seller.profilePicture || null,
      email: seller.email || "N/A",
      phoneNumber: seller.phoneNumber || "N/A",
      role: seller.role || "seller",
      website: seller.website || "N/A",
    }));
  }
}

