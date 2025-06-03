import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
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

  async create(createDealDto: CreateDealDto): Promise<Deal> {
    try {
      // Log the incoming data for debugging
      console.log("Creating deal with data:", JSON.stringify(createDealDto, null, 2))

      // Ensure documents field is properly set
      const dealData = {
        ...createDealDto,
        documents: createDealDto.documents || [], // Ensure it's an array
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      console.log("Final deal data:", JSON.stringify(dealData, null, 2))

      const createdDeal = new this.dealModel(dealData)
      const savedDeal = await createdDeal.save()

      console.log("Saved deal:", JSON.stringify(savedDeal, null, 2))
      return savedDeal
    } catch (error) {
      console.error("Error creating deal:", error)
      throw error
    }
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
      throw new NotFoundException(`Deal with ID "${id}" not found`)
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

  async closeDealseller(
    dealId: string,
    sellerId: string,
    finalSalePrice?: number,
    notes?: string,
    winningBuyerId?: string,
  ): Promise<Deal> {
    console.log(`closeDealseller called with:`, { dealId, sellerId, finalSalePrice, notes, winningBuyerId })

    // Get the document, not the plain object
    const dealDoc = await this.dealModel.findById(dealId).exec()
    if (!dealDoc) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`)
    }

    console.log(`Found deal:`, { dealId: dealDoc._id, dealSeller: dealDoc.seller })

    // Verify seller owns this deal
    if (dealDoc.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to close this deal")
    }

    // Update deal status to completed
    dealDoc.status = DealStatus.COMPLETED
    dealDoc.timeline.completedAt = new Date()
    dealDoc.timeline.updatedAt = new Date()

    // Update financial details if final sale price is provided
    if (finalSalePrice) {
      if (!dealDoc.financialDetails) {
        dealDoc.financialDetails = {}
      }
      dealDoc.financialDetails.finalSalePrice = finalSalePrice
    }

    // Create tracking record for deal closure
    const dealTrackingModel = this.dealModel.db.model("DealTracking")

    // Create tracking data with or without buyer field based on winningBuyerId
    const trackingData: any = {
      deal: dealId,
      interactionType: "completed",
      timestamp: new Date(),
      notes: notes || "Deal closed by seller",
      metadata: { finalSalePrice, winningBuyerId },
    }

    // Only add buyer field if winningBuyerId is provided
    if (winningBuyerId) {
      trackingData.buyer = winningBuyerId
    }

    const tracking = new dealTrackingModel(trackingData)

    await tracking.save()
    const savedDeal = await dealDoc.save() // Now calling save() on the document

    console.log(`Deal closed successfully:`, { dealId, status: savedDeal.status })
    return savedDeal
  }

  async updateDealStatusByBuyer(
    dealId: string,
    buyerId: string,
    status: "pending" | "active" | "rejected",
    notes?: string,
  ): Promise<any> {
    try {
      // Get the document, not the plain object
      const dealDoc = await this.dealModel.findById(dealId).exec()
      if (!dealDoc) {
        throw new NotFoundException(`Deal with ID "${dealId}" not found`)
      }

      // Check if buyer is targeted for this deal
      if (!dealDoc.targetedBuyers.includes(buyerId)) {
        throw new ForbiddenException("You are not targeted for this deal")
      }

      // Update invitation status
      const currentInvitation = dealDoc.invitationStatus.get(buyerId)
      dealDoc.invitationStatus.set(buyerId, {
        invitedAt: currentInvitation?.invitedAt || new Date(),
        respondedAt: new Date(),
        response: status === "active" ? "accepted" : status,
        notes: notes || "",
      })

      // Update interested buyers list
      if (status === "active") {
        if (!dealDoc.interestedBuyers.includes(buyerId)) {
          dealDoc.interestedBuyers.push(buyerId)
        }
      } else if (status === "rejected") {
        dealDoc.interestedBuyers = dealDoc.interestedBuyers.filter((id) => id.toString() !== buyerId)
      }

      // Create tracking record
      const dealTrackingModel = this.dealModel.db.model("DealTracking")
      let interactionType
      switch (status) {
        case "active":
          interactionType = "interest"
          break
        case "rejected":
          interactionType = "rejected"
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
        notes: notes || `Deal status changed to ${status}`,
        metadata: { status, previousStatus: currentInvitation?.response },
      })

      await tracking.save()
      dealDoc.timeline.updatedAt = new Date()
      await dealDoc.save() // Now calling save() on the document

      return { deal: dealDoc, tracking, message: `Deal status updated to ${status}` }
    } catch (error) {
      throw new Error(`Failed to update deal status: ${error.message}`)
    }
  }

  // Replace the existing getBuyerDeals method with this improved version
  async getBuyerDeals(buyerId: string, status?: "pending" | "active" | "rejected" | "completed"): Promise<Deal[]> {
    const baseQuery: any = {
      $or: [{ targetedBuyers: buyerId }, { isPublic: true, status: { $in: [DealStatus.ACTIVE, DealStatus.DRAFT] } }],
    }

    if (status === "active") {
      // Deals where buyer has shown interest (regardless of deal status)
      baseQuery.interestedBuyers = buyerId
      // Remove the deal status restriction for active buyer deals
      delete baseQuery.$or
      baseQuery.targetedBuyers = buyerId
    } else if (status === "rejected") {
      // Deals that were targeted to buyer but they rejected
      baseQuery.targetedBuyers = buyerId
      baseQuery.interestedBuyers = { $ne: buyerId }

      // Check invitation status for explicit rejections
      baseQuery.$or = [{ [`invitationStatus.${buyerId}.response`]: "rejected" }]
    } else if (status === "completed") {
      baseQuery.status = DealStatus.COMPLETED
      baseQuery.interestedBuyers = buyerId
    } else if (status === "pending") {
      // Deals targeted to buyer but no response yet, or explicitly set as pending
      baseQuery.targetedBuyers = buyerId
      baseQuery.$and = [
        {
          $or: [{ interestedBuyers: { $ne: buyerId } }, { [`invitationStatus.${buyerId}.response`]: "pending" }],
        },
        {
          [`invitationStatus.${buyerId}.response`]: { $ne: "rejected" },
        },
      ]
    }

    console.log(`Query for ${status} deals:`, JSON.stringify(baseQuery, null, 2))

    const deals = await this.dealModel.find(baseQuery).sort({ "timeline.updatedAt": -1 }).exec()
    console.log(`Found ${deals.length} ${status} deals for buyer ${buyerId}`)

    return deals
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

  async getBuyerInteractionsForDeal(dealId: string): Promise<any[]> {
    try {
      const dealTrackingModel = this.dealModel.db.model("DealTracking")

      const pipeline: any[] = [
        { $match: { deal: dealId } },
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
            from: "companyprofiles",
            localField: "buyer",
            foreignField: "buyer",
            as: "companyInfo",
          },
        },
        {
          $unwind: {
            path: "$companyInfo",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $group: {
            _id: "$buyer",
            buyerName: { $first: "$buyerInfo.fullName" },
            buyerEmail: { $first: "$buyerInfo.email" },
            buyerCompany: { $first: "$buyerInfo.companyName" },
            companyType: { $first: "$companyInfo.companyType" },
            interactions: {
              $push: {
                type: "$interactionType",
                timestamp: "$timestamp",
                notes: "$notes",
                metadata: "$metadata",
              },
            },
            lastInteraction: { $max: "$timestamp" },
            totalInteractions: { $sum: 1 },
          },
        },
        {
          $addFields: {
            currentStatus: {
              $let: {
                vars: {
                  lastInteraction: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: "$interactions",
                          cond: { $eq: ["$$this.timestamp", "$lastInteraction"] },
                        },
                      },
                      0,
                    ],
                  },
                },
                in: "$$lastInteraction.type",
              },
            },
          },
        },
        { $sort: { lastInteraction: -1 } },
        {
          $project: {
            buyerId: "$_id",
            buyerName: 1,
            buyerEmail: 1,
            buyerCompany: 1,
            companyType: 1,
            currentStatus: 1,
            lastInteraction: 1,
            totalInteractions: 1,
            interactions: {
              $slice: ["$interactions", -5], // Last 5 interactions
            },
          },
        },
      ]

      return dealTrackingModel.aggregate(pipeline).exec()
    } catch (error) {
      throw new Error(`Failed to get buyer interactions: ${error.message}`)
    }
  }

  async getDealWithBuyerStatusSummary(dealId: string): Promise<any> {
    try {
      const deal = await this.findOne(dealId)
      const buyerInteractions = await this.getBuyerInteractionsForDeal(dealId)

      // Group buyers by status
      const buyersByStatus = {
        active: buyerInteractions.filter((b) => b.currentStatus === "interest"),
        pending: buyerInteractions.filter((b) => b.currentStatus === "view"),
        rejected: buyerInteractions.filter((b) => b.currentStatus === "rejected"),
      }

      return {
        deal,
        buyersByStatus,
        summary: {
          totalTargeted: deal.targetedBuyers.length,
          totalActive: buyersByStatus.active.length,
          totalPending: buyersByStatus.pending.length,
          totalRejected: buyersByStatus.rejected.length,
        },
      }
    } catch (error) {
      throw new Error(`Failed to get deal with buyer status: ${error.message}`)
    }
  }

  async getBuyerInteractions(dealId: string): Promise<any[]> {
    try {
      const dealTrackingModel = this.dealModel.db.model("DealTracking")

      const pipeline: any[] = [
        { $match: { deal: dealId } },
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
            from: "companyprofiles",
            localField: "buyer",
            foreignField: "buyer",
            as: "companyInfo",
          },
        },
        {
          $unwind: {
            path: "$companyInfo",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $group: {
            _id: "$buyer",
            buyerName: { $first: "$buyerInfo.fullName" },
            buyerEmail: { $first: "$buyerInfo.email" },
            buyerCompany: { $first: "$buyerInfo.companyName" },
            companyType: { $first: "$companyInfo.companyType" },
            interactions: {
              $push: {
                type: "$interactionType",
                timestamp: "$timestamp",
                notes: "$notes",
                metadata: "$metadata",
              },
            },
            lastInteraction: { $max: "$timestamp" },
            totalInteractions: { $sum: 1 },
          },
        },
        {
          $addFields: {
            currentStatus: {
              $let: {
                vars: {
                  lastInteraction: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: "$interactions",
                          cond: { $eq: ["$$this.timestamp", "$lastInteraction"] },
                        },
                      },
                      0,
                    ],
                  },
                },
                in: "$$lastInteraction.type",
              },
            },
          },
        },
        { $sort: { lastInteraction: -1 } },
        {
          $project: {
            buyerId: "$_id",
            buyerName: 1,
            buyerEmail: 1,
            buyerCompany: 1,
            companyType: 1,
            currentStatus: 1,
            lastInteraction: 1,
            totalInteractions: 1,
            interactions: {
              $slice: ["$interactions", -5], // Last 5 interactions
            },
          },
        },
      ]

      return dealTrackingModel.aggregate(pipeline).exec()
    } catch (error) {
      throw new Error(`Failed to get buyer interactions: ${error.message}`)
    }
  }

  async closeDeal(dealId: string, finalSalePrice?: number, notes?: string, winningBuyerId?: string): Promise<Deal> {
    // Get the document, not the plain object
    const dealDoc = await this.dealModel.findById(dealId).exec()
    if (!dealDoc) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`)
    }

    // Update deal status to completed
    dealDoc.status = DealStatus.COMPLETED
    dealDoc.timeline.completedAt = new Date()
    dealDoc.timeline.updatedAt = new Date()

    // Update financial details if final sale price is provided
    if (finalSalePrice) {
      if (!dealDoc.financialDetails) {
        dealDoc.financialDetails = {}
      }
      dealDoc.financialDetails.finalSalePrice = finalSalePrice
    }

    // Create tracking record for deal closure
    const dealTrackingModel = this.dealModel.db.model("DealTracking")
    const tracking = new dealTrackingModel({
      deal: dealId,
      buyer: winningBuyerId || null,
      interactionType: "completed",
      timestamp: new Date(),
      notes: notes || "Deal closed",
      metadata: { finalSalePrice, winningBuyerId },
    })

    await tracking.save()
    return dealDoc.save() // Now calling save() on the document
  }

  async getDealWithBuyerStatus(dealId: string): Promise<any> {
    try {
      const deal = await this.findOne(dealId)
      const buyerInteractions = await this.getBuyerInteractions(dealId)

      // Group buyers by status
      const buyersByStatus = {
        active: buyerInteractions.filter((b) => b.currentStatus === "interest"),
        pending: buyerInteractions.filter((b) => b.currentStatus === "view"),
        rejected: buyerInteractions.filter((b) => b.currentStatus === "rejected"),
      }

      return {
        deal,
        buyersByStatus,
        summary: {
          totalTargeted: deal.targetedBuyers.length,
          totalActive: buyersByStatus.active.length,
          totalPending: buyersByStatus.pending.length,
          totalRejected: buyersByStatus.rejected.length,
        },
      }
    } catch (error) {
      throw new Error(`Failed to get deal with buyer status: ${error.message}`)
    }
  }

  async getDetailedBuyerActivity(dealId: string): Promise<any> {
    try {
      const dealTrackingModel = this.dealModel.db.model("DealTracking")

      const pipeline: any[] = [
        { $match: { deal: dealId } },
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
            from: "companyprofiles",
            localField: "buyer",
            foreignField: "buyer",
            as: "companyInfo",
          },
        },
        {
          $unwind: {
            path: "$companyInfo",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            _id: 1,
            buyerId: "$buyer",
            buyerName: "$buyerInfo.fullName",
            buyerEmail: "$buyerInfo.email",
            buyerCompany: "$buyerInfo.companyName",
            companyType: "$companyInfo.companyType",
            interactionType: 1,
            timestamp: 1,
            notes: 1,
            metadata: 1,
            actionDescription: {
              $switch: {
                branches: [
                  { case: { $eq: ["$interactionType", "interest"] }, then: "Showed Interest (Activated)" },
                  { case: { $eq: ["$interactionType", "rejected"] }, then: "Rejected Deal" },
                  { case: { $eq: ["$interactionType", "view"] }, then: "Set as Pending" },
                  { case: { $eq: ["$interactionType", "completed"] }, then: "Deal Completed" },
                ],
                default: "Other Action",
              },
            },
          },
        },
        { $sort: { timestamp: -1 } },
      ]

      const activities = await dealTrackingModel.aggregate(pipeline).exec()

      // Group by action type for summary
      const summary = {
        totalActivated: activities.filter((a) => a.interactionType === "interest").length,
        totalRejected: activities.filter((a) => a.interactionType === "rejected").length,
        totalPending: activities.filter((a) => a.interactionType === "view").length,
        uniqueBuyers: [...new Set(activities.map((a) => a.buyerId.toString()))].length,
      }

      return {
        activities,
        summary,
        deal: await this.findOne(dealId),
      }
    } catch (error) {
      throw new Error(`Failed to get detailed buyer activity: ${error.message}`)
    }
  }

  async getRecentBuyerActionsForSeller(sellerId: string, limit = 20): Promise<any[]> {
    try {
      // Get all deals for this seller
      const sellerDeals = await this.dealModel.find({ seller: sellerId }, { _id: 1, title: 1 }).exec()
      const dealIds = sellerDeals.map((deal) => deal._id)

      const dealTrackingModel = this.dealModel.db.model("DealTracking")

      const pipeline: any[] = [
        {
          $match: {
            deal: { $in: dealIds },
            interactionType: { $in: ["interest", "rejected", "view"] }, // Only buyer actions
          },
        },
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
            actionDescription: {
              $switch: {
                branches: [
                  { case: { $eq: ["$interactionType", "interest"] }, then: "Activated Deal" },
                  { case: { $eq: ["$interactionType", "rejected"] }, then: "Rejected Deal" },
                  { case: { $eq: ["$interactionType", "view"] }, then: "Set as Pending" },
                ],
                default: "Other Action",
              },
            },
            actionColor: {
              $switch: {
                branches: [
                  { case: { $eq: ["$interactionType", "interest"] }, then: "green" },
                  { case: { $eq: ["$interactionType", "rejected"] }, then: "red" },
                  { case: { $eq: ["$interactionType", "view"] }, then: "yellow" },
                ],
                default: "gray",
              },
            },
          },
        },
        { $sort: { timestamp: -1 } },
        { $limit: limit },
      ]

      return dealTrackingModel.aggregate(pipeline).exec()
    } catch (error) {
      throw new Error(`Failed to get recent buyer actions: ${error.message}`)
    }
  }

  async getInterestedBuyersDetails(dealId: string): Promise<any[]> {
    try {
      const deal = await this.findOne(dealId)

      if (!deal.interestedBuyers || deal.interestedBuyers.length === 0) {
        return []
      }

      const buyerModel = this.dealModel.db.model("Buyer")
      const companyProfileModel = this.dealModel.db.model("CompanyProfile")
      const dealTrackingModel = this.dealModel.db.model("DealTracking")

      const pipeline: any[] = [
        { $match: { _id: { $in: deal.interestedBuyers } } },
        {
          $lookup: {
            from: "companyprofiles",
            localField: "_id",
            foreignField: "buyer",
            as: "companyInfo",
          },
        },
        {
          $unwind: {
            path: "$companyInfo",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            _id: 1,
            fullName: 1,
            email: 1,
            companyName: "$companyInfo.companyName",
            companyType: "$companyInfo.companyType",
            website: "$companyInfo.website",
          },
        },
      ]

      const interestedBuyers = await buyerModel.aggregate(pipeline).exec()

      // Get interaction history for each buyer
      for (const buyer of interestedBuyers) {
        const interactions = await dealTrackingModel
          .find({
            deal: dealId,
            buyer: buyer._id,
          })
          .sort({ timestamp: -1 })
          .limit(5)
          .exec()

        buyer.recentInteractions = interactions
        buyer.lastInteraction = interactions[0]?.timestamp
        buyer.totalInteractions = interactions.length
      }

      return interestedBuyers.sort(
        (a, b) => new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime(),
      )
    } catch (error) {
      throw new Error(`Failed to get interested buyers details: ${error.message}`)
    }
  }

  async getBuyerEngagementDashboard(sellerId: string): Promise<any> {
    try {
      const deals = await this.dealModel.find({ seller: sellerId }).exec()
      const dealIds = deals.map((deal) => deal._id)

      const dealTrackingModel = this.dealModel.db.model("DealTracking")

      // Get engagement metrics
      const engagementStats = await dealTrackingModel
        .aggregate([
          { $match: { deal: { $in: dealIds } } },
          {
            $group: {
              _id: "$interactionType",
              count: { $sum: 1 },
              uniqueBuyers: { $addToSet: "$buyer" },
            },
          },
          {
            $project: {
              interactionType: "$_id",
              count: 1,
              uniqueBuyersCount: { $size: "$uniqueBuyers" },
            },
          },
        ])
        .exec()

      // Get recent activity (last 30 days)
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const recentActivity = await dealTrackingModel
        .aggregate([
          {
            $match: {
              deal: { $in: dealIds },
              timestamp: { $gte: thirtyDaysAgo },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$timestamp" },
              },
              activations: {
                $sum: { $cond: [{ $eq: ["$interactionType", "interest"] }, 1, 0] },
              },
              rejections: {
                $sum: { $cond: [{ $eq: ["$interactionType", "rejected"] }, 1, 0] },
              },
              views: {
                $sum: { $cond: [{ $eq: ["$interactionType", "view"] }, 1, 0] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .exec()

      // Get top performing deals
      const topDeals = await dealTrackingModel
        .aggregate([
          { $match: { deal: { $in: dealIds } } },
          {
            $group: {
              _id: "$deal",
              totalInteractions: { $sum: 1 },
              activations: {
                $sum: { $cond: [{ $eq: ["$interactionType", "interest"] }, 1, 0] },
              },
              uniqueBuyers: { $addToSet: "$buyer" },
            },
          },
          {
            $lookup: {
              from: "deals",
              localField: "_id",
              foreignField: "_id",
              as: "dealInfo",
            },
          },
          { $unwind: "$dealInfo" },
          {
            $project: {
              dealId: "$_id",
              dealTitle: "$dealInfo.title",
              totalInteractions: 1,
              activations: 1,
              uniqueBuyersCount: { $size: "$uniqueBuyers" },
              engagementRate: {
                $multiply: [{ $divide: ["$activations", "$totalInteractions"] }, 100],
              },
            },
          },
          { $sort: { engagementRate: -1 } },
          { $limit: 5 },
        ])
        .exec()

      return {
        overview: {
          totalDeals: deals.length,
          activeDeals: deals.filter((d) => d.status === DealStatus.ACTIVE).length,
          completedDeals: deals.filter((d) => d.status === DealStatus.COMPLETED).length,
        },
        engagementStats,
        recentActivity,
        topDeals,
        summary: {
          totalActivations: engagementStats.find((s) => s.interactionType === "interest")?.count || 0,
          totalRejections: engagementStats.find((s) => s.interactionType === "rejected")?.count || 0,
          totalViews: engagementStats.find((s) => s.interactionType === "view")?.count || 0,
          uniqueEngagedBuyers: [...new Set(engagementStats.flatMap((s) => s.uniqueBuyers || []))].length,
        },
      }
    } catch (error) {
      throw new Error(`Failed to get buyer engagement dashboard: ${error.message}`)
    }
  }
}
