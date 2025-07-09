import { ForbiddenException, Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from "@nestjs/common"
import { Deal, DealDocumentType as DealDocument, DealStatus } from "./schemas/deal.schema"
import { CreateDealDto } from "./dto/create-deal.dto"
import { UpdateDealDto } from "./dto/update-deal.dto"
import { Buyer } from '../buyers/schemas/buyer.schema';
import * as fs from "fs"
import mongoose, { Model, Types } from 'mongoose';
import { InjectModel } from "@nestjs/mongoose"
import { expandCountryOrRegion } from '../common/geography-hierarchy';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import * as path from "path";

interface DocumentInfo {
  filename: string
  originalName: string
  path: string
  size: number
  mimetype: string
  uploadedAt: Date
}
interface BuyerStatus {
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  buyerCompany: string;
  companyType?: string;
  lastInteraction?: Date;
  totalInteractions?: number;
  interactions?: any[];
}

@Injectable()
export class DealsService {
  constructor(
    @InjectModel(Deal.name) private dealModel: Model<DealDocument>,
    @InjectModel('Buyer') private buyerModel: Model<Buyer>,
  ) { }


  async create(createDealDto: CreateDealDto): Promise<Deal> {
    try {
      // Log the incoming data for debugging
      console.log("Creating deal with data:", JSON.stringify(createDealDto, null, 2))

      // Ensure documents field is properly set
      const dealData = {
        ...createDealDto,
        documents: createDealDto.documents || [], // This will now contain the file paths
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
    return this.dealModel
      .find({
        seller: sellerId,
        status: { $ne: DealStatus.COMPLETED },
      })
      .exec()
  }

  async findOne(dealId: string): Promise<Deal> {
    if (!mongoose.isValidObjectId(dealId)) {
      throw new BadRequestException('Invalid deal ID');
    }
    const deal = await this.dealModel.findById(dealId).exec() as DealDocument;
    if (!deal) {
      throw new NotFoundException('Deal not found');
    }
    return deal;
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
    const deal = await this.dealModel.findById(dealId).exec() as DealDocument; // Explicitly cast to DealDocument
    if (!deal.documents) {
      deal.documents = [];
    }
    deal.documents.push(...documents);
    deal.timeline.updatedAt = new Date();
    return deal.save();
  }

  async removeDocument(dealId: string, documentIndex: number): Promise<Deal> {
    const deal = await this.dealModel.findById(dealId).exec() as DealDocument;
    if (!deal.documents || documentIndex < 0 || documentIndex >= deal.documents.length) {
      throw new NotFoundException("Document not found");
    }
    const documentToRemove = deal.documents[documentIndex];
    try {
      if (fs.existsSync(documentToRemove.path)) {
        fs.unlinkSync(documentToRemove.path);
      }
    } catch (error) {
      console.error("Error removing file:", error);
    }
    deal.documents.splice(documentIndex, 1);
    deal.timeline.updatedAt = new Date();
    return deal.save();
  }

  async update(id: string, userId: string, updateDealDto: UpdateDealDto, userRole?: string): Promise<Deal> {
    const deal = await this.dealModel.findById(id).exec() as DealDocument;
    if (!deal) {
      throw new NotFoundException(`Deal with ID ${id} not found`);
    }
    // Allow update if user is seller or admin
    if (deal.seller.toString() !== userId && userRole !== 'admin') {
      throw new ForbiddenException("You don't have permission to update this deal");
    }
    console.log("[UPDATE] Incoming updateDealDto.documents:", JSON.stringify(updateDealDto.documents));
    if (Array.isArray(updateDealDto.documents) && updateDealDto.documents.length > 0) {
      console.log("[UPDATE] Type of first element in documents:", typeof updateDealDto.documents[0]);
    }
    console.log("[UPDATE] Existing deal.documents before update:", JSON.stringify(deal.documents));
    if (updateDealDto.status === DealStatus.ACTIVE && deal.status !== DealStatus.ACTIVE) {
      deal.timeline.publishedAt = new Date();
    }
    if (updateDealDto.status === DealStatus.COMPLETED && deal.status !== DealStatus.COMPLETED) {
      deal.timeline.completedAt = new Date();
    }
    deal.timeline.updatedAt = new Date();
    if (Array.isArray(updateDealDto.documents) && updateDealDto.documents.length > 0) {
      if (typeof updateDealDto.documents[0] === "string") {
        deal.documents = (deal.documents || []).filter((doc: any) =>
          (updateDealDto.documents as string[]).includes(doc.filename)
        );
      } else {
        const existingDocs = deal.documents || [];
        const updatedDocs = (updateDealDto.documents as any[]).map((incomingDoc: any) => {
          const existingDoc = existingDocs.find((d: any) => d.filename === incomingDoc.filename);
          return existingDoc ? { ...existingDoc, ...incomingDoc } : incomingDoc;
        });
        const nonUpdatedDocs = existingDocs.filter(
          (d: any) => !(updateDealDto.documents as any[]).some((incomingDoc: any) => incomingDoc.filename === d.filename)
        );
        deal.documents = [...updatedDocs, ...nonUpdatedDocs];
      }
    }
    console.log("[UPDATE] Resulting deal.documents after update:", JSON.stringify(deal.documents));
    const { documents, ...updateDataWithoutDocuments } = updateDealDto;
    Object.assign(deal, updateDataWithoutDocuments);
    if (deal.visibility) {
      const rewardLevelMap: Record<string, 'Seed' | 'Bloom' | 'Fruit'> = {
        seed: 'Seed',
        bloom: 'Bloom',
        fruit: 'Fruit'
      };
      deal.rewardLevel = rewardLevelMap[deal.visibility] || 'Seed';
    }
    await deal.save();
    const updatedDeal = await this.dealModel.findById(deal._id).exec() as DealDocument;
    if (!updatedDeal) {
      throw new NotFoundException(`Deal with ID ${deal._id} not found after update`);
    }
    return updatedDeal;
  }

  async remove(id: string, userId: string, userRole?: string): Promise<void> {
    const deal = await this.dealModel.findById(id).exec() as DealDocument;

    if (!deal) {
      throw new NotFoundException(`Deal with ID "${id}" not found`)
    }

    // Allow admin to delete any deal
    if (deal.seller.toString() !== userId && userRole !== 'admin') {
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
    const deal = await this.findOne(dealId);

    // Expand the deal.geographySelection into its continent/region/sub-regions
    const expandedGeos = expandCountryOrRegion(deal.geographySelection);

    const { rewardLevel } = deal;
    let extraMatchCondition: any = {};

    // Seed functionality - if deal is "Seed" and buyer has "doNotSendMarketedDeals" = true, exclude them
    if (rewardLevel === "Seed") {
      extraMatchCondition = {
        "preferences.doNotSendMarketedDeals": { $ne: true }
      };
    }

    // MANDATORY matching criteria - these are required for any match
    const mandatoryQuery: any = {
      "preferences.stopSendingDeals": { $ne: true },
      "targetCriteria.countries": { $in: expandedGeos },
      "targetCriteria.industrySectors": { $in: [deal.industrySector] },
      ...extraMatchCondition,
    };

    const companyProfileModel = this.dealModel.db.model('CompanyProfile');
    const matchingProfiles = await companyProfileModel
      .aggregate([
        { $match: mandatoryQuery },
        {
          $lookup: {
            from: 'buyers',
            localField: 'buyer',
            foreignField: '_id',
            as: 'buyerInfo',
          },
        },
        { $unwind: '$buyerInfo' },
        {
          $addFields: {
            // MANDATORY MATCHES - Always get full points since they passed the mandatory query
            industryMatch: 10, // Always 10 points since it's mandatory
            geographyMatch: 10, // Always 10 points since it's mandatory

            // REVENUE RANGE MATCHING - Deal revenue must be between buyer's min and max
            revenueMatch: {
              $cond: [
                {
                  $and: [
                    // Lower bound: deal revenue >= buyer min (or buyer has no min)
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$targetCriteria.revenueMin", null] }, null] },
                        { $gte: [{ $ifNull: [deal.financialDetails?.trailingRevenueAmount, 0] }, { $ifNull: ["$targetCriteria.revenueMin", 0] }] }
                      ]
                    },
                    // Upper bound: deal revenue <= buyer max (or buyer has no max)
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$targetCriteria.revenueMax", null] }, null] },
                        { $lte: [{ $ifNull: [deal.financialDetails?.trailingRevenueAmount, 0] }, { $ifNull: ["$targetCriteria.revenueMax", Number.MAX_SAFE_INTEGER] }] }
                      ]
                    }
                  ]
                },
                8, // Match points
                0
              ]
            },

            // EBITDA RANGE MATCHING - Deal EBITDA must be between buyer's min and max
            // If buyer puts 0 in min, they want anything above 0
            ebitdaMatch: {
              $cond: [
                {
                  $and: [
                    // Lower bound: if buyer min is 0, deal must be > 0; otherwise deal >= buyer min
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMin", null] }, null] },
                        {
                          $cond: [
                            { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMin", 0] }, 0] },
                            { $gt: [{ $ifNull: [deal.financialDetails?.trailingEBITDAAmount, 0] }, 0] },
                            { $gte: [{ $ifNull: [deal.financialDetails?.trailingEBITDAAmount, 0] }, { $ifNull: ["$targetCriteria.ebitdaMin", 0] }] }
                          ]
                        }
                      ]
                    },
                    // Upper bound: deal EBITDA <= buyer max (or buyer has no max)
                    {
                      $or: [
                        { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMax", null] }, null] },
                        { $lte: [{ $ifNull: [deal.financialDetails?.trailingEBITDAAmount, 0] }, { $ifNull: ["$targetCriteria.ebitdaMax", Number.MAX_SAFE_INTEGER] }] }
                      ]
                    }
                  ]
                },
                8,
                0
              ]
            },

            // AVERAGE REVENUE GROWTH MATCHING - Deal growth must be >= buyer's requirement
            revenueGrowthMatch: {
              $cond: [
                {
                  $or: [
                    // No revenue growth criteria set by buyer
                    { $eq: [{ $ifNull: ["$targetCriteria.revenueGrowth", null] }, null] },
                    // Deal growth >= buyer's minimum requirement
                    { $gte: [{ $ifNull: [deal.financialDetails?.avgRevenueGrowth, 0] }, { $ifNull: ["$targetCriteria.revenueGrowth", 0] }] }
                  ]
                },
                5,
                0
              ]
            },

            // YEARS IN BUSINESS MATCHING - Deal years >= buyer's minimum requirement
            yearsMatch: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $ifNull: ["$targetCriteria.minYearsInBusiness", null] }, null] },
                    { $gte: [deal.yearsInBusiness, { $ifNull: ["$targetCriteria.minYearsInBusiness", 0] }] }
                  ]
                },
                5,
                0
              ]
            },

            // PREFERRED BUSINESS MODELS MATCHING - Check if any deal business model matches buyer preferences
            businessModelMatch: {
              $sum: [
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: [deal.businessModel?.recurringRevenue, false] }, true] },
                        { $in: ["Recurring Revenue", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
                      ]
                    },
                    3, // Bonus points for recurring revenue match
                    0
                  ]
                },
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: [deal.businessModel?.projectBased, false] }, true] },
                        { $in: ["Project-Based", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
                      ]
                    },
                    3, // Bonus points for project-based match
                    0
                  ]
                },
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: [deal.businessModel?.assetLight, false] }, true] },
                        { $in: ["Asset Light", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
                      ]
                    },
                    3, // Bonus points for asset light match
                    0
                  ]
                },
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $ifNull: [deal.businessModel?.assetHeavy, false] }, true] },
                        { $in: ["Asset Heavy", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
                      ]
                    },
                    3, // Bonus points for asset heavy match
                    0
                  ]
                }
              ]
            },

            // CAPITAL AVAILABILITY MATCHING - Check if buyer's capital entity matches any of deal's capital availability requirements
            capitalAvailabilityMatch: {
              $cond: [
                {
                  $or: [
                    // No capital availability criteria in deal
                    { $eq: [{ $ifNull: [deal.buyerFit?.capitalAvailability, null] }, null] },
                    { $eq: [{ $size: { $ifNull: [deal.buyerFit?.capitalAvailability, []] } }, 0] },
                    // Check if buyer's capital entity matches any item in deal's capital availability array
                    { $in: ["$capitalEntity", { $ifNull: [deal.buyerFit?.capitalAvailability, []] }] }
                  ]
                },
                4,
                0
              ]
            },

            // COMPANY TYPE MATCHING - Check if buyer's company type matches any of deal's company types
            companyTypeMatch: {
              $cond: [
                {
                  $or: [
                    // No company type specified in deal
                    { $eq: [{ $ifNull: [deal.companyType, null] }, null] },
                    { $eq: [{ $size: { $ifNull: [deal.companyType, []] } }, 0] },
                    // Check if buyer's company type matches any item in deal's company type array
                    { $in: ["$companyType", { $ifNull: [deal.companyType, []] }] }
                  ]
                },
                4,
                0
              ]
            },

            // MINIMUM TRANSACTION SIZE MATCHING - Buyer's average deal size >= deal's minimum requirement
            minTransactionSizeMatch: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $ifNull: [deal.buyerFit?.minTransactionSize, null] }, null] },
                    { $gte: [{ $ifNull: ["$averageDealSize", 0] }, { $ifNull: [deal.buyerFit?.minTransactionSize, 0] }] }
                  ]
                },
                5,
                0
              ]
            },

            // MINIMUM PRIOR ACQUISITIONS MATCHING - Buyer's deals completed >= deal's minimum requirement
            priorAcquisitionsMatch: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $ifNull: [deal.buyerFit?.minPriorAcquisitions, null] }, null] },
                    { $gte: [{ $ifNull: ["$dealsCompletedLast5Years", 0] }, { $ifNull: [deal.buyerFit?.minPriorAcquisitions, 0] }] }
                  ]
                },
                5,
                0
              ]
            },

            // STAKE PERCENTAGE MATCHING - Deal stake percentage >= buyer's minimum requirement
            stakePercentageMatch: {
              $cond: [
                {
                  $or: [
                    { $eq: [{ $ifNull: ["$targetCriteria.minStakePercent", null] }, null] },
                    { $eq: [{ $ifNull: [deal.stakePercentage, null] }, null] },
                    { $gte: [{ $ifNull: [deal.stakePercentage, 100] }, { $ifNull: ["$targetCriteria.minStakePercent", 0] }] }
                  ]
                },
                4,
                0
              ]
            }
          }
        },
        // Calculate total match score and percentage
        {
          $addFields: {
            totalMatchScore: {
              $sum: [
                "$industryMatch",
                "$geographyMatch",
                "$revenueMatch",
                "$ebitdaMatch",
                "$revenueGrowthMatch",
                "$yearsMatch",
                "$businessModelMatch",
                "$capitalAvailabilityMatch",
                "$companyTypeMatch",
                "$minTransactionSizeMatch",
                "$priorAcquisitionsMatch",
                "$stakePercentageMatch"
              ]
            },
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
                        "$revenueGrowthMatch",
                        "$yearsMatch",
                        "$businessModelMatch",
                        "$capitalAvailabilityMatch",
                        "$companyTypeMatch",
                        "$minTransactionSizeMatch",
                        "$priorAcquisitionsMatch",
                        "$stakePercentageMatch"
                      ]
                    },
                    65 // Maximum possible score remains the same: 20+8+8+5+5+12+4+4+5+5+4 = 65
                  ]
                },
                100
              ]
            }
          }
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
            companyType: 1,
            capitalEntity: 1,
            dealsCompletedLast5Years: 1,
            averageDealSize: 1,
            totalMatchScore: 1,
            matchPercentage: { $round: ["$matchPercentage", 0] },
            matchDetails: {
              industryMatch: true, // Always true (mandatory)
              geographyMatch: true, // Always true (mandatory)
              revenueMatch: { $gt: ["$revenueMatch", 0] },
              ebitdaMatch: { $gt: ["$ebitdaMatch", 0] },
              revenueGrowthMatch: { $gt: ["$revenueGrowthMatch", 0] },
              yearsMatch: { $gt: ["$yearsMatch", 0] },
              businessModelMatch: { $gt: ["$businessModelMatch", 0] },
              capitalAvailabilityMatch: { $gt: ["$capitalAvailabilityMatch", 0] },
              companyTypeMatch: { $gt: ["$companyTypeMatch", 0] },
              minTransactionSizeMatch: { $gt: ["$minTransactionSizeMatch", 0] },
              priorAcquisitionsMatch: { $gt: ["$priorAcquisitionsMatch", 0] },
              stakePercentageMatch: { $gt: ["$stakePercentageMatch", 0] }
            },
            criteriaDetails: {
              dealIndustry: deal.industrySector,
              dealGeography: deal.geographySelection,
              dealRevenue: deal.financialDetails?.trailingRevenueAmount,
              dealEbitda: deal.financialDetails?.trailingEBITDAAmount,
              dealAvgRevenueGrowth: deal.financialDetails?.avgRevenueGrowth,
              dealYearsInBusiness: deal.yearsInBusiness,
              dealStakePercentage: deal.stakePercentage,
              dealCompanyType: deal.companyType,
              dealCapitalAvailability: deal.buyerFit?.capitalAvailability,
              dealMinTransactionSize: deal.buyerFit?.minTransactionSize,
              dealMinPriorAcquisitions: deal.buyerFit?.minPriorAcquisitions
            }
          }
        },
        // Sort by match percentage in descending order
        { $sort: { matchPercentage: -1 } },
        // Filter results with minimum match threshold of 35%
        { $match: { matchPercentage: { $gte: 35 } } }
      ])
      .exec();

    return matchingProfiles;
  }
  // ---------------------------------------------------------------------------------------------------------------------




  // async findMatchingBuyers(dealId: string): Promise<any[]> {
  //   const deal = await this.findOne(dealId)

  //   // Extract deal values for use in aggregation
  //   const dealGeography = deal.geographySelection
  //   const dealIndustry = deal.industrySector
  //   const dealRevenue = deal.financialDetails?.trailingRevenueAmount || 0
  //   const dealEBITDA = deal.financialDetails?.trailingEBITDAAmount || 0
  //   const dealAskingPrice = deal.financialDetails?.askingPrice || 0
  //   const dealRevenueGrowth = deal.financialDetails?.avgRevenueGrowth || 0
  //   const dealYearsInBusiness = deal.yearsInBusiness || 0
  //   const dealStakePercentage = deal.stakePercentage || 100
  //   const dealRecurringRevenue = deal.businessModel?.recurringRevenue || false
  //   const dealProjectBased = deal.businessModel?.projectBased || false
  //   const dealAssetLight = deal.businessModel?.assetLight || false
  //   const dealAssetHeavy = deal.businessModel?.assetHeavy || false
  //   const dealOwnerDeparting = deal.managementPreferences?.retiringDivesting || false

  //   // Basic filter to exclude buyers who have opted out
  //   const baseQuery: any = {
  //     "preferences.stopSendingDeals": { $ne: true },
  //   }

  //   const companyProfileModel = this.dealModel.db.model("CompanyProfile")
  //   const matchingProfiles = await companyProfileModel
  //     .aggregate([
  //       { $match: baseQuery },
  //       {
  //         $lookup: {
  //           from: "buyers",
  //           localField: "buyer",
  //           foreignField: "_id",
  //           as: "buyerInfo",
  //         },
  //       },
  //       { $unwind: "$buyerInfo" },
  //       {
  //         $addFields: {
  //           // MANDATORY: Geography must match (no points if empty array)
  //           geographyMatch: {
  //             $cond: [
  //               {
  //                 $and: [
  //                   // Must have countries specified (no empty array allowed)
  //                   { $gt: [{ $size: { $ifNull: ["$targetCriteria.countries", []] } }, 0] },
  //                   // Deal's geography must be in the target list
  //                   { $in: [dealGeography, { $ifNull: ["$targetCriteria.countries", []] }] },
  //                 ]
  //               },
  //               10, // Points for geography match
  //               0,  // No match if criteria not met
  //             ],
  //           },

  //           // MANDATORY: Industry must match (no points if empty array)
  //           industryMatch: {
  //             $cond: [
  //               {
  //                 $and: [
  //                   // Must have industry sectors specified (no empty array allowed)
  //                   { $gt: [{ $size: { $ifNull: ["$targetCriteria.industrySectors", []] } }, 0] },
  //                   // Deal's industry must be in the target list
  //                   { $in: [dealIndustry, { $ifNull: ["$targetCriteria.industrySectors", []] }] },
  //                 ]
  //               },
  //               10, // Points for industry match
  //               0,  // No match if criteria not met
  //             ],
  //           },

  //           // MANDATORY: Revenue must be within specified range
  //           revenueMatch: {
  //             $cond: [
  //               {
  //                 $and: [
  //                   // Must have both min and max specified (not null or 0)
  //                   { $ne: [{ $ifNull: ["$targetCriteria.revenueMin", null] }, null] },
  //                   { $ne: [{ $ifNull: ["$targetCriteria.revenueMax", null] }, null] },
  //                   { $gt: ["$targetCriteria.revenueMin", 0] },
  //                   { $gt: ["$targetCriteria.revenueMax", 0] },
  //                   // Deal revenue must be within the range
  //                   { $gte: [dealRevenue, { $ifNull: ["$targetCriteria.revenueMin", 0] }] },
  //                   { $lte: [dealRevenue, { $ifNull: ["$targetCriteria.revenueMax", 0] }] },
  //                 ],
  //               },
  //               8, // Points for revenue match
  //               0, // No match if criteria not met
  //             ],
  //           },

  //           // MANDATORY: EBITDA must be within specified range (0 allows negative EBITDA)
  //           ebitdaMatch: {
  //             $cond: [
  //               {
  //                 $and: [
  //                   // Must have both min and max specified (not null, but 0 is allowed for min)
  //                   { $ne: [{ $ifNull: ["$targetCriteria.ebitdaMin", null] }, null] },
  //                   { $ne: [{ $ifNull: ["$targetCriteria.ebitdaMax", null] }, null] },
  //                   { $gte: ["$targetCriteria.ebitdaMin", 0] }, // Min can be 0 (allows negative EBITDA)
  //                   { $gt: ["$targetCriteria.ebitdaMax", 0] },  // Max must be greater than 0
  //                   // Deal EBITDA must be within the range
  //                   { $gte: [dealEBITDA, { $ifNull: ["$targetCriteria.ebitdaMin", 0] }] },
  //                   { $lte: [dealEBITDA, { $ifNull: ["$targetCriteria.ebitdaMax", 0] }] },
  //                 ],
  //               },
  //               8, // Points for EBITDA match
  //               0, // No match if criteria not met
  //             ],
  //           },

  //           // MANDATORY: Transaction size must be within specified range
  //           transactionSizeMatch: {
  //             $cond: [
  //               {
  //                 $and: [
  //                   // Must have both min and max specified (not null or 0)
  //                   { $ne: [{ $ifNull: ["$targetCriteria.transactionSizeMin", null] }, null] },
  //                   { $ne: [{ $ifNull: ["$targetCriteria.transactionSizeMax", null] }, null] },
  //                   { $gt: ["$targetCriteria.transactionSizeMin", 0] },
  //                   { $gt: ["$targetCriteria.transactionSizeMax", 0] },
  //                   // Deal asking price must be within the range
  //                   { $gte: [dealAskingPrice, { $ifNull: ["$targetCriteria.transactionSizeMin", 0] }] },
  //                   { $lte: [dealAskingPrice, { $ifNull: ["$targetCriteria.transactionSizeMax", 0] }] },
  //                 ],
  //               },
  //               8, // Points for transaction size match
  //               0, // No match if criteria not met
  //             ],
  //           },

  //           // OPTIONAL: Business model matching
  //           businessModelMatch: {
  //             $sum: [
  //               {
  //                 $cond: [
  //                   {
  //                     $and: [
  //                       { $eq: [dealRecurringRevenue, true] },
  //                       { $in: ["Recurring Revenue", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] },
  //                     ],
  //                   },
  //                   3, // Points for recurring revenue match
  //                   0,
  //                 ],
  //               },
  //               {
  //                 $cond: [
  //                   {
  //                     $and: [
  //                       { $eq: [dealProjectBased, true] },
  //                       { $in: ["Project-Based", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] },
  //                     ],
  //                   },
  //                   3, // Points for project-based match
  //                   0,
  //                 ],
  //               },
  //               {
  //                 $cond: [
  //                   {
  //                     $and: [
  //                       { $eq: [dealAssetLight, true] },
  //                       { $in: ["Asset Light", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] },
  //                     ],
  //                   },
  //                   3, // Points for asset light match
  //                   0,
  //                 ],
  //               },
  //               {
  //                 $cond: [
  //                   {
  //                     $and: [
  //                       { $eq: [dealAssetHeavy, true] },
  //                       { $in: ["Asset Heavy", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] },
  //                     ],
  //                   },
  //                   3, // Points for asset heavy match
  //                   0,
  //                 ],
  //               },
  //             ],
  //           },

  //           // OPTIONAL: Management matching
  //           managementMatch: {
  //             $cond: [
  //               {
  //                 $or: [
  //                   // If no management preferences specified, consider neutral (partial match)
  //                   { $eq: [{ $size: { $ifNull: ["$targetCriteria.managementTeamPreference", []] } }, 0] },
  //                   // If deal matches specific management preferences
  //                   {
  //                     $and: [
  //                       { $eq: [dealOwnerDeparting, true] },
  //                       { $in: ["Owner(s) Departing", { $ifNull: ["$targetCriteria.managementTeamPreference", []] }] },
  //                     ],
  //                   },
  //                 ]
  //               },
  //               6, // Points for management preference match
  //               2, // Partial points if no specific preference
  //             ],
  //           },

  //           // OPTIONAL: Years in business matching
  //           yearsMatch: {
  //             $cond: [
  //               {
  //                 $or: [
  //                   { $eq: [{ $ifNull: ["$targetCriteria.minYearsInBusiness", null] }, null] },
  //                   { $eq: ["$targetCriteria.minYearsInBusiness", 0] },
  //                   { $gte: [dealYearsInBusiness, { $ifNull: ["$targetCriteria.minYearsInBusiness", 0] }] },
  //                 ],
  //               },
  //               5, // Points for years in business match
  //               0,
  //             ],
  //           },

  //           // OPTIONAL: Revenue growth match
  //           revenueGrowthMatch: {
  //             $cond: [
  //               {
  //                 $or: [
  //                   { $eq: [{ $ifNull: ["$targetCriteria.revenueGrowth", null] }, null] },
  //                   { $eq: ["$targetCriteria.revenueGrowth", 0] },
  //                   { $gte: [dealRevenueGrowth, { $ifNull: ["$targetCriteria.revenueGrowth", 0] }] },
  //                 ],
  //               },
  //               4, // Points for revenue growth match
  //               0,
  //             ],
  //           },

  //           // OPTIONAL: Stake percentage match
  //           stakeMatch: {
  //             $cond: [
  //               {
  //                 $or: [
  //                   { $eq: [{ $ifNull: ["$targetCriteria.minStakePercent", null] }, null] },
  //                   { $eq: ["$targetCriteria.minStakePercent", 0] },
  //                   { $gte: [dealStakePercentage, { $ifNull: ["$targetCriteria.minStakePercent", 0] }] },
  //                 ],
  //               },
  //               3, // Points for stake percentage match
  //               0,
  //             ],
  //           },
  //         },
  //       },
  //       {
  //         $addFields: {
  //           // Calculate total match score
  //           totalMatchScore: {
  //             $sum: [
  //               "$industryMatch",
  //               "$geographyMatch",
  //               "$revenueMatch",
  //               "$ebitdaMatch",
  //               "$transactionSizeMatch",
  //               "$businessModelMatch",
  //               "$managementMatch",
  //               "$yearsMatch",
  //               "$revenueGrowthMatch",
  //               "$stakeMatch",
  //             ],
  //           },
  //           // Calculate match percentage (max possible score is still 57)
  //           matchPercentage: {
  //             $multiply: [
  //               {
  //                 $divide: [
  //                   {
  //                     $sum: [
  //                       "$industryMatch",
  //                       "$geographyMatch",
  //                       "$revenueMatch",
  //                       "$ebitdaMatch",
  //                       "$transactionSizeMatch",
  //                       "$businessModelMatch",
  //                       "$managementMatch",
  //                       "$yearsMatch",
  //                       "$revenueGrowthMatch",
  //                       "$stakeMatch",
  //                     ],
  //                   },
  //                   57, // Maximum possible score
  //                 ],
  //               },
  //               100,
  //             ],
  //           },
  //         },
  //       },
  //       {
  //         $project: {
  //           _id: 1,
  //           companyName: 1,
  //           buyerId: "$buyer",
  //           buyerName: "$buyerInfo.fullName",
  //           buyerEmail: "$buyerInfo.email",
  //           targetCriteria: 1,
  //           preferences: 1,
  //           totalMatchScore: 1,
  //           matchPercentage: { $round: ["$matchPercentage", 0] },
  //           matchDetails: {
  //             industryMatch: { $gt: ["$industryMatch", 0] },
  //             geographyMatch: { $gt: ["$geographyMatch", 0] },
  //             revenueMatch: { $gt: ["$revenueMatch", 0] },
  //             ebitdaMatch: { $gt: ["$ebitdaMatch", 0] },
  //             transactionSizeMatch: { $gt: ["$transactionSizeMatch", 0] },
  //             businessModelMatch: { $gt: ["$businessModelMatch", 0] },
  //             managementMatch: { $gt: ["$managementMatch", 0] },
  //             yearsMatch: { $gt: ["$yearsMatch", 0] },
  //             revenueGrowthMatch: { $gt: ["$revenueGrowthMatch", 0] },
  //             stakeMatch: { $gt: ["$stakeMatch", 0] },
  //           },
  //           matchScores: {
  //             industryMatch: "$industryMatch",
  //             geographyMatch: "$geographyMatch",
  //             revenueMatch: "$revenueMatch",
  //             ebitdaMatch: "$ebitdaMatch",
  //             transactionSizeMatch: "$transactionSizeMatch",
  //             businessModelMatch: "$businessModelMatch",
  //             managementMatch: "$managementMatch",
  //             yearsMatch: "$yearsMatch",
  //             revenueGrowthMatch: "$revenueGrowthMatch",
  //             stakeMatch: "$stakeMatch",
  //           },
  //         },
  //       },
  //       // Sort by match percentage in descending order
  //       { $sort: { matchPercentage: -1 } },
  //       // CRITICAL: Only include profiles where ALL mandatory criteria match
  //       // This means all 5 mandatory criteria must have points > 0
  //       {
  //         $match: {
  //           $and: [
  //             { industryMatch: { $gt: 0 } },           // Must match industry
  //             { geographyMatch: { $gt: 0 } },          // Must match geography  
  //             { revenueMatch: { $gt: 0 } },            // Must match revenue range
  //             { ebitdaMatch: { $gt: 0 } },             // Must match EBITDA range
  //             { transactionSizeMatch: { $gt: 0 } },    // Must match transaction size range
  //             { matchPercentage: { $gte: 20 } }        // Still maintain minimum 20% overall
  //           ]
  //         }
  //       },
  //     ])
  //     .exec()

  //   return matchingProfiles
  // }













  // -------------------------------------------------------------------------------------------------------------------------
  async targetDealToBuyers(dealId: string, buyerIds: string[]): Promise<Deal> {
    const deal = await this.dealModel.findById(dealId).exec() as DealDocument;

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
      const deal = await this.dealModel.findById(dealId).exec() as DealDocument;
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
      // Exclude completed deals unless specifically requested
      baseQuery.status = { $ne: DealStatus.COMPLETED }
    } else if (status === "rejected") {
      // Deals that were targeted to buyer but they rejected
      baseQuery.targetedBuyers = buyerId
      baseQuery.interestedBuyers = { $ne: buyerId }
      // Exclude completed deals unless specifically requested
      baseQuery.status = { $ne: DealStatus.COMPLETED }

      // Check invitation status for explicit rejections
      baseQuery.$or = [{ [`invitationStatus.${buyerId}.response`]: "rejected" }]
    } else if (status === "completed") {
      baseQuery.status = DealStatus.COMPLETED
      baseQuery.interestedBuyers = buyerId
    } else if (status === "pending") {
      // Deals targeted to buyer but no response yet, or explicitly set as pending
      baseQuery.targetedBuyers = buyerId
      // Exclude completed deals unless specifically requested
      baseQuery.status = { $ne: DealStatus.COMPLETED }
      baseQuery.$and = [
        {
          $or: [{ interestedBuyers: { $ne: buyerId } }, { [`invitationStatus.${buyerId}.response`]: "pending" }],
        },
        {
          [`invitationStatus.${buyerId}.response`]: { $ne: "rejected" },
        },
      ]
    } else {
      // Default case: exclude completed deals (similar to findBySeller behavior)
      baseQuery.status = { $ne: DealStatus.COMPLETED }
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

  // New method to get buyer interactions for a specific deal

  async getBuyerInteractionsForDeal(dealId: string): Promise<any[]> {
    try {
      console.log(`Fetching buyer interactions for dealId: ${dealId}`);
      const dealTrackingModel = this.dealModel.db.model('DealTracking');
      const pipeline: any[] = [
        {
          $match: {
            deal: new mongoose.Types.ObjectId(dealId),
            buyer: { $exists: true, $ne: null, $type: "objectId" } // Ensure valid buyer ObjectId
          }
        },
        {
          $lookup: {
            from: 'buyers',
            localField: 'buyer',
            foreignField: '_id',
            as: 'buyerInfo'
          }
        },
        {
          $unwind: { path: '$buyerInfo', preserveNullAndEmptyArrays: true }
        },
        {
          $lookup: {
            from: 'companyprofiles',
            localField: 'buyer',
            foreignField: 'buyer',
            as: 'companyInfo'
          }
        },
        {
          $unwind: { path: '$companyInfo', preserveNullAndEmptyArrays: true }
        },
        {
          $group: {
            _id: '$buyer',
            buyerName: { $first: '$buyerInfo.fullName' },
            buyerEmail: { $first: '$buyerInfo.email' },
            buyerCompany: { $first: '$buyerInfo.companyName' },
            companyType: { $first: '$companyInfo.companyType' },
            interactions: {
              $push: {
                type: '$interactionType',
                timestamp: '$timestamp',
                notes: '$notes',
                metadata: '$metadata'
              }
            },
            lastInteraction: { $max: '$timestamp' },
            totalInteractions: { $sum: 1 }
          }
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
                          input: '$interactions',
                          cond: { $eq: ['$$this.timestamp', '$lastInteraction'] }
                        }
                      },
                      0
                    ]
                  }
                },
                in: {
                  $switch: {
                    branches: [
                      { case: { $eq: ['$$lastInteraction.type', 'interest'] }, then: 'accepted' },
                      { case: { $eq: ['$$lastInteraction.type', 'view'] }, then: 'pending' },
                      { case: { $eq: ['$$lastInteraction.type', 'rejected'] }, then: 'rejected' },
                      { case: { $eq: ['$$lastInteraction.type', 'completed'] }, then: 'completed' }
                    ],
                    default: 'pending'
                  }
                }
              }
            }
          }
        },
        {
          $sort: { lastInteraction: -1 }
        },
        {
          $project: {
            buyerId: '$_id',
            buyerName: 1,
            buyerEmail: 1,
            buyerCompany: 1,
            companyType: 1,
            currentStatus: 1,
            lastInteraction: 1,
            totalInteractions: 1,
            interactions: { $slice: ['$interactions', -5] }
          }
        }
      ];
      const result = await dealTrackingModel.aggregate(pipeline).exec();
      console.log(`getBuyerInteractionsForDeal result: ${JSON.stringify(result, null, 2)}`);
      return result.filter(item => mongoose.isValidObjectId(item.buyerId));
    } catch (error) {
      console.error('Error in getBuyerInteractionsForDeal:', error);
      throw new InternalServerErrorException(`Failed to get buyer interactions: ${error.message}`);
    }
  }


  async getDocumentFile(dealId: string, filename: string): Promise<{ stream: fs.ReadStream; mimetype: string; originalName: string }> {
    const deal = await this.findOne(dealId);
    const document = deal.documents?.find((doc) => doc.filename === filename);
    if (!document) {
      throw new NotFoundException(`Document ${filename} not found for deal ${dealId}`);
    }
    const filePath = path.resolve(document.path);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`File ${filename} not found on server`);
    }
    return {
      stream: fs.createReadStream(filePath),
      mimetype: document.mimetype,
      originalName: document.originalName,
    };
  }

  async getDealWithBuyerStatusSummary(dealId: string): Promise<any> {
    try {
      console.log(`Fetching status summary for dealId: ${dealId}`);
      const deal = await this.dealModel.findById(dealId).lean();
      if (!deal) {
        throw new NotFoundException(`Deal with ID ${dealId} not found`);
      }
      console.log(`Raw deal.invitationStatus: ${JSON.stringify(deal.invitationStatus, null, 2)}`);

      // Use Object.entries directly since invitationStatus is already an object
      const invitationStatusObj = deal.invitationStatus || {};
      console.log(`invitationStatus keys: ${JSON.stringify(Object.keys(invitationStatusObj), null, 2)}`);

      const invitationStatusArray = Object.entries(invitationStatusObj)
        .filter(([buyerId]) => mongoose.isValidObjectId(buyerId))
        .map(([buyerId, status]) => ({
          buyerId,
          response: status.response,
        }));
      console.log(`Filtered invitationStatusArray: ${JSON.stringify(invitationStatusArray, null, 2)}`);

      const buyersByStatus: {
        active: BuyerStatus[];
        pending: BuyerStatus[];
        rejected: BuyerStatus[];
      } = {
        active: [],
        pending: [],
        rejected: [],
      };

      const buyerIds = new Set<string>();
      const buyerMap = new Map<string, BuyerStatus>();

      // Prepare company profile model
      const companyProfileModel = this.dealModel.db.model('CompanyProfile');

      // Process invitationStatus
      for (const { buyerId, response } of invitationStatusArray) {
        console.log(`Fetching buyer: ${buyerId}`);
        const [buyer, companyProfile] = await Promise.all([
          this.buyerModel
            .findById(buyerId)
            .select('fullName email companyName')
            .lean()
            .exec(),
          companyProfileModel.findOne({ buyer: buyerId }).lean(),
        ]);
        console.log(`Buyer ${buyerId}: ${JSON.stringify(buyer, null, 2)}`);
        console.log(`CompanyProfile ${buyerId}: ${JSON.stringify(companyProfile, null, 2)}`);
        if (!buyer) {
          console.warn(`Buyer with ID ${buyerId} not found`);
          continue;
        }
        // companyProfile may be an array if not using .findOne(), so handle both cases
        let resolvedCompanyName = '';
        if (companyProfile) {
          if (Array.isArray(companyProfile)) {
            resolvedCompanyName = companyProfile[0]?.companyName || '';
          } else {
            resolvedCompanyName = companyProfile.companyName || '';
          }
        }
        const companyName = resolvedCompanyName || buyer.companyName || '';
        const buyerData: BuyerStatus = {
          buyerId,
          buyerName: buyer.fullName || 'Unknown',
          buyerEmail: buyer.email || '',
          buyerCompany: companyName,
        };
        buyerMap.set(buyerId, buyerData);
        buyerIds.add(buyerId);
        switch (response) {
          case 'accepted':
            buyersByStatus.active.push(buyerData);
            break;
          case 'pending':
            buyersByStatus.pending.push(buyerData);
            break;
          case 'rejected':
            buyersByStatus.rejected.push(buyerData);
            break;
        }
      }

      // Process buyer interactions
      const buyerInteractions = await this.getBuyerInteractionsForDeal(dealId);
      console.log(`Buyer interactions: ${JSON.stringify(buyerInteractions, null, 2)}`);
      for (const interaction of buyerInteractions) {
        if (!mongoose.isValidObjectId(interaction.buyerId)) {
          console.warn(`Invalid buyerId in interactions: ${interaction.buyerId}`);
          continue;
        }
        // Fetch company profile for interaction as well
        const companyProfile = await companyProfileModel.findOne({ buyer: interaction.buyerId }).lean();
        // companyProfile may be an array if not using .findOne(), so handle both cases
        let resolvedCompanyNameInteraction = '';
        if (companyProfile) {
          if (Array.isArray(companyProfile)) {
            resolvedCompanyNameInteraction = companyProfile[0]?.companyName || '';
          } else {
            resolvedCompanyNameInteraction = companyProfile.companyName || '';
          }
        }
        const companyName = resolvedCompanyNameInteraction || interaction.buyerCompany || '';
        const existingBuyer = buyerMap.get(interaction.buyerId);
        const buyerData: BuyerStatus = {
          buyerId: interaction.buyerId,
          buyerName: interaction.buyerName || existingBuyer?.buyerName || 'Unknown',
          buyerEmail: interaction.buyerEmail || existingBuyer?.buyerEmail || '',
          buyerCompany: companyName,
          companyType: interaction.companyType,
          lastInteraction: interaction.lastInteraction,
          totalInteractions: interaction.totalInteractions,
          interactions: interaction.interactions,
        };
        if (!buyerIds.has(interaction.buyerId)) {
          buyerMap.set(interaction.buyerId, buyerData);
          buyerIds.add(interaction.buyerId);
          const status = interaction.currentStatus;
          switch (status) {
            case 'accepted':
            case 'completed':
              buyersByStatus.active.push(buyerData);
              break;
            case 'pending':
              buyersByStatus.pending.push(buyerData);
              break;
            case 'rejected':
              buyersByStatus.rejected.push(buyerData);
              break;
          }
        } else {
          // Update existing buyer with interaction details
          const existing = buyerMap.get(interaction.buyerId)!;
          existing.companyType = interaction.companyType || existing.companyType;
          existing.lastInteraction = interaction.lastInteraction || existing.lastInteraction;
          existing.totalInteractions = interaction.totalInteractions || existing.totalInteractions;
          existing.interactions = interaction.interactions || existing.interactions;
          existing.buyerCompany = companyName;
        }
      }

      // Debug: Print company names being sent in the status summary
      console.log('Active Buyers Company Names:', buyersByStatus.active.map(b => ({ buyerId: b.buyerId, company: b.buyerCompany })));
      console.log('Pending Buyers Company Names:', buyersByStatus.pending.map(b => ({ buyerId: b.buyerId, company: b.buyerCompany })));
      console.log('Rejected Buyers Company Names:', buyersByStatus.rejected.map(b => ({ buyerId: b.buyerId, company: b.buyerCompany })));

      const result = {
        deal,
        buyersByStatus,
        summary: {
          totalTargeted: buyerIds.size,
          totalActive: buyersByStatus.active.length,
          totalPending: buyersByStatus.pending.length,
          totalRejected: buyersByStatus.rejected.length,
        },
      };
      console.log(`getDealWithBuyerStatusSummary result: ${JSON.stringify(result, null, 2)}`);
      return result;
    } catch (error) {
      console.error('Error in getDealWithBuyerStatusSummary:', error);
      throw new InternalServerErrorException(`Failed to get deal with buyer status: ${error.message}`);
    }
  }

  async closeDealseller(
    dealId: string,
    sellerId: string,
    finalSalePrice?: number,
    notes?: string,
    winningBuyerId?: string,
  ): Promise<Deal> {
    console.log(`closeDealseller called with:`, { dealId, sellerId, finalSalePrice, notes, winningBuyerId });

    const dealDoc = await this.dealModel.findById(dealId).exec();
    if (!dealDoc) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }

    console.log(`Found deal:`, { dealId: dealDoc._id, dealSeller: dealDoc.seller });

    if (dealDoc.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to close this deal");
    }

    dealDoc.status = DealStatus.COMPLETED;
    dealDoc.timeline.completedAt = new Date();
    dealDoc.timeline.updatedAt = new Date();

    if (finalSalePrice !== undefined && finalSalePrice !== null) {
      if (!dealDoc.financialDetails || typeof dealDoc.financialDetails !== 'object') {
        dealDoc.financialDetails = {};
      }
      dealDoc.financialDetails.finalSalePrice = finalSalePrice;
      dealDoc.markModified('financialDetails');
      console.log(`Setting finalSalePrice to: ${finalSalePrice}`);
      console.log(`financialDetails after update:`, dealDoc.financialDetails);
    }

    const dealTrackingModel = this.dealModel.db.model('DealTracking');
    const trackingData: any = {
      deal: dealId,
      interactionType: 'completed',
      timestamp: new Date(),
      notes: notes || 'Deal closed by seller',
      metadata: { finalSalePrice, winningBuyerId },
    };

    if (winningBuyerId) {
      trackingData.buyer = winningBuyerId;
    }

    const tracking = new dealTrackingModel(trackingData);
    await tracking.save();
    const savedDeal = await dealDoc.save();

    console.log(`Deal closed successfully:`, { dealId, status: savedDeal.status });
    return savedDeal;
  }

  async getDetailedBuyerActivity(dealId: string): Promise<any> {
    try {
      const dealTrackingModel = this.dealModel.db.model('DealTracking');

      const pipeline: any[] = [
        { $match: { deal: new Types.ObjectId(dealId) } },
        {
          $lookup: {
            from: 'buyers',
            localField: 'buyer',
            foreignField: '_id',
            as: 'buyerInfo',
          },
        },
        { $unwind: { path: '$buyerInfo', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'companyprofiles',
            localField: 'buyer',
            foreignField: 'buyer',
            as: 'companyInfo',
          },
        },
        {
          $unwind: {
            path: '$companyInfo',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            _id: 1,
            buyerId: '$buyer',
            buyerName: '$buyerInfo.fullName',
            buyerEmail: '$buyerInfo.email',
            buyerCompany: '$buyerInfo.companyName',
            companyType: '$companyInfo.companyType',
            interactionType: 1,
            timestamp: 1,
            notes: 1,
            metadata: 1,
            actionDescription: {
              $switch: {
                branches: [
                  { case: { $eq: ['$interactionType', 'interest'] }, then: 'Showed Interest (Activated)' },
                  { case: { $eq: ['$interactionType', 'rejected'] }, then: 'Rejected Deal' },
                  { case: { $eq: ['$interactionType', 'view'] }, then: 'Set as Pending' },
                  { case: { $eq: ['$interactionType', 'completed'] }, then: 'Deal Completed' },
                ],
                default: 'Other Action',
              },
            },
          },
        },
        { $sort: { timestamp: -1 } },
      ];

      const activities = await dealTrackingModel.aggregate(pipeline).exec();

      const summary = {
        totalActivated: activities.filter((a) => a.interactionType === 'interest').length,
        totalRejected: activities.filter((a) => a.interactionType === 'rejected').length,
        totalPending: activities.filter((a) => a.interactionType === 'view').length,
        uniqueBuyers: [...new Set(activities.map((a) => a.buyerId?.toString()))].length,
      };

      return {
        activities,
        summary,
        deal: await this.findOne(dealId),
      };
    } catch (error) {
      console.error('Error in getDetailedBuyerActivity:', error);
      throw new InternalServerErrorException(`Failed to get detailed buyer activity: ${error.message}`);
    }
  }

  async getRecentBuyerActionsForSeller(sellerId: string, limit: number = 20): Promise<any[]> {
    try {
      const sellerDeals = await this.dealModel.find({ seller: sellerId }, { _id: 1, title: 1 }).exec();
      const dealIds = sellerDeals.map((deal) => deal._id);

      const dealTrackingModel = this.dealModel.db.model('DealTracking');

      const pipeline: any[] = [
        {
          $match: {
            deal: { $in: dealIds },
            interactionType: { $in: ['interest', 'rejected', 'view'] },
          },
        },
        {
          $lookup: {
            from: 'buyers',
            localField: 'buyer',
            foreignField: '_id',
            as: 'buyerInfo',
          },
        },
        { $unwind: { path: '$buyerInfo', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'deals',
            localField: 'deal',
            foreignField: '_id',
            as: 'dealInfo',
          },
        },
        { $unwind: { path: '$dealInfo', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            dealId: '$deal',
            dealTitle: '$dealInfo.title',
            buyerId: '$buyer',
            buyerName: '$buyerInfo.fullName',
            buyerCompany: '$buyerInfo.companyName',
            interactionType: 1,
            timestamp: 1,
            notes: 1,
            actionDescription: {
              $switch: {
                branches: [
                  { case: { $eq: ['$interactionType', 'interest'] }, then: 'Activated Deal' },
                  { case: { $eq: ['$interactionType', 'rejected'] }, then: 'Rejected Deal' },
                  { case: { $eq: ['$interactionType', 'view'] }, then: 'Set as Pending' },
                ],
                default: 'Other Action',
              },
            },
            actionColor: {
              $switch: {
                branches: [
                  { case: { $eq: ['$interactionType', 'interest'] }, then: 'green' },
                  { case: { $eq: ['$interactionType', 'rejected'] }, then: 'red' },
                  { case: { $eq: ['$interactionType', 'view'] }, then: 'yellow' },
                ],
                default: 'gray',
              },
            },
          },
        },
        { $sort: { timestamp: -1 } },
        { $limit: limit },
      ];

      return await dealTrackingModel.aggregate(pipeline).exec();
    } catch (error) {
      console.error('Error in getRecentBuyerActionsForSeller:', error);
      throw new InternalServerErrorException(`Failed to get recent buyer actions: ${error.message}`);
    }
  }

  async getInterestedBuyersDetails(dealId: string): Promise<any[]> {
    try {
      const deal = await this.dealModel.findById(dealId).exec() as DealDocument;

      if (!deal.interestedBuyers || deal.interestedBuyers.length === 0) {
        return [];
      }

      const dealTrackingModel = this.dealModel.db.model('DealTracking');

      const pipeline: any[] = [
        { $match: { _id: { $in: deal.interestedBuyers } } },
        {
          $lookup: {
            from: 'companyprofiles',
            localField: '_id',
            foreignField: 'buyer',
            as: 'companyInfo',
          },
        },
        {
          $unwind: {
            path: '$companyInfo',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            _id: 1,
            fullName: 1,
            email: 1,
            companyName: '$companyInfo.companyName',
            companyType: '$companyInfo.companyType',
            website: '$companyInfo.website',
          },
        },
      ];

      const interestedBuyers = await this.buyerModel.aggregate(pipeline).exec();

      for (const buyer of interestedBuyers) {
        const interactions = await dealTrackingModel
          .find({
            deal: dealId,
            buyer: buyer._id,
          })
          .sort({ timestamp: -1 })
          .limit(5)
          .exec();

        buyer.recentInteractions = interactions;
        buyer.lastInteraction = interactions[0]?.timestamp;
        buyer.totalInteractions = interactions.length;
      }

      return interestedBuyers.sort(
        (a, b) => new Date(b.lastInteraction || 0).getTime() - new Date(a.lastInteraction || 0).getTime(),
      );
    } catch (error) {
      console.error('Error in getInterestedBuyersDetails:', error);
      throw new InternalServerErrorException(`Failed to get interested buyers details: ${error.message}`);
    }
  }

  async getAllCompletedDeals(): Promise<Deal[]> {
    try {
      return await this.dealModel.find({ status: 'completed' }).select('+rewardLevel').exec();
    } catch (error) {
      console.error('Error in getAllCompletedDeals:', error);
      throw new InternalServerErrorException(`Failed to fetch completed deals: ${error.message}`);
    }
  }

  async getAllActiveDealsWithAccepted(): Promise<Deal[]> {
    try {
      console.log('Fetching deals with accepted invitations');
      const result = await this.dealModel
        .aggregate([
          {
            $addFields: {
              invitationStatusArray: { $objectToArray: '$invitationStatus' },
            },
          },
          {
            $match: {
              'invitationStatusArray.v.response': 'accepted',
            },
          },
          {
            $project: {
              invitationStatusArray: 0
            },
          },
        ])
        .exec();
      console.log('Deals with accepted invitations:', result);
      return result;
    } catch (error) {
      console.error('Error in getAllActiveDealsWithAccepted:', error);
      throw new InternalServerErrorException(`Failed to fetch deals with accepted invitations: ${error.message}`);
    }
  }

  async getBuyerEngagementDashboard(sellerId: string): Promise<any> {
    try {
      const deals = await this.dealModel.find({ seller: sellerId }).exec();
      const dealIds = deals.map((deal) => deal._id);

      const dealTrackingModel = this.dealModel.db.model('DealTracking');

      const engagementStats = await dealTrackingModel
        .aggregate([
          { $match: { deal: { $in: dealIds } } },
          {
            $group: {
              _id: '$interactionType',
              count: { $sum: 1 },
              uniqueBuyers: { $addToSet: '$buyer' },
            },
          },
          {
            $project: {
              interactionType: '$_id',
              count: 1,
              uniqueBuyersCount: { $size: '$uniqueBuyers' },
            },
          },
        ])
        .exec();

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
                $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
              },
              activations: {
                $sum: { $cond: [{ $eq: ['$interactionType', 'interest'] }, 1, 0] },
              },
              rejections: {
                $sum: { $cond: [{ $eq: ['$interactionType', 'rejected'] }, 1, 0] },
              },
              views: {
                $sum: { $cond: [{ $eq: ['$interactionType', 'view'] }, 1, 0] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .exec();

      const topDeals = await dealTrackingModel
        .aggregate([
          { $match: { deal: { $in: dealIds } } },
          {
            $group: {
              _id: '$deal',
              totalInteractions: { $sum: 1 },
              activations: {
                $sum: { $cond: [{ $eq: ['$interactionType', 'interest'] }, 1, 0] },
              },
              uniqueBuyers: { $addToSet: '$buyer' },
            },
          },
          {
            $lookup: {
              from: 'deals',
              localField: '_id',
              foreignField: '_id',
              as: 'dealInfo',
            },
          },
          { $unwind: { path: '$dealInfo', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              dealId: '$_id',
              dealTitle: '$dealInfo.title',
              totalInteractions: 1,
              activations: 1,
              uniqueBuyersCount: { $size: '$uniqueBuyers' },
              engagementRate: {
                $multiply: [{ $divide: ['$activations', '$totalInteractions'] }, 100],
              },
            },
          },
          { $sort: { engagementRate: -1 } },
          { $limit: 5 },
        ])
        .exec();

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
          totalActivations: engagementStats.find((s) => s.interactionType === 'interest')?.count || 0,
          totalRejections: engagementStats.find((s) => s.interactionType === 'rejected')?.count || 0,
          totalViews: engagementStats.find((s) => s.interactionType === 'view')?.count || 0,
          uniqueEngagedBuyers: [...new Set(engagementStats.flatMap((s) => s.uniqueBuyers || []))].length,
        },
      };
    } catch (error) {
      console.error('Error in getBuyerEngagementDashboard:', error);
      throw new InternalServerErrorException(`Failed to get buyer engagement dashboard: ${error.message}`);
    }
  }
}
