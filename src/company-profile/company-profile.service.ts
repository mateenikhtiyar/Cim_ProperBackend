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
    const agreements = createCompanyProfileDto.agreements || {};
    let agreementsAcceptedAt: Date | undefined = undefined;
    if (
      agreements.termsAndConditionsAccepted === true &&
      agreements.ndaAccepted === true &&
      agreements.feeAgreementAccepted === true
    ) {
      agreementsAcceptedAt = new Date();
    }

    const newCompanyProfile = new this.companyProfileModel({
      ...createCompanyProfileDto,
      buyer: buyerId,
      targetCriteria,
      selectedCurrency: createCompanyProfileDto.selectedCurrency || "USD",
      ...(agreementsAcceptedAt ? { agreementsAcceptedAt } : {}),
    })
  
    const savedProfile = await newCompanyProfile.save()
  
    // ✅ Update buyer document with companyProfileId
    await this.buyerModel.findByIdAndUpdate(buyerId, {
      companyProfileId: savedProfile._id
    })
  
    return savedProfile
  }
  

  async findAll(): Promise<CompanyProfile[]> {
    return this.companyProfileModel.find().exec();
  }

  async findOne(id: string): Promise<any> {
    const companyProfile = await this.companyProfileModel.findById(id).populate('buyer').exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found")
    }

    // Get buyer data from populated field or fetch separately
    const buyer = companyProfile.buyer as any;
    if (buyer && typeof buyer === 'object') {
      const profileObj = companyProfile.toObject ? companyProfile.toObject() : { ...companyProfile };

      // Override company profile fields with buyer's latest data
      if (buyer.companyName) {
        profileObj.companyName = buyer.companyName;
      }
      if (buyer.website) {
        profileObj.website = buyer.website;
      }

      // Update first contact with buyer's info if contacts exist
      if (profileObj.contacts && profileObj.contacts.length > 0) {
        if (buyer.fullName) profileObj.contacts[0].name = buyer.fullName;
        if (buyer.email) profileObj.contacts[0].email = buyer.email;
        if (buyer.phone) profileObj.contacts[0].phone = buyer.phone;
      } else if (buyer.fullName || buyer.email || buyer.phone) {
        // Create contact if none exists
        profileObj.contacts = [{
          name: buyer.fullName || '',
          email: buyer.email || '',
          phone: buyer.phone || ''
        }];
      }

      return profileObj;
    }

    return companyProfile
  }

  async findByBuyerId(buyerId: string): Promise<any> {
    const companyProfile = await this.companyProfileModel.findOne({ buyer: buyerId }).exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found for this buyer")
    }

    // Get buyer data to merge latest info
    const buyer = await this.buyerModel.findById(buyerId).exec();
    if (buyer) {
      const profileObj = companyProfile.toObject ? companyProfile.toObject() : { ...companyProfile };

      // Override company profile fields with buyer's latest data
      if (buyer.companyName) {
        profileObj.companyName = buyer.companyName;
      }
      if (buyer.website) {
        profileObj.website = buyer.website;
      }

      // Update first contact with buyer's info if contacts exist
      if (profileObj.contacts && profileObj.contacts.length > 0) {
        if (buyer.fullName) profileObj.contacts[0].name = buyer.fullName;
        if (buyer.email) profileObj.contacts[0].email = buyer.email;
        if (buyer.phone) profileObj.contacts[0].phone = buyer.phone;
      } else if (buyer.fullName || buyer.email || buyer.phone) {
        // Create contact if none exists
        profileObj.contacts = [{
          name: buyer.fullName || '',
          email: buyer.email || '',
          phone: buyer.phone || ''
        }];
      }

      return profileObj;
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

    // Prevent agreementsAcceptedAt from being overwritten
    if ('agreementsAcceptedAt' in updateCompanyProfileDto) {
      delete (updateCompanyProfileDto as any).agreementsAcceptedAt;
    }

    // Update the profile
    Object.assign(companyProfile, updateCompanyProfileDto);
    await companyProfile.save();

    // Sync to buyer if company-level fields are updated
    const buyer = await this.buyerModel.findById(buyerId).exec();
    if (buyer) {
      let buyerUpdated = false;

      // Sync company name and website to buyer
      if (updateCompanyProfileDto.companyName) {
        buyer.companyName = updateCompanyProfileDto.companyName;
        buyerUpdated = true;
      }
      if (updateCompanyProfileDto.website) {
        buyer.website = updateCompanyProfileDto.website;
        buyerUpdated = true;
      }

      // Sync first contact info to buyer
      const contacts = (updateCompanyProfileDto as any).contacts;
      if (contacts && contacts.length > 0) {
        const firstContact = contacts[0];
        if (firstContact.name) {
          buyer.fullName = firstContact.name;
          buyerUpdated = true;
        }
        if (firstContact.email) {
          buyer.email = firstContact.email;
          buyerUpdated = true;
        }
        if (firstContact.phone) {
          buyer.phone = firstContact.phone;
          buyerUpdated = true;
        }
      }

      if (buyerUpdated) {
        await buyer.save();
      }
    }

    return companyProfile;
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