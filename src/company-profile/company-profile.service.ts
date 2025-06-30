import { Injectable, NotFoundException, ForbiddenException, Inject } from "@nestjs/common"
import { Model } from "mongoose"
import { InjectModel } from "@nestjs/mongoose"
import { CompanyProfile, CompanyProfileDocument } from "./schemas/company-profile.schema"
import { CreateCompanyProfileDto } from "./dto/create-company-profile.dto"
import { UpdateCompanyProfileDto } from "./dto/update-company-profile.dto"
import { Buyer, BuyerDocument } from "../buyers/schemas/buyer.schema" // adjust path if needed


@Injectable()
export class CompanyProfileService {
  constructor(
    @InjectModel(CompanyProfile.name)
    private companyProfileModel: Model<CompanyProfileDocument>,

    @InjectModel(Buyer.name)
    private buyerModel: Model<BuyerDocument>
  ) { }

  async create(buyerId: string, createCompanyProfileDto: CreateCompanyProfileDto): Promise<CompanyProfile> {
    // Check if the buyer already has a company profile
    const existingProfile = await this.companyProfileModel.findOne({ buyer: buyerId }).exec()
    if (existingProfile) {
      throw new ForbiddenException("Buyer already has a company profile")
    }
  
    // Initialize target criteria arrays if undefined
    const targetCriteria = createCompanyProfileDto.targetCriteria || {}
    if (!targetCriteria.countries) targetCriteria.countries = []
    if (!targetCriteria.industrySectors) targetCriteria.industrySectors = []
    if (!targetCriteria.preferredBusinessModels) targetCriteria.preferredBusinessModels = []
  
    // Create new profile
    const newCompanyProfile = new this.companyProfileModel({
      ...createCompanyProfileDto,
      buyer: buyerId,
      targetCriteria,
      selectedCurrency: createCompanyProfileDto.selectedCurrency || "USD",
    })
  
    const savedProfile = await newCompanyProfile.save()
  
    // ✅ Update buyer document with companyProfileId
    await this.buyerModel.findByIdAndUpdate(buyerId, {
      companyProfileId: savedProfile._id
    })
  
    return savedProfile
  }
  

  async findOne(id: string): Promise<CompanyProfile> {
    const companyProfile = await this.companyProfileModel.findById(id).exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found")
    }
    return companyProfile
  }

  async findByBuyerId(buyerId: string): Promise<CompanyProfile> {
    const companyProfile = await this.companyProfileModel.findOne({ buyer: buyerId }).exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found for this buyer")
    }
    return companyProfile
  }

  async update(id: string, buyerId: string, updateCompanyProfileDto: UpdateCompanyProfileDto): Promise<CompanyProfile> {
    // Find profile and verify ownership
    const companyProfile = await this.companyProfileModel.findById(id).exec();
    if (!companyProfile) {
      throw new NotFoundException('Company profile not found');
    }

    if (companyProfile.buyer.toString() !== buyerId) {
      throw new ForbiddenException('You do not have permission to update this profile');
    }

    // Update the profile
    Object.assign(companyProfile, updateCompanyProfileDto);
    return companyProfile.save();
  }

  async remove(id: string, buyerId: string): Promise<void> {
    // Find profile and verify ownership
    const companyProfile = await this.companyProfileModel.findById(id).exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found")
    }

    if (companyProfile.buyer.toString() !== buyerId) {
      throw new ForbiddenException("You do not have permission to delete this profile")
    }

    await this.companyProfileModel.findByIdAndDelete(id).exec()
  }

  async updateAgreements(
    buyerId: string,
    agreements: {
      termsAndConditionsAccepted?: boolean
      ndaAccepted?: boolean
      feeAgreementAccepted?: boolean
    },
  ): Promise<CompanyProfile> {
    const companyProfile = await this.companyProfileModel.findOne({ buyer: buyerId }).exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found for this buyer")
    }

    // Update only the specified agreements
    if (agreements.termsAndConditionsAccepted !== undefined) {
      companyProfile.agreements.termsAndConditionsAccepted = agreements.termsAndConditionsAccepted
    }
    if (agreements.ndaAccepted !== undefined) {
      companyProfile.agreements.ndaAccepted = agreements.ndaAccepted
    }
    if (agreements.feeAgreementAccepted !== undefined) {
      companyProfile.agreements.feeAgreementAccepted = agreements.feeAgreementAccepted
    }

    return companyProfile.save()
  }

 async updatePreferences(
    buyerId: string,
    preferences: {
      stopSendingDeals?: boolean
      doNotSendMarketedDeals?: boolean
      allowBuyerLikeDeals?: boolean
    },
  ): Promise<CompanyProfile> {
    const companyProfile = await this.companyProfileModel.findOne({ buyer: buyerId }).exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found for this buyer")
    }

    // Update only the specified preferences
    if (preferences.stopSendingDeals !== undefined) {
      companyProfile.preferences.stopSendingDeals = preferences.stopSendingDeals
    }
    if (preferences.doNotSendMarketedDeals !== undefined) {
      companyProfile.preferences.doNotSendMarketedDeals = preferences.doNotSendMarketedDeals
    }
    if (preferences.allowBuyerLikeDeals !== undefined) {
      companyProfile.preferences.allowBuyerLikeDeals = preferences.allowBuyerLikeDeals
    }

    return companyProfile.save()
  }

  async updateTargetCriteria(buyerId: string, targetCriteria: any): Promise<CompanyProfile> {
    const companyProfile = await this.companyProfileModel.findOne({ buyer: buyerId }).exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found for this buyer")
    }

    // Merge the existing target criteria with the new values
    companyProfile.targetCriteria = {
      ...companyProfile.targetCriteria,
      ...targetCriteria,
    }

    return companyProfile.save()
  }
}