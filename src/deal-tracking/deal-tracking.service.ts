import { Injectable, NotFoundException } from "@nestjs/common"
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from "mongoose"
import { DealTracking, DealTrackingDocument, InteractionType } from "./schemas/deal-tracking.schema"
import { CreateDealTrackingDto } from "./dto/create-deal-tracking.dto"

@Injectable()
export class DealTrackingService {
  constructor(
    @InjectModel(DealTracking.name) private dealTrackingModel: Model<DealTrackingDocument>
  ) { }

  async create(buyerId: string, createDealTrackingDto: CreateDealTrackingDto): Promise<DealTracking> {
    const newTracking = new this.dealTrackingModel({
      deal: createDealTrackingDto.dealId,
      buyer: buyerId,
      interactionType: createDealTrackingDto.interactionType,
      notes: createDealTrackingDto.notes,
      metadata: createDealTrackingDto.metadata || {},
      timestamp: new Date(),
    })

    return newTracking.save()
  }

  async findAll(): Promise<DealTracking[]> {
    return this.dealTrackingModel.find().sort({ timestamp: -1 }).exec()
  }

  async findByDeal(dealId: string): Promise<DealTracking[]> {
    return this.dealTrackingModel.find({ deal: dealId }).sort({ timestamp: -1 }).exec()
  }

  async findByBuyer(buyerId: string): Promise<DealTracking[]> {
    return this.dealTrackingModel.find({ buyer: buyerId }).sort({ timestamp: -1 }).exec()
  }

  async getInteractionStats(dealId: string): Promise<any> {
    const pipeline: PipelineStage[] = [
      { $match: { deal: dealId } },
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
          _id: 0,
        },
      },
    ]

    const stats = await this.dealTrackingModel.aggregate(pipeline).exec()

    // Calculate total views and conversion rates
    const viewStats = stats.find((s) => s.interactionType === InteractionType.VIEW) || {
      count: 0,
      uniqueBuyersCount: 0,
    }
    const interestStats = stats.find((s) => s.interactionType === InteractionType.INTEREST) || {
      count: 0,
      uniqueBuyersCount: 0,
    }

    return {
      interactionsByType: stats,
      summary: {
        totalViews: viewStats.count,
        uniqueViewers: viewStats.uniqueBuyersCount,
        totalInterested: interestStats.count,
        uniqueInterested: interestStats.uniqueBuyersCount,
        conversionRate:
          viewStats.uniqueBuyersCount > 0
            ? ((interestStats.uniqueBuyersCount / viewStats.uniqueBuyersCount) * 100).toFixed(2) + "%"
            : "0%",
      },
    }
  }

  async getRecentActivityForSeller(sellerId: string, limit = 10): Promise<any[]> {
    // First get all deals by this seller
    const dealModel = this.dealTrackingModel.db.model("Deal")
    const sellerDeals = await dealModel.find({ seller: sellerId }, { _id: 1 }).exec()
    const dealIds = sellerDeals.map((deal) => deal._id)

    // Then get recent activity for these deals
    const pipeline: PipelineStage[] = [
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
      { $limit: limit },
    ]

    return this.dealTrackingModel.aggregate(pipeline).exec()
  }

  async logView(dealId: string, buyerId: string): Promise<DealTracking> {
    return this.create(buyerId, {
      dealId,
      interactionType: InteractionType.VIEW,
      notes: "Deal viewed",
    })
  }

  async logInterest(dealId: string, buyerId: string): Promise<DealTracking> {
    // Update the deal to add buyer to interested list
    const dealModel = this.dealTrackingModel.db.model("Deal")
    const deal = await dealModel.findById(dealId).exec()

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${dealId} not found`)
    }

    // Add to interested buyers if not already there
    if (!deal.interestedBuyers.includes(buyerId)) {
      deal.interestedBuyers.push(buyerId)
      await deal.save()
    }

    // Create tracking record
    return this.create(buyerId, {
      dealId,
      interactionType: InteractionType.INTEREST,
      notes: "Interest expressed in deal",
    })
  }

  async logRejection(dealId: string, buyerId: string, notes?: string): Promise<DealTracking> {
    // Update the deal to remove buyer from interested list if present
    const dealModel = this.dealTrackingModel.db.model("Deal")
    const deal = await dealModel.findById(dealId).exec()

    if (!deal) {
      throw new NotFoundException(`Deal with ID ${dealId} not found`)
    }

    // Remove from interested buyers if present
    if (deal.interestedBuyers.includes(buyerId)) {
      deal.interestedBuyers = deal.interestedBuyers.filter((id) => id.toString() !== buyerId)
      await deal.save()
    }

    // Create tracking record
    return this.create(buyerId, {
      dealId,
      interactionType: InteractionType.REJECTED,
      notes: notes || "Deal rejected",
    })
  }

  async getDetailedDealActivity(dealId: string): Promise<any[]> {
    try {
      const pipeline: PipelineStage[] = [
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
        { $sort: { timestamp: -1 } },
        {
          $project: {
            _id: 1,
            buyerId: "$buyer",
            buyerName: "$buyerInfo.fullName",
            buyerEmail: "$buyerInfo.email",
            buyerCompany: "$buyerInfo.companyName",
            companyType: "$companyInfo.companyType",
            interactionType: 1,
            notes: 1,
            timestamp: 1,
            metadata: 1,
          },
        },
      ]

      return this.dealTrackingModel.aggregate(pipeline).exec()
    } catch (error) {
      throw new Error(`Failed to get detailed deal activity: ${error.message}`)
    }
  }

  async getBuyerInteractionSummary(buyerId: string): Promise<any> {
    try {
      const pipeline: PipelineStage[] = [
        { $match: { buyer: buyerId } },
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
          $group: {
            _id: "$deal",
            dealTitle: { $first: "$dealInfo.title" },
            dealStatus: { $first: "$dealInfo.status" },
            lastInteraction: { $max: "$timestamp" },
            interactionTypes: { $addToSet: "$interactionType" },
            totalInteractions: { $sum: 1 },
          },
        },
        { $sort: { lastInteraction: -1 } },
      ]

      return this.dealTrackingModel.aggregate(pipeline).exec()
    } catch (error) {
      throw new Error(`Failed to get buyer interaction summary: ${error.message}`)
    }
  }
}
