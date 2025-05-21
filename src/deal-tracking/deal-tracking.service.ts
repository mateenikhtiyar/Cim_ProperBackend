import { Injectable, NotFoundException } from "@nestjs/common"
import { InjectModel } from "@nestjs/mongoose"
import { Model, PipelineStage } from "mongoose"
import { DealTracking, type DealTrackingDocument, InteractionType } from "./schemas/deal-tracking.schema"
import { CreateDealTrackingDto } from "./dto/create-deal-tracking.dto"

@Injectable()
export class DealTrackingService {
  constructor(
    @InjectModel(DealTracking.name)
    private dealTrackingModel: Model<DealTrackingDocument>,
  ) { }

  async create(buyerId: string, createDealTrackingDto: CreateDealTrackingDto): Promise<DealTracking> {
    const { dealId, interactionType, notes, metadata } = createDealTrackingDto

    const newDealTracking = new this.dealTrackingModel({
      deal: dealId,
      buyer: buyerId,
      interactionType,
      notes,
      metadata,
      timestamp: new Date(),
    })

    return newDealTracking.save()
  }

  async findAll(): Promise<DealTracking[]> {
    return this.dealTrackingModel.find().exec()
  }

  async findByDeal(dealId: string): Promise<DealTracking[]> {
    return this.dealTrackingModel.find({ deal: dealId }).sort({ timestamp: -1 }).exec()
  }

  async findByBuyer(buyerId: string): Promise<DealTracking[]> {
    return this.dealTrackingModel.find({ buyer: buyerId }).sort({ timestamp: -1 }).exec()
  }

  async findByDealAndBuyer(dealId: string, buyerId: string): Promise<DealTracking[]> {
    return this.dealTrackingModel.find({ deal: dealId, buyer: buyerId }).sort({ timestamp: -1 }).exec()
  }

  async findOne(id: string): Promise<DealTracking> {
    const dealTracking = await this.dealTrackingModel.findById(id).exec()
    if (!dealTracking) {
      throw new NotFoundException(`Deal tracking record with ID ${id} not found`)
    }
    return dealTracking
  }

  async logView(dealId: string, buyerId: string): Promise<DealTracking> {
    return this.create(buyerId, {
      dealId,
      interactionType: InteractionType.VIEW,
    } as CreateDealTrackingDto)
  }

  async logInterest(dealId: string, buyerId: string): Promise<DealTracking> {
    return this.create(buyerId, {
      dealId,
      interactionType: InteractionType.INTEREST,
    } as CreateDealTrackingDto)
  }

  async logRejection(dealId: string, buyerId: string, notes?: string): Promise<DealTracking> {
    return this.create(buyerId, {
      dealId,
      interactionType: InteractionType.REJECTED,
      notes,
    } as CreateDealTrackingDto)
  }

  async getInteractionStats(dealId: string): Promise<Record<InteractionType, number>> {
    const pipeline: PipelineStage[] = [
      { $match: { deal: dealId } },
      { $group: { _id: "$interactionType", count: { $sum: 1 } } }
    ];

    const result = await this.dealTrackingModel.aggregate(pipeline).exec()

    // Initialize all interaction types with zero
    const stats = Object.values(InteractionType).reduce(
      (acc, type) => {
        acc[type] = 0
        return acc
      },
      {} as Record<InteractionType, number>,
    )

    // Fill in the actual counts
    result.forEach((item) => {
      stats[item._id] = item.count
    })

    return stats
  }

  async getRecentActivityForSeller(sellerId: string, limit = 10): Promise<any[]> {
    const pipeline: PipelineStage[] = [
      {
        $lookup: {
          from: "deals",
          localField: "deal",
          foreignField: "_id",
          as: "dealInfo",
        },
      },
      { $unwind: "$dealInfo" },
      { $match: { "dealInfo.seller": sellerId } },
      { $sort: { timestamp: -1 } },
      { $limit: limit },
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
          dealId: "$deal",
          dealTitle: "$dealInfo.title",
          buyerId: "$buyer",
          buyerName: "$buyerInfo.fullName",
          buyerCompany: "$buyerInfo.companyName",
          interactionType: 1,
          notes: 1,
          timestamp: 1,
        },
      },
    ]

    return this.dealTrackingModel.aggregate(pipeline).exec()
  }
}