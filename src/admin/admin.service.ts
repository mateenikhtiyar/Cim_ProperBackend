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

@Injectable()
export class AdminService {
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
    const { email, password } = createAdminDto

    const existingAdmin = await this.adminModel.findOne({ email }).exec()
    if (existingAdmin) {
      throw new ConflictException("Email already exists")
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const newAdmin = new this.adminModel({
      ...createAdminDto,
      password: hashedPassword,
      role: "admin",
    })

    return newAdmin.save()
  }

  async findByEmail(email: string): Promise<Admin> {
    const admin = await this.adminModel.findOne({ email }).exec()
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
  async getAllCompanyProfiles(): Promise<CompanyProfile[]> {
    return this.companyProfileModel.find().exec()
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
      profile.targetCriteria?.revenueGrowth !== undefined &&
      profile.targetCriteria?.minYearsInBusiness !== undefined &&
      profile.targetCriteria?.preferredBusinessModels?.length > 0 &&
      profile.targetCriteria?.description &&
      profile.agreements?.feeAgreementAccepted
    );
  }

  async getBuyersWithIncompleteProfiles(page: number = 1, limit: number = 10, search: string = ''): Promise<any> {
    const skip = (page - 1) * limit;
    
    // Build search query
    const searchQuery = search ? {
      $or: [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ]
    } : {};
    
    // Get buyers with search filter and profiles to check completeness
    const allBuyers = await this.buyerModel.find(searchQuery).populate('companyProfileId').exec();
    
    const incompleteBuyers = allBuyers.filter(buyer => {
      if (!buyer.companyProfileId) return true;
      return !this.isProfileComplete(buyer.companyProfileId);
    });

    // Apply pagination to filtered results
    const paginatedBuyers = incompleteBuyers.slice(skip, skip + limit);

    return {
      data: paginatedBuyers.map((buyer: any) => ({
        ...buyer.toObject(),
        companyProfile: buyer.companyProfileId,
      })),
      total: incompleteBuyers.length,
      page,
      limit,
      totalPages: Math.ceil(incompleteBuyers.length / limit)
    };
  }

  async updateBuyer(id: string, updateData: any): Promise<any> {
    const buyer = await this.buyerModel.findById(id).exec()
    if (!buyer) {
      throw new NotFoundException("Buyer not found")
    }

    // Hash password if being updated
    if (updateData.password && updateData.password.trim() !== '') {
      updateData.password = await bcrypt.hash(updateData.password, 10);
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
