import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common"
import { InjectModel } from "@nestjs/mongoose"
import { Model } from "mongoose"
import { Deal, DealDocument, DealStatus } from "./schemas/deal.schema"
import { CreateDealDto } from "./dto/create-deal.dto"
import { UpdateDealDto } from "./dto/update-deal.dto"

@Injectable()
export class DealsService {
  constructor(
    @InjectModel(Deal.name)
    private dealModel: Model<DealDocument>,
  ) { }

  async create(sellerId: string, createDealDto: CreateDealDto): Promise<Deal> {
    const newDeal = new this.dealModel({
      ...createDealDto,
      seller: sellerId,
      status: createDealDto.status || DealStatus.DRAFT,
      timeline: {
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })

    return newDeal.save()
  }

  async findAll(query: any = {}): Promise<Deal[]> {
    return this.dealModel.find(query).exec()
  }

  async findBySeller(sellerId: string): Promise<Deal[]> {
    return this.dealModel.find({ seller: sellerId }).exec()
  }

  async findOne(id: string): Promise<DealDocument> {
    const deal = await this.dealModel.findById(id).exec()
    if (!deal) {
      throw new NotFoundException(`Deal with ID ${id} not found`)
    }
    return deal
  }

  async findPublicDeals(): Promise<Deal[]> {
    return this.dealModel
      .find({
        isPublic: true,
        status: DealStatus.ACTIVE,
      })
      .exec()
  }

  async findDealsForBuyer(buyerId: string): Promise<Deal[]> {
    return this.dealModel
      .find({
        $or: [
          { isPublic: true, status: DealStatus.ACTIVE },
          { targetedBuyers: buyerId, status: DealStatus.ACTIVE },
          { interestedBuyers: buyerId },
        ],
      })
      .exec()
  }

  async update(id: string, sellerId: string, updateDealDto: UpdateDealDto): Promise<Deal> {
    const deal = await this.dealModel.findById(id).exec()

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${id} not found`)
    }

    // Verify that the seller owns this deal
    if (deal.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to update this deal")
    }

    // Check if we're changing status to ACTIVE and update publishedAt timestamp
    if (updateDealDto.status === DealStatus.ACTIVE && deal.status !== DealStatus.ACTIVE) {
      deal.timeline.publishedAt = new Date()
    }

    // Check if we're changing status to COMPLETED and update completedAt timestamp
    if (updateDealDto.status === DealStatus.COMPLETED && deal.status !== DealStatus.COMPLETED) {
      deal.timeline.completedAt = new Date()
    }

    // If finalSalePrice is provided and deal is being completed, add it to financialDetails
    if (updateDealDto.finalSalePrice && updateDealDto.status === DealStatus.COMPLETED) {
      deal.financialDetails.finalSalePrice = updateDealDto.finalSalePrice
      // Remove finalSalePrice from the updateDealDto to avoid duplication
      delete updateDealDto.finalSalePrice
    }

    deal.timeline.updatedAt = new Date()

    Object.assign(deal, updateDealDto)
    return deal.save()
  }

  async updateByAdmin(id: string, updateDealDto: UpdateDealDto): Promise<Deal> {
    const deal = await this.dealModel.findById(id).exec()

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${id} not found`)
    }

    // Logic for status changes and timestamps same as update method
    if (updateDealDto.status === DealStatus.ACTIVE && deal.status !== DealStatus.ACTIVE) {
      deal.timeline.publishedAt = new Date()
    }

    if (updateDealDto.status === DealStatus.COMPLETED && deal.status !== DealStatus.COMPLETED) {
      deal.timeline.completedAt = new Date()
    }

    if (updateDealDto.finalSalePrice && updateDealDto.status === DealStatus.COMPLETED) {
      deal.financialDetails.finalSalePrice = updateDealDto.finalSalePrice
      delete updateDealDto.finalSalePrice
    }

    deal.timeline.updatedAt = new Date()

    Object.assign(deal, updateDealDto)
    return deal.save()
  }

  async remove(id: string, sellerId: string): Promise<void> {
    const deal = await this.dealModel.findById(id).exec()

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${id} not found`)
    }

    // Verify that the seller owns this deal
    if (deal.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to delete this deal")
    }

    await this.dealModel.findByIdAndDelete(id).exec()
  }

  async removeByAdmin(id: string): Promise<void> {
    const result = await this.dealModel.findByIdAndDelete(id).exec()
    if (!result) {
      throw new NotFoundException(`Deal with ID ${id} not found`)
    }
  }

  async addInterestedBuyer(dealId: string, buyerId: string): Promise<Deal> {
    const deal = await this.findOne(dealId)

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${dealId} not found`)
    }

    // Only allow interest in ACTIVE deals
    if (deal.status !== DealStatus.ACTIVE) {
      throw new ForbiddenException("This deal is not currently active")
    }

    // Check if buyer is already marked as interested
    if (!deal.interestedBuyers.includes(buyerId)) {
      deal.interestedBuyers.push(buyerId)
      await deal.save()
    }

    return deal
  }

  async removeInterestedBuyer(dealId: string, buyerId: string): Promise<Deal> {
    const deal = await this.findOne(dealId)

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${dealId} not found`)
    }

    // Remove buyer from interested list
    deal.interestedBuyers = deal.interestedBuyers.filter((id) => id.toString() !== buyerId)

    await deal.save()
    return deal
  }

  async publishDeal(id: string, sellerId: string): Promise<Deal> {
    const deal = await this.dealModel.findById(id).exec()

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${id} not found`)
    }

    // Verify that the seller owns this deal
    if (deal.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to publish this deal")
    }

    // Change status to ACTIVE and set publishedAt timestamp
    deal.status = DealStatus.ACTIVE
    deal.timeline.publishedAt = new Date()
    deal.timeline.updatedAt = new Date()

    return deal.save()
  }

  async completeDeal(id: string, sellerId: string, finalSalePrice: number): Promise<Deal> {
    const deal = await this.dealModel.findById(id).exec()

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${id} not found`)
    }

    // Verify that the seller owns this deal
    if (deal.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to complete this deal")
    }

    // Change status to COMPLETED and set completedAt timestamp
    deal.status = DealStatus.COMPLETED
    deal.timeline.completedAt = new Date()
    deal.timeline.updatedAt = new Date()
    deal.financialDetails.finalSalePrice = finalSalePrice

    return deal.save()
  }

  async findMatchingBuyers(dealId: string): Promise<any[]> {
    const deal = await this.findOne(dealId)

    // Build the query to find matching company profiles based on deal criteria
    const matchQuery: any = {}

    // Match by industry sector if specified
    if (deal.industrySector) {
      matchQuery["targetCriteria.industrySectors"] = { $in: [deal.industrySector] }
    }

    // Match by geography if specified
    if (deal.geographySelection) {
      matchQuery["targetCriteria.countries"] = { $in: [deal.geographySelection] }
    }

    // Match by transaction size if specified in deal
    if (deal.financialDetails?.askingPrice) {
      matchQuery["$or"] = [
        { "targetCriteria.transactionSizeMin": { $lte: deal.financialDetails.askingPrice } },
        { "targetCriteria.transactionSizeMin": { $exists: false } },
      ]

      if (deal.financialDetails.askingPrice) {
        matchQuery["$or"].push(
          { "targetCriteria.transactionSizeMax": { $gte: deal.financialDetails.askingPrice } },
          { "targetCriteria.transactionSizeMax": { $exists: false } },
        )
      }
    }

    // Match by years in business if specified
    if (deal.yearsInBusiness) {
      matchQuery["$or"] = matchQuery["$or"] || []
      matchQuery["$or"].push(
        { "targetCriteria.minYearsInBusiness": { $lte: deal.yearsInBusiness } },
        { "targetCriteria.minYearsInBusiness": { $exists: false } },
      )
    }

    // Match by business model if specified
    if (deal.businessModel) {
      const businessModelKeys = Object.keys(deal.businessModel).filter((key) => deal.businessModel[key] === true)

      if (businessModelKeys.length > 0) {
        matchQuery["$or"] = matchQuery["$or"] || []
        matchQuery["$or"].push(
          { "targetCriteria.preferredBusinessModels": { $in: businessModelKeys } },
          { "targetCriteria.preferredBusinessModels": { $exists: false } },
        )
      }
    }

    // Don't include buyers who have opted out of receiving deals
    matchQuery["preferences.stopSendingDeals"] = { $ne: true }

    // Use the MongoDB aggregation pipeline to find matching company profiles and their buyers
    const companyProfileModel = this.dealModel.db.model("CompanyProfile")
    const matchingProfiles = await companyProfileModel
      .aggregate([
        { $match: matchQuery },
        {
          $lookup: {
            from: "buyers",
            localField: "buyer",
            foreignField: "_id",
            as: "buyerInfo",
          },
        },
        { $unwind: "$buyerInfo" },
        {
          $project: {
            _id: 1,
            companyName: 1,
            buyerId: "$buyer",
            buyerName: "$buyerInfo.fullName",
            buyerEmail: "$buyerInfo.email",
            targetCriteria: 1,
            preferences: 1,
          },
        },
      ])
      .exec()

    return matchingProfiles
  }

  async targetDealToBuyers(dealId: string, buyerIds: string[]): Promise<Deal> {
    const deal = await this.findOne(dealId)

    // Add buyers to the targeted list if they're not already there
    const existingTargets = deal.targetedBuyers.map((id) => id.toString())
    const newTargets = buyerIds.filter((id) => !existingTargets.includes(id))

    if (newTargets.length > 0) {
      deal.targetedBuyers = [...deal.targetedBuyers, ...newTargets]
      deal.timeline.updatedAt = new Date()
      await deal.save()
    }

    return deal
  }

  async updateDealStatus(dealId: string, buyerId: string, status: "pending" | "active" | "rejected"): Promise<any> {
    const deal = await this.findOne(dealId)

    // Create a tracking record for this status change
    const dealTrackingModel = this.dealModel.db.model("DealTracking")

    let interactionType
    switch (status) {
      case "active":
        interactionType = "interest"
        // Add to interested buyers if not already there
        if (!deal.interestedBuyers.includes(buyerId)) {
          deal.interestedBuyers.push(buyerId)
        }
        break
      case "rejected":
        interactionType = "rejected"
        // Remove from interested buyers if present
        deal.interestedBuyers = deal.interestedBuyers.filter((id) => id.toString() !== buyerId)
        break
      case "pending":
        interactionType = "view"
        break
    }

    // Create tracking record
    const tracking = new dealTrackingModel({
      deal: dealId,
      buyer: buyerId,
      interactionType,
      timestamp: new Date(),
      metadata: { status },
    })

    await tracking.save()
    await deal.save()

    return { deal, tracking }
  }

  async getBuyerDeals(buyerId: string, status?: "pending" | "active" | "rejected"): Promise<Deal[]> {
    const query: any = {
      targetedBuyers: buyerId,
    }

    if (status === "active") {
      query.interestedBuyers = buyerId
    } else if (status === "rejected") {
      // For rejected, the buyer was targeted but not interested
      query.interestedBuyers = { $ne: buyerId }
    }

    return this.dealModel.find(query).exec()
  }

  async getDealHistory(sellerId: string): Promise<any[]> {
    // Get all deals by this seller
    const deals = await this.dealModel.find({ seller: sellerId }).exec()

    // Get all deal IDs
    const dealIds = deals.map((deal) => deal._id)

    // Get tracking information for these deals
    const dealTrackingModel = this.dealModel.db.model("DealTracking")
    const trackingData = await dealTrackingModel
      .aggregate([
        { $match: { deal: { $in: dealIds } } },
        {
          $lookup: {
            from: "buyers",
            localField: "buyer",
            foreignField: "_id",
            as: "buyerInfo",
          },
        },
        { $unwind: "$buyerInfo" },
        {
          $lookup: {
            from: "deals",
            localField: "deal",
            foreignField: "_id",
            as: "dealInfo",
          },
        },
        { $unwind: "$dealInfo" },
        {
          $project: {
            dealId: "$deal",
            dealTitle: "$dealInfo.title",
            buyerId: "$buyer",
            buyerName: "$buyerInfo.fullName",
            buyerCompany: "$buyerInfo.companyName",
            interactionType: 1,
            timestamp: 1,
            notes: 1,
          },
        },
        { $sort: { timestamp: -1 } },
      ])
      .exec()

    return trackingData
  }

  async getProfileVisibility(dealId: string, userId: string, userRole: string): Promise<boolean> {
    const deal = await this.findOne(dealId)

    // Admin can see all profiles
    if (userRole === "admin") {
      return true
    }

    // Seller can see buyer profile if the buyer is interested in the deal
    if (userRole === "seller") {
      return deal.seller.toString() === userId && deal.interestedBuyers.some((id) => id.toString() === userId)
    }

    // Buyer can see seller profile if they're interested in the deal
    if (userRole === "buyer") {
      return deal.interestedBuyers.includes(userId)
    }

    return false
  }
}