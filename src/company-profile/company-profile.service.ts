import { Injectable, NotFoundException, ForbiddenException, Inject } from "@nestjs/common"
import { Model } from "mongoose"
import { InjectModel } from "@nestjs/mongoose"
import { CompanyProfile, CompanyProfileDocument } from "./schemas/company-profile.schema"
import { CreateCompanyProfileDto } from "./dto/create-company-profile.dto"
import { UpdateCompanyProfileDto } from "./dto/update-company-profile.dto"

@Injectable()
export class CompanyProfileService {
  constructor(
    @InjectModel(CompanyProfile.name)
    private companyProfileModel: Model<CompanyProfileDocument>
  ) { }

  async create(buyerId: string, createCompanyProfileDto: CreateCompanyProfileDto): Promise<CompanyProfile> {
    // Check if the buyer already has a company profile
    const existingProfile = await this.companyProfileModel.findOne({ buyer: buyerId }).exec()
    if (existingProfile) {
      throw new ForbiddenException("Buyer already has a company profile")
    }

    // Ensure the targetCriteria fields are properly initialized
    const targetCriteria = createCompanyProfileDto.targetCriteria || {}
    if (!targetCriteria.countries) targetCriteria.countries = []
    if (!targetCriteria.industrySectors) targetCriteria.industrySectors = []
    if (!targetCriteria.preferredBusinessModels) targetCriteria.preferredBusinessModels = []
    if (!targetCriteria.managementTeamPreference) targetCriteria.managementTeamPreference = []

    // Create new profile with properly initialized fields
    const newCompanyProfile = new this.companyProfileModel({
      ...createCompanyProfileDto,
      buyer: buyerId,
      targetCriteria,
      selectedCurrency: createCompanyProfileDto.selectedCurrency || "USD",
    })

    return newCompanyProfile.save()
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
    const companyProfile = await this.companyProfileModel.findById(id).exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found")
    }

    if (companyProfile.buyer.toString() !== buyerId) {
      throw new ForbiddenException("You do not have permission to update this profile")
    }

    // Handle nested updates properly
    if (updateCompanyProfileDto.targetCriteria) {
      // Ensure arrays are properly handled
      if (updateCompanyProfileDto.targetCriteria.countries) {
        companyProfile.targetCriteria.countries = updateCompanyProfileDto.targetCriteria.countries
      }
      if (updateCompanyProfileDto.targetCriteria.industrySectors) {
        companyProfile.targetCriteria.industrySectors = updateCompanyProfileDto.targetCriteria.industrySectors
      }
      if (updateCompanyProfileDto.targetCriteria.preferredBusinessModels) {
        companyProfile.targetCriteria.preferredBusinessModels =
          updateCompanyProfileDto.targetCriteria.preferredBusinessModels
      }
      if (updateCompanyProfileDto.targetCriteria.managementTeamPreference) {
        companyProfile.targetCriteria.managementTeamPreference =
          updateCompanyProfileDto.targetCriteria.managementTeamPreference
      }

      // Handle other fields
      if (updateCompanyProfileDto.targetCriteria.revenueMin !== undefined) {
        companyProfile.targetCriteria.revenueMin = updateCompanyProfileDto.targetCriteria.revenueMin
      }
      if (updateCompanyProfileDto.targetCriteria.revenueMax !== undefined) {
        companyProfile.targetCriteria.revenueMax = updateCompanyProfileDto.targetCriteria.revenueMax
      }
      if (updateCompanyProfileDto.targetCriteria.ebitdaMin !== undefined) {
        companyProfile.targetCriteria.ebitdaMin = updateCompanyProfileDto.targetCriteria.ebitdaMin
      }
      if (updateCompanyProfileDto.targetCriteria.ebitdaMax !== undefined) {
        companyProfile.targetCriteria.ebitdaMax = updateCompanyProfileDto.targetCriteria.ebitdaMax
      }
      if (updateCompanyProfileDto.targetCriteria.transactionSizeMin !== undefined) {
        companyProfile.targetCriteria.transactionSizeMin = updateCompanyProfileDto.targetCriteria.transactionSizeMin
      }
      if (updateCompanyProfileDto.targetCriteria.transactionSizeMax !== undefined) {
        companyProfile.targetCriteria.transactionSizeMax = updateCompanyProfileDto.targetCriteria.transactionSizeMax
      }
      if (updateCompanyProfileDto.targetCriteria.revenueGrowth !== undefined) {
        companyProfile.targetCriteria.revenueGrowth = updateCompanyProfileDto.targetCriteria.revenueGrowth
      }
      if (updateCompanyProfileDto.targetCriteria.minStakePercent !== undefined) {
        companyProfile.targetCriteria.minStakePercent = updateCompanyProfileDto.targetCriteria.minStakePercent
      }
      if (updateCompanyProfileDto.targetCriteria.minYearsInBusiness !== undefined) {
        companyProfile.targetCriteria.minYearsInBusiness = updateCompanyProfileDto.targetCriteria.minYearsInBusiness
      }
      if (updateCompanyProfileDto.targetCriteria.description !== undefined) {
        companyProfile.targetCriteria.description = updateCompanyProfileDto.targetCriteria.description
      }
    }

    // Handle other top-level fields
    if (updateCompanyProfileDto.companyName) {
      companyProfile.companyName = updateCompanyProfileDto.companyName
    }
    if (updateCompanyProfileDto.website) {
      companyProfile.website = updateCompanyProfileDto.website
    }
    if (updateCompanyProfileDto.companyType) {
      companyProfile.companyType = updateCompanyProfileDto.companyType
    }
    if (updateCompanyProfileDto.capitalEntity) {
      companyProfile.capitalEntity = updateCompanyProfileDto.capitalEntity
    }
    if (updateCompanyProfileDto.contacts) {
      companyProfile.contacts = updateCompanyProfileDto.contacts
    }
    if (updateCompanyProfileDto.dealsCompletedLast5Years !== undefined) {
      companyProfile.dealsCompletedLast5Years = updateCompanyProfileDto.dealsCompletedLast5Years
    }
    if (updateCompanyProfileDto.averageDealSize !== undefined) {
      companyProfile.averageDealSize = updateCompanyProfileDto.averageDealSize
    }
    if (updateCompanyProfileDto.selectedCurrency) {
      companyProfile.selectedCurrency = updateCompanyProfileDto.selectedCurrency
    }

    // Handle preferences
    if (updateCompanyProfileDto.preferences) {
      Object.assign(companyProfile.preferences, updateCompanyProfileDto.preferences)
    }

    // Handle agreements
    if (updateCompanyProfileDto.agreements) {
      Object.assign(companyProfile.agreements, updateCompanyProfileDto.agreements)
    }

    return companyProfile.save()
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
      dontShowMyDeals?: boolean
      dontSendDealsToMyCompetitors?: boolean
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
    if (preferences.dontShowMyDeals !== undefined) {
      companyProfile.preferences.dontShowMyDeals = preferences.dontShowMyDeals
    }
    if (preferences.dontSendDealsToMyCompetitors !== undefined) {
      companyProfile.preferences.dontSendDealsToMyCompetitors = preferences.dontSendDealsToMyCompetitors
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