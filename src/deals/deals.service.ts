import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common"
import { Deal, DealDocumentType as DealDocument, DealStatus } from "./schemas/deal.schema"
import { CreateDealDto } from "./dto/create-deal.dto"
import { UpdateDealDto } from "./dto/update-deal.dto"
import * as fs from "fs"
import { Model } from "mongoose"
import { InjectModel } from "@nestjs/mongoose"

interface DocumentInfo {
  filename: string
  originalName: string
  path: string
  size: number
  mimetype: string
  uploadedAt: Date
}

@Injectable()
export class DealsService {
  constructor(
    @InjectModel(Deal.name) private dealModel: Model<DealDocument>
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

  async addDocuments(dealId: string, documents: DocumentInfo[]): Promise<Deal> {
    const deal = await this.findOne(dealId)

    // Add new documents to existing ones
    if (!deal.documents) {
      deal.documents = []
    }

    deal.documents.push(...documents)
    deal.timeline.updatedAt = new Date()

    return deal.save()
  }

  async removeDocument(dealId: string, documentIndex: number): Promise<Deal> {
    const deal = await this.findOne(dealId)

    if (!deal.documents || documentIndex < 0 || documentIndex >= deal.documents.length) {
      throw new NotFoundException("Document not found")
    }

    // Get the document to remove
    const documentToRemove = deal.documents[documentIndex]

    // Remove the file from filesystem
    try {
      if (fs.existsSync(documentToRemove.path)) {
        fs.unlinkSync(documentToRemove.path)
      }
    } catch (error) {
      console.error("Error removing file:", error)
      // Continue even if file removal fails
    }

    // Remove from array
    deal.documents.splice(documentIndex, 1)
    deal.timeline.updatedAt = new Date()

    return deal.save()
  }

  async update(id: string, sellerId: string, updateDealDto: UpdateDealDto): Promise<Deal> {
    const deal = await this.dealModel.findById(id).exec()

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${id} not found`)
    }

    if (deal.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to update this deal")
    }

    if (updateDealDto.status === DealStatus.ACTIVE && deal.status !== DealStatus.ACTIVE) {
      deal.timeline.publishedAt = new Date()
    }

    if (updateDealDto.status === DealStatus.COMPLETED && deal.status !== DealStatus.COMPLETED) {
      deal.timeline.completedAt = new Date()
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

    if (deal.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to delete this deal")
    }

    // Remove all associated documents from filesystem
    if (deal.documents && deal.documents.length > 0) {
      deal.documents.forEach((doc: any) => {
        try {
          if (fs.existsSync(doc.path)) {
            fs.unlinkSync(doc.path)
          }
        } catch (error) {
          console.error("Error removing document file:", error)
        }
      })
    }

    await this.dealModel.findByIdAndDelete(id).exec()
  }

  async getDealStatistics(sellerId: string): Promise<any> {
    const deals = await this.dealModel.find({ seller: sellerId }).exec()

    const stats = {
      totalDeals: deals.length,
      activeDeals: deals.filter((deal) => deal.status === DealStatus.ACTIVE).length,
      completedDeals: deals.filter((deal) => deal.status === DealStatus.COMPLETED).length,
      draftDeals: deals.filter((deal) => deal.status === DealStatus.DRAFT).length,
      totalInterested: deals.reduce((sum, deal) => sum + deal.interestedBuyers.length, 0),
      totalDocuments: deals.reduce((sum, deal) => sum + (deal.documents?.length || 0), 0),
    }

    return stats
  }

  async getCompletedDeals(sellerId: string): Promise<Deal[]> {
    return this.dealModel
      .find({
        seller: sellerId,
        status: DealStatus.COMPLETED,
      })
      .sort({ "timeline.completedAt": -1 }) // Sort by completion date, newest first
      .exec()
  }

  async findMatchingBuyers(dealId: string): Promise<any[]> {
    const deal = await this.findOne(dealId)

    // Basic filter to exclude buyers who have opted out
    const baseQuery: any = {
      "preferences.stopSendingDeals": { $ne: true },
    }

    const companyProfileModel = this.dealModel.db.model("CompanyProfile")
    const matchingProfiles = await companyProfileModel
      .aggregate([
        { $match: baseQuery },
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
          $addFields: {
            // Calculate match scores for each criterion
            industryMatch: {
              $cond: [
                { $in: [deal.industrySector, { $ifNull: ["$targetCriteria.industrySectors", []] }] },
                10, // Points for industry match
                0,
              ],
            },
            geographyMatch: {
              $cond: [
                { $in: [deal.geographySelection, { $ifNull: ["$targetCriteria.countries", []] }] },
                10, // Points for geography match
                0,
              ],
            },
            revenueMatch: {
              $cond: [
                {
                  $and: [
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$targetCriteria.revenueMin", null] }, null] },
                        {
                          $lte: [
                            { $ifNull: ["$targetCriteria.revenueMin", 0] },
                            { $ifNull: [deal.financialDetails?.trailingRevenueAmount, 0] },
                          ],
                        },
                      ],
                    },
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$targetCriteria.revenueMax", null] }, null] },
                        {
                          $gte: [
                            { $ifNull: ["$targetCriteria.revenueMax", 0] },
                            { $ifNull: [deal.financialDetails?.trailingRevenueAmount, 0] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                8, // Points for revenue match
                0,
              ],
            },
            ebitdaMatch: {
              $cond: [
                {
                  $and: [
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMin", null] }, null] },
                        {
                          $lte: [
                            { $ifNull: ["$targetCriteria.ebitdaMin", 0] },
                            { $ifNull: [deal.financialDetails?.trailingEBITDAAmount, 0] },
                          ],
                        },
                      ],
                    },
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMax", null] }, null] },
                        {
                          $gte: [
                            { $ifNull: ["$targetCriteria.ebitdaMax", 0] },
                            { $ifNull: [deal.financialDetails?.trailingEBITDAAmount, 0] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                8, // Points for EBITDA match
                0,
              ],
            },
            transactionSizeMatch: {
              $cond: [
                {
                  $and: [
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$targetCriteria.transactionSizeMin", null] }, null] },
                        {
                          $lte: [
                            { $ifNull: ["$targetCriteria.transactionSizeMin", 0] },
                            { $ifNull: [deal.financialDetails?.askingPrice, 0] },
                          ],
                        },
                      ],
                    },
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$targetCriteria.transactionSizeMax", null] }, null] },
                        {
                          $gte: [
                            { $ifNull: ["$targetCriteria.transactionSizeMax", 0] },
                            { $ifNull: [deal.financialDetails?.askingPrice, 0] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                8, // Points for transaction size match
                0,
              ],
            },
            businessModelMatch: {
              $sum: [
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: [deal.businessModel?.recurringRevenue, false] }, true] },
                        { $in: ["Recurring Revenue", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] },
                      ],
                    },
                    3, // Points for recurring revenue match
                    0,
                  ],
                },
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: [deal.businessModel?.projectBased, false] }, true] },
                        { $in: ["Project-Based", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] },
                      ],
                    },
                    3, // Points for project-based match
                    0,
                  ],
                },
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: [deal.businessModel?.assetLight, false] }, true] },
                        { $in: ["Asset Light", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] },
                      ],
                    },
                    3, // Points for asset light match
                    0,
                  ],
                },
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: [deal.businessModel?.assetHeavy, false] }, true] },
                        { $in: ["Asset Heavy", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] },
                      ],
                    },
                    3, // Points for asset heavy match
                    0,
                  ],
                },
              ],
            },
            managementMatch: {
              $cond: [
                {
                  $and: [
                    { $eq: [{ $ifNull: [deal.managementPreferences?.retiringDivesting, false] }, true] },
                    { $in: ["Owner(s) Departing", { $ifNull: ["$targetCriteria.managementTeamPreference", []] }] },
                  ],
                },
                6, // Points for management preference match
                0,
              ],
            },
            yearsMatch: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $ifNull: ["$targetCriteria.minYearsInBusiness", null] }, null] },
                    { $gte: [deal.yearsInBusiness, { $ifNull: ["$targetCriteria.minYearsInBusiness", 0] }] },
                  ],
                },
                5, // Points for years in business match
                0,
              ],
            },
          },
        },
        {
          $addFields: {
            // Calculate total match score
            totalMatchScore: {
              $sum: [
                "$industryMatch",
                "$geographyMatch",
                "$revenueMatch",
                "$ebitdaMatch",
                "$transactionSizeMatch",
                "$businessModelMatch",
                "$managementMatch",
                "$yearsMatch",
              ],
            },
            // Calculate match percentage (max possible score is 50)
            matchPercentage: {
              $multiply: [
                {
                  $divide: [
                    {
                      $sum: [
                        "$industryMatch",
                        "$geographyMatch",
                        "$revenueMatch",
                        "$ebitdaMatch",
                        "$transactionSizeMatch",
                        "$businessModelMatch",
                        "$managementMatch",
                        "$yearsMatch",
                      ],
                    },
                    50, // Maximum possible score
                  ],
                },
                100,
              ],
            },
          },
        },
        {
          $project: {
            _id: 1,
            companyName: 1,
            buyerId: "$buyer",
            buyerName: "$buyerInfo.fullName",
            buyerEmail: "$buyerInfo.email",
            targetCriteria: 1,
            preferences: 1,
            totalMatchScore: 1,
            matchPercentage: { $round: ["$matchPercentage", 0] },
            matchDetails: {
              industryMatch: { $gt: ["$industryMatch", 0] },
              geographyMatch: { $gt: ["$geographyMatch", 0] },
              revenueMatch: { $gt: ["$revenueMatch", 0] },
              ebitdaMatch: { $gt: ["$ebitdaMatch", 0] },
              transactionSizeMatch: { $gt: ["$transactionSizeMatch", 0] },
              businessModelMatch: { $gt: ["$businessModelMatch", 0] },
              managementMatch: { $gt: ["$managementMatch", 0] },
              yearsMatch: { $gt: ["$yearsMatch", 0] },
            },
          },
        },
        // Sort by match percentage in descending order
        { $sort: { matchPercentage: -1 } },
        // Only include profiles with at least 20% match
        { $match: { matchPercentage: { $gte: 20 } } },
      ])
      .exec()

    return matchingProfiles
  }

  async targetDealToBuyers(dealId: string, buyerIds: string[]): Promise<Deal> {
    const deal = await this.findOne(dealId)

    const existingTargets = deal.targetedBuyers.map((id) => id.toString())
    const newTargets = buyerIds.filter((id) => !existingTargets.includes(id))

    if (newTargets.length > 0) {
      deal.targetedBuyers = [...deal.targetedBuyers, ...newTargets]

      newTargets.forEach((buyerId) => {
        deal.invitationStatus.set(buyerId, {
          invitedAt: new Date(),
          response: "pending",
        })
      })

      deal.timeline.updatedAt = new Date()
      await deal.save()
    }

    return deal
  }

  async updateDealStatus(dealId: string, buyerId: string, status: "pending" | "active" | "rejected"): Promise<any> {
    try {
      const deal = await this.findOne(dealId)
      const currentInvitation = deal.invitationStatus.get(buyerId)
      if (currentInvitation) {
        deal.invitationStatus.set(buyerId, {
          ...currentInvitation,
          respondedAt: new Date(),
          response: status === "active" ? "accepted" : status,
        })
      }
      const dealTrackingModel = this.dealModel.db.model("DealTracking")
      let interactionType
      switch (status) {
        case "active":
          interactionType = "interest"
          if (!deal.interestedBuyers.includes(buyerId)) {
            deal.interestedBuyers.push(buyerId)
          }
          break
        case "rejected":
          interactionType = "rejected"
          deal.interestedBuyers = deal.interestedBuyers.filter((id) => id.toString() !== buyerId)
          break
        case "pending":
          interactionType = "view"
          break
      }
      const tracking = new dealTrackingModel({
        deal: dealId,
        buyer: buyerId,
        interactionType,
        timestamp: new Date(),
        metadata: { status, previousStatus: currentInvitation?.response },
      })
      await tracking.save()
      await deal.save()
      return { deal, tracking }
    } catch (error) {
      throw new Error(`Failed to update deal status: ${error.message}`)
    }
  }

  async getBuyerDeals(buyerId: string, status?: "pending" | "active" | "rejected" | "completed"): Promise<Deal[]> {
    const query: any = {
      targetedBuyers: buyerId,
    }

    if (status === "active") {
      query.interestedBuyers = buyerId
      query.status = DealStatus.ACTIVE
    } else if (status === "rejected") {
      query.interestedBuyers = { $ne: buyerId }
    } else if (status === "completed") {
      query.status = DealStatus.COMPLETED
      query.interestedBuyers = buyerId // Only show completed deals the buyer was interested in
    } else if (status === "pending") {
      query.status = DealStatus.ACTIVE
      query.interestedBuyers = { $ne: buyerId }
    }

    return this.dealModel.find(query).sort({ "timeline.updatedAt": -1 }).exec()
  }

  async getBuyerDealsWithPagination(
    buyerId: string,
    status?: "pending" | "active" | "rejected",
    page = 1,
    limit = 10,
  ): Promise<{ deals: Deal[]; total: number; page: number; totalPages: number }> {
    const query: any = {
      targetedBuyers: buyerId,
    }

    if (status === "active") {
      query.interestedBuyers = buyerId
    } else if (status === "rejected") {
      query.interestedBuyers = { $ne: buyerId }
    }

    const skip = (page - 1) * limit
    const deals = await this.dealModel.find(query).skip(skip).limit(limit).exec()
    const total = await this.dealModel.countDocuments(query).exec()
    const totalPages = Math.ceil(total / limit)

    return {
      deals,
      total,
      page,
      totalPages,
    }
  }

  async getDealHistory(sellerId: string): Promise<any[]> {
    const deals = await this.dealModel.find({ seller: sellerId }).exec()

    const dealIds = deals.map((deal) => deal._id)

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
            _id: 1,
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
}
