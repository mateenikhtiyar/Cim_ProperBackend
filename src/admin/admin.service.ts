import { Injectable, ConflictException, NotFoundException } from "@nestjs/common"
import { InjectModel } from "@nestjs/mongoose"
import { Model } from "mongoose"
import * as bcrypt from "bcrypt"
import { Admin, type AdminDocument } from "./schemas/admin.schema"
import { CreateAdminDto } from "./dto/create-admin.dto"
import { CompanyProfile, type CompanyProfileDocument } from "../company-profile/schemas/company-profile.schema"
import { Buyer, type BuyerDocument } from "../buyers/schemas/buyer.schema"
import { UpdateCompanyProfileDto } from "../company-profile/dto/update-company-profile.dto"
import { BuyersService } from "../buyers/buyers.service"
import { Seller, SellerDocument } from "../sellers/schemas/seller.schema";
import { CompanyProfileService } from "../company-profile/company-profile.service";
import { SellersService } from "../sellers/sellers.service";
import { forwardRef, Inject } from "@nestjs/common";

interface RequestWithUser extends Request {
  user: {
    userId: string
    email: string
    role: string
  }
}

const escapeRegexInput = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

@Injectable()
export class AdminService {
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  constructor(
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
    @InjectModel(CompanyProfile.name) private companyProfileModel: Model<CompanyProfileDocument>,
    @InjectModel(Buyer.name) private buyerModel: Model<BuyerDocument>,
    @InjectModel(Seller.name) private sellerModel: Model<SellerDocument>,
    @Inject(forwardRef(() => BuyersService)) private readonly buyersService: BuyersService,
    @Inject(forwardRef(() => CompanyProfileService)) private readonly companyProfileService: CompanyProfileService,
    @Inject(forwardRef(() => SellersService)) private readonly sellersService: SellersService,
  ) { }

  async create(createAdminDto: CreateAdminDto): Promise<Admin> {
    const normalizedEmail = this.normalizeEmail(createAdminDto.email)
    const { password } = createAdminDto

    const existingAdmin = await this.adminModel.findOne({ email: normalizedEmail }).exec()
    if (existingAdmin) {
      throw new ConflictException("Email already exists")
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    const newAdmin = new this.adminModel({
      ...createAdminDto,
      email: normalizedEmail,
      password: hashedPassword,
      role: "admin",
    })

    return newAdmin.save()
  }

  async findByEmail(email: string): Promise<Admin> {
    const admin = await this.adminModel.findOne({ email: this.normalizeEmail(email) }).exec()
    if (!admin) {
      throw new NotFoundException("Admin not found")
    }
    return admin
  }

  async findById(id: string): Promise<Admin> {
    const admin = await this.adminModel.findById(id).exec()
    if (!admin) {
      throw new NotFoundException("Admin not found")
    }
    return admin
  }

  async updateProfile(id: string, update: Partial<Admin>): Promise<Admin> {
    const admin = await this.adminModel.findById(id).exec();
    if (!admin) {
      throw new NotFoundException("Admin not found");
    }
    Object.assign(admin, update);
    return admin.save();
  }

  // Company Profile Management
  // Hard-capped at 1000 docs because the admin UI never paginates this list;
  // without a cap the response payload grows unbounded as buyers join. Keeps
  // all fields since the frontend uses many of them; switch to .lean() to
  // skip Mongoose document hydration (~3-5x faster on large result sets).
  async getAllCompanyProfiles(): Promise<CompanyProfile[]> {
    return this.companyProfileModel
      .find()
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean()
      .exec()
  }

  async updateCompanyProfile(id: string, updateCompanyProfileDto: UpdateCompanyProfileDto): Promise<CompanyProfile> {
    const companyProfile = await this.companyProfileModel.findById(id).exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found")
    }

    Object.assign(companyProfile, updateCompanyProfileDto)
    return companyProfile.save()
  }

  async deleteCompanyProfile(id: string): Promise<void> {
    const result = await this.companyProfileModel.findByIdAndDelete(id).exec()
    if (!result) {
      throw new NotFoundException("Company profile not found")
    }
  }

  // Buyer Management
  async getAllBuyers(page: number = 1, limit: number = 10, search: string = '', sortBy: string = '', dealStatus: string = ''): Promise<any> {
    return this.buyersService.findAll(page, limit, search, sortBy, dealStatus)
  }

  private isProfileComplete(profile: any): boolean {
    return !!(
      profile.companyName &&
      profile.companyName !== "Set your company name" &&
      profile.website &&
      profile.companyType &&
      profile.companyType !== "Other" &&
      profile.capitalEntity &&
      profile.dealsCompletedLast5Years !== undefined &&
      profile.averageDealSize !== undefined &&
      profile.targetCriteria?.countries?.length > 0 &&
      profile.targetCriteria?.industrySectors?.length > 0 &&
      profile.targetCriteria?.revenueMin !== undefined &&
      profile.targetCriteria?.revenueMax !== undefined &&
      profile.targetCriteria?.ebitdaMin !== undefined &&
      profile.targetCriteria?.ebitdaMax !== undefined &&
      profile.targetCriteria?.transactionSizeMin !== undefined &&
      profile.targetCriteria?.transactionSizeMax !== undefined &&
      profile.targetCriteria?.minYearsInBusiness !== undefined &&
      profile.targetCriteria?.preferredBusinessModels?.length > 0 &&
      profile.targetCriteria?.description &&
      profile.agreements?.feeAgreementAccepted
    );
  }

  async getBuyersWithIncompleteProfiles(page: number = 1, limit: number = 10, search: string = ''): Promise<any> {
    const skip = (page - 1) * limit;
    const searchRegex = search ? new RegExp(escapeRegexInput(search), 'i') : null;

    const matchStage = searchRegex
      ? {
          $or: [
            { fullName: searchRegex },
            { email: searchRegex },
            { companyName: searchRegex },
            { phone: searchRegex },
          ],
        }
      : {};

    const pipeline: any[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'companyprofiles',
          localField: 'companyProfileId',
          foreignField: '_id',
          as: 'companyProfile',
        },
      },
      {
        $unwind: {
          path: '$companyProfile',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          profileComplete: {
            $and: [
              { $ne: ['$companyProfile', null] },
              { $ne: ['$companyProfile.companyName', null] },
              { $ne: ['$companyProfile.companyName', ''] },
              { $ne: ['$companyProfile.companyName', 'Set your company name'] },
              { $ne: ['$companyProfile.website', null] },
              { $ne: ['$companyProfile.website', ''] },
              { $ne: ['$companyProfile.companyType', null] },
              { $ne: ['$companyProfile.companyType', ''] },
              { $ne: ['$companyProfile.companyType', 'Other'] },
              { $ne: ['$companyProfile.capitalEntity', null] },
              { $ne: ['$companyProfile.capitalEntity', ''] },
              { $ne: ['$companyProfile.dealsCompletedLast5Years', null] },
              { $ne: ['$companyProfile.averageDealSize', null] },
              { $gt: [{ $size: { $ifNull: ['$companyProfile.targetCriteria.countries', []] } }, 0] },
              { $gt: [{ $size: { $ifNull: ['$companyProfile.targetCriteria.industrySectors', []] } }, 0] },
              { $ne: ['$companyProfile.targetCriteria.revenueMin', null] },
              { $ne: ['$companyProfile.targetCriteria.revenueMax', null] },
              { $ne: ['$companyProfile.targetCriteria.ebitdaMin', null] },
              { $ne: ['$companyProfile.targetCriteria.ebitdaMax', null] },
              { $ne: ['$companyProfile.targetCriteria.transactionSizeMin', null] },
              { $ne: ['$companyProfile.targetCriteria.transactionSizeMax', null] },
              { $ne: ['$companyProfile.targetCriteria.minYearsInBusiness', null] },
              { $gt: [{ $size: { $ifNull: ['$companyProfile.targetCriteria.preferredBusinessModels', []] } }, 0] },
              { $ne: ['$companyProfile.targetCriteria.description', null] },
              { $ne: ['$companyProfile.targetCriteria.description', ''] },
              { $eq: ['$companyProfile.agreements.feeAgreementAccepted', true] },
            ],
          },
        },
      },
      {
        $match: {
          profileComplete: false,
        },
      },
      {
        $facet: {
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.buyerModel.aggregate(pipeline).exec();
    const data = (result?.data || []).map((buyer: any) => ({
      ...buyer,
      companyProfile: buyer.companyProfile || null,
    }));
    const total = result?.totalCount?.[0]?.count || 0;

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateBuyer(id: string, updateData: any): Promise<any> {
    const buyer = await this.buyerModel.findById(id).exec()
    if (!buyer) {
      throw new NotFoundException("Buyer not found")
    }

    // Hash password if being updated
    if (updateData.password && updateData.password.trim() !== '') {
      updateData.password = await bcrypt.hash(updateData.password, 12);
    } else {
      delete updateData.password;
    }

    // Update buyer fields
    Object.assign(buyer, updateData)
    await buyer.save()

    // Sync to company profile if exists
    if (buyer.companyProfileId) {
      const companyProfile = await this.companyProfileModel.findById(buyer.companyProfileId).exec();
      if (companyProfile) {
        let profileUpdated = false;

        // Update company-level fields
        if (updateData.companyName) {
          companyProfile.companyName = updateData.companyName;
          profileUpdated = true;
        }
        if (updateData.website) {
          companyProfile.website = updateData.website;
          profileUpdated = true;
        }

        // Update first contact with buyer info
        if (updateData.fullName || updateData.email || updateData.phone) {
          if (!companyProfile.contacts || companyProfile.contacts.length === 0) {
            companyProfile.contacts = [{
              name: updateData.fullName || buyer.fullName || '',
              email: updateData.email || buyer.email || '',
              phone: updateData.phone || buyer.phone || ''
            }];
          } else {
            // Update first contact
            if (updateData.fullName) companyProfile.contacts[0].name = updateData.fullName;
            if (updateData.email) companyProfile.contacts[0].email = updateData.email;
            if (updateData.phone) companyProfile.contacts[0].phone = updateData.phone;
          }
          profileUpdated = true;
        }

        if (profileUpdated) {
          await companyProfile.save();
        }
      }
    }

    return buyer;
  }

  async deleteBuyer(id: string): Promise<void> {
    const result = await this.buyerModel.findByIdAndDelete(id).exec()
    if (!result) {
      throw new NotFoundException("Buyer not found")
    }

    // Also delete associated company profile
    await this.companyProfileModel.deleteMany({ buyer: id }).exec()
  }

  // Seller Management
  async getAllSellers(page: number = 1, limit: number = 10, search: string = '', sortBy: string = '', activeOnly: string = ''): Promise<any> {
    return this.sellersService.findAll(page, limit, search, sortBy, activeOnly)
  }

  async deleteSeller(id: string): Promise<void> {
    const result = await this.sellerModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException("Seller not found");
    }
    // Optionally, delete associated deals or handle them as needed
    // await this.dealModel.deleteMany({ seller: id }).exec();
  }
}
