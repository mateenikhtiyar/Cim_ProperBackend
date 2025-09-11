import { ForbiddenException, Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from "@nestjs/common"
import { Deal, DealDocumentType as DealDocument, DealStatus } from "./schemas/deal.schema"
import { CreateDealDto } from "./dto/create-deal.dto"
import { UpdateDealDto } from "./dto/update-deal.dto"
import { Buyer } from '../buyers/schemas/buyer.schema';
import { Seller } from '../sellers/schemas/seller.schema';
import * as fs from "fs"
import * as path from 'path';
import mongoose, { Model, Types } from 'mongoose';
import { InjectModel } from "@nestjs/mongoose"
import { expandCountryOrRegion } from '../common/geography-hierarchy';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { MailService } from '../mail/mail.service';
import { genericEmailTemplate } from '../mail/generic-email.template';
import { ILLUSTRATION_ATTACHMENT } from '../mail/mail.service';


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
    @InjectModel('Seller') private sellerModel: Model<Seller>,
    private mailService: MailService,
  ) { }


  async create(createDealDto: CreateDealDto): Promise<Deal> {
    try {
      // Remove all debug logs
      // Ensure documents field is properly set
      const dealData = {
        ...createDealDto,
        documents: createDealDto.documents || [], // This will now contain the file paths
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const createdDeal = new this.dealModel(dealData)
      const savedDeal = await createdDeal.save()

      // Send email to seller
      const seller = await this.sellerModel.findById(savedDeal.seller).exec();
      if (seller) {
        const subject = "Thank you for adding a new deal to CIM Amplify!";
        const emailContent = `
          <p>Dear ${seller.fullName},</p>
          <p>We are truly excited to help you find a great buyer for your deal.</p>
          <p>We will let you know via email when your selected buyers change from pending to viewed to pass. You can also check your <a href="${process.env.FRONTEND_URL}/seller/login">dashboard</a> at any time to see buyer activity.</p>
          <p>Please help us to keep the platform up to date by clicking the <b>Off Market button</b> when the deal is sold or paused. If sold to one of our introduced buyers we will be in touch to arrange payment of your reward!</p>
          <p>Finally, If your deal did not fetch any buyers, we are always adding new buyers that may match in the future. To watch for new matches simply click Activity on the deal card and then click on the <b>Invite More Buyers</b> button.</p>
        `;
        const emailBody = genericEmailTemplate('CIM Amplify', seller.fullName, emailContent);

        await this.mailService.sendEmailWithLogging(
          seller.email,
          'seller',
          subject,
          emailBody, // Use the formatted email body
          [ILLUSTRATION_ATTACHMENT], // attachments
          (savedDeal._id as Types.ObjectId).toString(), // relatedDealId
        );
      }

      // Send email to project owner
      const ownerSubject = `New Deal (${savedDeal.title})`;
      const trailingRevenueAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(savedDeal.financialDetails?.trailingRevenueAmount || 0);
      const trailingEBITDAAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(savedDeal.financialDetails?.trailingEBITDAAmount || 0);
      const ownerHtmlBody = genericEmailTemplate(ownerSubject, 'John', `
        <p><b>Description</b>: ${savedDeal.companyDescription}</p>
        <p><b>T12 Revenue</b>: ${trailingRevenueAmount}</p>
        <p><b>T12 EBITDA</b>: ${trailingEBITDAAmount}</p>
      `);
      await this.mailService.sendEmailWithLogging(
        'johnm@cimamplify.com',
        'admin',
        ownerSubject,
        ownerHtmlBody,
        [ILLUSTRATION_ATTACHMENT],
        (savedDeal._id as Types.ObjectId).toString(),
      );
      
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
    // If admin, allow marking as completed regardless of seller
    if (userRole === 'admin' && updateDealDto.status === DealStatus.COMPLETED) {
      deal.status = DealStatus.COMPLETED;
      if (deal.status !== DealStatus.COMPLETED) {
        deal.timeline.completedAt = new Date();
      }
      deal.timeline.updatedAt = new Date();
      await deal.save();
      return deal;
    }
    // Remove all debug logs
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
    const { documents, ...updateDataWithoutDocuments } = updateDealDto;
    // Only update provided fields, do not overwrite required fields with undefined
    for (const [key, value] of Object.entries(updateDataWithoutDocuments)) {
      if (typeof value !== "undefined") {
        (deal as any)[key] = value;
      }
    }
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

  // async findMatchingBuyers(dealId: string): Promise<any[]> {
  //   const deal = await this.findOne(dealId);
  //   const companyProfileModel = this.dealModel.db.model('CompanyProfile');
  //   const expandedGeos = expandCountryOrRegion(deal.geographySelection);
  //   const { rewardLevel } = deal;
  //   let extraMatchCondition: any = {};
  //   if (rewardLevel === "Seed") {
  //     extraMatchCondition = {
  //       "preferences.doNotSendMarketedDeals": { $ne: true }
  //     };
  //   }
  //   // Get only real buyer IDs from invitationStatus (Map or object)
  //   const alreadyInvitedBuyerIds = deal.invitationStatus instanceof Map
  //     ? Array.from(deal.invitationStatus.keys())
  //     : Object.keys(deal.invitationStatus || {});
  //   console.log('DEBUG: alreadyInvitedBuyerIds:', alreadyInvitedBuyerIds);
  //   const companyProfiles = await companyProfileModel.find({}).lean();
  //   console.log('DEBUG: CompanyProfile buyers:', companyProfiles.map(cp => cp.buyer));
  //   const mandatoryQuery: any = {
  //     "preferences.stopSendingDeals": { $ne: true },
  //     "targetCriteria.countries": { $in: expandedGeos },
  //     "targetCriteria.industrySectors": deal.industrySector,
  //     ...extraMatchCondition,
  //   };
  //   const matchingProfiles = await companyProfileModel.aggregate([
  //     { $match: mandatoryQuery },
  //     ...(alreadyInvitedBuyerIds.length > 0
  //       ? [
  //           {
  //             $addFields: {
  //               buyerStr: { $toString: "$buyer" }
  //             }
  //           },
  //           { $match: { buyerStr: { $nin: alreadyInvitedBuyerIds } } }
  //         ]

  //       : []),
  //     {
  //       $lookup: {
  //         from: 'buyers',
  //         localField: 'buyer',
  //         foreignField: '_id',
  //         as: 'buyerInfo',
  //       },
  //     },
  //     { $unwind: '$buyerInfo' },
  //     {
  //       $addFields: {
  //         industryMatch: 10,
  //         geographyMatch: 10,
  //         revenueMatch: {
  //           $cond: [
  //             {
  //               $and: [
  //                 {
  //                   $or: [
  //                     { $eq: [{ $ifNull: ["$targetCriteria.revenueMin", null] }, null] },
  //                     { $gte: [{ $ifNull: [deal.financialDetails?.trailingRevenueAmount || 0, 0] }, { $ifNull: ["$targetCriteria.revenueMin", 0] }] }
  //                   ]
  //                 },
  //                 {
  //                   $or: [
  //                     { $eq: [{ $ifNull: ["$targetCriteria.revenueMax", null] }, null] },
  //                     { $lte: [{ $ifNull: [deal.financialDetails?.trailingRevenueAmount || 0, 0] }, { $ifNull: ["$targetCriteria.revenueMax", Number.MAX_SAFE_INTEGER] }] }
  //                   ]
  //                 }
  //               ]
  //             },
  //             8, 0
  //           ]
  //         },
  //         ebitdaMatch: {
  //           $cond: [
  //             {
  //               $and: [
  //                 {
  //                   $or: [
  //                     { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMin", null] }, null] },
  //                     {
  //                       $cond: [
  //                         { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMin", 0] }, 0] },
  //                         { $gte: [{ $ifNull: [deal.financialDetails?.trailingEBITDAAmount || 0, 0] }, 0] },
  //                         { $gte: [{ $ifNull: [deal.financialDetails?.trailingEBITDAAmount || 0, 0] }, { $ifNull: ["$targetCriteria.ebitdaMin", 0] }] }
  //                       ]
  //                     }
  //                   ]
  //                 },
  //                 {
  //                   $or: [
  //                     { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMax", null] }, null] },
  //                     { $lte: [{ $ifNull: [deal.financialDetails?.trailingEBITDAAmount || 0, 0] }, { $ifNull: ["$targetCriteria.ebitdaMax", Number.MAX_SAFE_INTEGER] }] }
  //                   ]
  //                 }
  //               ]
  //             },
  //             8, 0
  //           ]
  //         },
  //         revenueGrowthMatch: {
  //           $cond: [
  //             {
  //               $or: [
  //                 { $eq: [{ $ifNull: ["$targetCriteria.revenueGrowth", null] }, null] },
  //                 { $gte: [{ $ifNull: [deal.financialDetails?.avgRevenueGrowth || 0, 0] }, { $ifNull: ["$targetCriteria.revenueGrowth", 0] }] }
  //               ]
  //             },
  //             5, 0
  //           ]
  //         },
  //         yearsMatch: {
  //           $cond: [
  //             {
  //               $or: [
  //                 { $eq: [{ $ifNull: ["$targetCriteria.minYearsInBusiness", null] }, null] },
  //                 { $gte: [deal.yearsInBusiness || 0, { $ifNull: ["$targetCriteria.minYearsInBusiness", 0] }] }
  //               ]
  //             },
  //             5, 0
  //           ]
  //         },
  //         businessModelMatch: {
  //           $cond: [
  //             {
  //               $or: [
  //                 {
  //                   $and: [
  //                     { $eq: [deal.businessModel?.recurringRevenue || false, true] },
  //                     { $in: ["Recurring Revenue", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
  //                   ]
  //                 },
  //                 {
  //                   $and: [
  //                     { $eq: [deal.businessModel?.projectBased || false, true] },
  //                     { $in: ["Project-Based", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
  //                   ]
  //                 },
  //                 {
  //                   $and: [
  //                     { $eq: [deal.businessModel?.assetLight || false, true] },
  //                     { $in: ["Asset Light", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
  //                   ]
  //                 },
  //                 {
  //                   $and: [
  //                     { $eq: [deal.businessModel?.assetHeavy || false, true] },
  //                     { $in: ["Asset Heavy", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
  //                   ]
  //                 }
  //               ]
  //             },
  //             12, 0
  //           ]
  //         },
  //         capitalAvailabilityMatch: {
  //           $cond: [
  //             {
  //               $or: [
  //                 { $eq: [{ $ifNull: [deal.buyerFit?.capitalAvailability || [], null] }, null] },
  //                 { $eq: [{ $size: { $ifNull: [deal.buyerFit?.capitalAvailability || [], []] } }, 0] },
  //                 { $in: ["$capitalEntity", deal.buyerFit?.capitalAvailability || []] }
  //               ]
  //             },
  //             4, 0
  //           ]
  //         },
  //         companyTypeMatch: {
  //           $cond: [
  //             {
  //               $or: [
  //                 { $eq: [{ $ifNull: [deal.companyType || [], null] }, null] },
  //                 { $eq: [{ $size: { $ifNull: [deal.companyType || [], []] } }, 0] },
  //                 { $in: ["$companyType", deal.companyType || []] }
  //               ]
  //             },
  //             4, 0
  //           ]
  //         },
  //         minTransactionSizeMatch: {
  //           $cond: [
  //             {
  //               $and: [
  //                 { $gte: [deal.buyerFit?.minTransactionSize || 0, { $ifNull: ["$targetCriteria.transactionSizeMin", 0] }] },
  //                 { $lte: [deal.buyerFit?.minTransactionSize || 0, { $ifNull: ["$targetCriteria.transactionSizeMax", Number.MAX_SAFE_INTEGER] }] }
  //               ]
  //             },
  //             5, 0
  //           ]
  //         },
  //         priorAcquisitionsMatch: {
  //           $cond: [
  //             {
  //               $or: [
  //                 { $eq: [{ $ifNull: [deal.buyerFit?.minPriorAcquisitions || null, null] }, null] },
  //                 { $gte: [{ $ifNull: ["$dealsCompletedLast5Years", 0] }, { $ifNull: [deal.buyerFit?.minPriorAcquisitions || 0, 0] }] }
  //               ]
  //             },
  //             5, 0
  //           ]
  //         },
  //         stakePercentageMatch: {
  //           $cond: [
  //             {
  //               $or: [
  //                 { $eq: [{ $ifNull: ["$targetCriteria.minStakePercent", null] }, null] },
  //                 { $eq: [{ $ifNull: [deal.stakePercentage || null, null] }, null] },
  //                 { $gte: [{ $ifNull: [deal.stakePercentage || 100, 100] }, { $ifNull: ["$targetCriteria.minStakePercent", 0] }] }
  //               ]
  //             },
  //             4, 0
  //           ]
  //         }
  //       }
  //     },
  //     {
  //       $addFields: {
  //         totalMatchScore: {
  //           $sum: [
  //             "$industryMatch",
  //             "$geographyMatch",
  //             "$revenueMatch",
  //             "$ebitdaMatch",
  //             "$revenueGrowthMatch",
  //             "$yearsMatch",
  //             "$businessModelMatch",
  //             "$capitalAvailabilityMatch",
  //             "$companyTypeMatch",
  //             "$minTransactionSizeMatch",
  //             "$priorAcquisitionsMatch",
  //             "$stakePercentageMatch"
  //           ]
  //         },
  //         matchPercentage: {
  //           $multiply: [
  //             {
  //               $divide: [
  //                 {
  //                   $sum: [
  //                     "$industryMatch",
  //                     "$geographyMatch",
  //                     "$revenueMatch",
  //                     "$ebitdaMatch",
  //                     "$revenueGrowthMatch",
  //                     "$yearsMatch",
  //                     "$businessModelMatch",
  //                     "$capitalAvailabilityMatch",
  //                     "$companyTypeMatch",
  //                     "$minTransactionSizeMatch",
  //                     "$priorAcquisitionsMatch",
  //                     "$stakePercentageMatch"
  //                   ]
  //                 },
  //                 80 // 10+10+8+8+5+5+12+4+4+5+5+4 = 80
  //               ]
  //             },
  //             100
  //           ]
  //         }
  //       }
  //     },
  //     { $match: { matchPercentage: { $gte: 100 } } },
  //     {
  //       $project: {
  //         _id: 1,
  //         companyName: 1,
  //         buyerId: "$buyer",
  //         buyerName: "$buyerInfo.fullName",
  //         buyerEmail: "$buyerInfo.email",
  //         targetCriteria: 1,
  //         preferences: 1,
  //         companyType: 1,
  //         capitalEntity: 1,
  //         dealsCompletedLast5Years: 1,
  //         averageDealSize: 1,
  //         totalMatchScore: 1,
  //         matchPercentage: { $round: ["$matchPercentage", 0] },
  //         website: "$website",
  //         matchScores: {
  //           industryMatch: "$industryMatch",
  //           geographyMatch: "$geographyMatch",
  //           revenueMatch: "$revenueMatch",
  //           ebitdaMatch: "$ebitdaMatch",
  //           revenueGrowthMatch: "$revenueGrowthMatch",
  //           yearsMatch: "$yearsMatch",
  //           businessModelMatch: "$businessModelMatch",
  //           capitalAvailabilityMatch: "$capitalAvailabilityMatch",
  //           companyTypeMatch: "$companyTypeMatch",
  //           minTransactionSizeMatch: "$minTransactionSizeMatch",
  //           priorAcquisitionsMatch: "$priorAcquisitionsMatch",
  //           stakePercentageMatch: "$stakePercentageMatch"
  //         },
  //         matchDetails: {
  //           industryMatch: true,
  //           geographyMatch: true,
  //           revenueMatch: { $gt: ["$revenueMatch", 0] },
  //           ebitdaMatch: { $gt: ["$ebitdaMatch", 0] },
  //           revenueGrowthMatch: { $gt: ["$revenueGrowthMatch", 0] },
  //           yearsMatch: { $gt: ["$yearsMatch", 0] },
  //           businessModelMatch: { $gt: ["$businessModelMatch", 0] },
  //           capitalAvailabilityMatch: { $gt: ["$capitalAvailabilityMatch", 0] },
  //           companyTypeMatch: { $gt: ["$companyTypeMatch", 0] },
  //           minTransactionSizeMatch: { $gt: ["$minTransactionSizeMatch", 0] },
  //           priorAcquisitionsMatch: { $gt: ["$priorAcquisitionsMatch", 0] },
  //           stakePercentageMatch: { $gt: ["$stakePercentageMatch", 0] }
  //         },
  //         criteriaDetails: {
  //           dealIndustry: deal.industrySector,
  //           dealGeography: deal.geographySelection,
  //           dealRevenue: deal.financialDetails?.trailingRevenueAmount || null,
  //           dealEbitda: deal.financialDetails?.trailingEBITDAAmount || null,
  //           dealAvgRevenueGrowth: deal.financialDetails?.avgRevenueGrowth || null,
  //           dealYearsInBusiness: deal.yearsInBusiness || null,
  //           dealStakePercentage: deal.stakePercentage || null,
  //           dealCompanyType: deal.companyType || [],
  //           dealCapitalAvailability: deal.buyerFit?.capitalAvailability || [],
  //           dealMinTransactionSize: deal.buyerFit?.minTransactionSize || null,
  //           dealMinPriorAcquisitions: deal.buyerFit?.minPriorAcquisitions || null,
  //           dealRewardLevel: deal.rewardLevel,
  //           expandedGeographies: expandedGeos
  //         }
  //       }
  //     },
  //     { $sort: { matchPercentage: -1, companyName: 1 } }
  //   ]).exec();
  //   return matchingProfiles;
  // }















  // -------------------------------------------------------------------------------------------------------------------------



  async findMatchingBuyers(dealId: string): Promise<any[]> {
    const deal = await this.findOne(dealId);
    const companyProfileModel = this.dealModel.db.model('CompanyProfile');
    const expandedGeos = expandCountryOrRegion(deal.geographySelection);
    const { rewardLevel } = deal;
    let extraMatchCondition: any = {};
    if (rewardLevel === "Seed") {
      extraMatchCondition = {
        "preferences.doNotSendMarketedDeals": { $ne: true }
      };
    }
    // Get only real buyer IDs from invitationStatus (Map or object)
    const alreadyInvitedBuyerIds = deal.invitationStatus instanceof Map
      ? Array.from(deal.invitationStatus.keys())
      : Object.keys(deal.invitationStatus || {});
    console.log('DEBUG: alreadyInvitedBuyerIds:', alreadyInvitedBuyerIds);
    const companyProfiles = await companyProfileModel.find({}).lean();
    console.log('DEBUG: CompanyProfile buyers:', companyProfiles.map(cp => cp.buyer));
    const mandatoryQuery: any = {
      "preferences.stopSendingDeals": { $ne: true },
      "targetCriteria.countries": { $in: expandedGeos },
      "targetCriteria.industrySectors": deal.industrySector,
      ...extraMatchCondition,
    };
    const matchingProfiles = await companyProfileModel.aggregate([
      { $match: mandatoryQuery },
      ...(alreadyInvitedBuyerIds.length > 0
        ? [
          {
            $addFields: {
              buyerStr: { $toString: "$buyer" }
            }
          },
          { $match: { buyerStr: { $nin: alreadyInvitedBuyerIds } } }
        ]
        : []),
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
          industryMatch: 10,
          geographyMatch: 10,
          // UPDATED: Revenue match - only check if deal revenue is <= buyer's max (ignore min)
          revenueMatch: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $ifNull: ["$targetCriteria.revenueMax", null] }, null] },
                  { $lte: [{ $ifNull: [deal.financialDetails?.trailingRevenueAmount || 0, 0] }, { $ifNull: ["$targetCriteria.revenueMax", Number.MAX_SAFE_INTEGER] }] }
                ]
              },
              8, 0
            ]
          },
          // UPDATED: EBITDA match - only check if deal EBITDA is <= buyer's max (ignore min)
          ebitdaMatch: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMax", null] }, null] },
                  { $lte: [{ $ifNull: [deal.financialDetails?.trailingEBITDAAmount || 0, 0] }, { $ifNull: ["$targetCriteria.ebitdaMax", Number.MAX_SAFE_INTEGER] }] }
                ]
              },
              8, 0
            ]
          },
          revenueGrowthMatch: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $ifNull: ["$targetCriteria.revenueGrowth", null] }, null] },
                  { $gte: [{ $ifNull: [deal.financialDetails?.avgRevenueGrowth || 0, 0] }, { $ifNull: ["$targetCriteria.revenueGrowth", 0] }] }
                ]
              },
              5, 0
            ]
          },
          yearsMatch: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $ifNull: ["$targetCriteria.minYearsInBusiness", null] }, null] },
                  { $gte: [deal.yearsInBusiness || 0, { $ifNull: ["$targetCriteria.minYearsInBusiness", 0] }] }
                ]
              },
              5, 0
            ]
          },
          businessModelMatch: {
            $cond: [
              {
                $or: [
                  {
                    $and: [
                      { $eq: [deal.businessModel?.recurringRevenue || false, true] },
                      { $in: ["Recurring Revenue", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
                    ]
                  },
                  {
                    $and: [
                      { $eq: [deal.businessModel?.projectBased || false, true] },
                      { $in: ["Project-Based", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
                    ]
                  },
                  {
                    $and: [
                      { $eq: [deal.businessModel?.assetLight || false, true] },
                      { $in: ["Asset Light", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
                    ]
                  },
                  {
                    $and: [
                      { $eq: [deal.businessModel?.assetHeavy || false, true] },
                      { $in: ["Asset Heavy", { $ifNull: ["$targetCriteria.preferredBusinessModels", []] }] }
                    ]
                  }
                ]
              },
              12, 0
            ]
          },
          capitalAvailabilityMatch: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $ifNull: [deal.buyerFit?.capitalAvailability || [], null] }, null] },
                  { $eq: [{ $size: { $ifNull: [deal.buyerFit?.capitalAvailability || [], []] } }, 0] },
                  { $in: ["$capitalEntity", deal.buyerFit?.capitalAvailability || []] }
                ]
              },
              4, 0
            ]
          },
          companyTypeMatch: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $ifNull: [deal.companyType || [], null] }, null] },
                  { $eq: [{ $size: { $ifNull: [deal.companyType || [], []] } }, 0] },
                  { $in: ["$companyType", deal.companyType || []] }
                ]
              },
              4, 0
            ]
          },
          minTransactionSizeMatch: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $ifNull: ["$targetCriteria.transactionSizeMax", null] }, null] }, // If buyer has no max transaction size, consider it a match.
                  { $lte: [deal.financialDetails?.askingPrice || 0, { $ifNull: ["$targetCriteria.transactionSizeMax", Number.MAX_SAFE_INTEGER] }] }
                ]
              },
              5, 0
            ]
          },
          priorAcquisitionsMatch: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $ifNull: [deal.buyerFit?.minPriorAcquisitions || null, null] }, null] },
                  { $gte: [{ $ifNull: ["$dealsCompletedLast5Years", 0] }, { $ifNull: [deal.buyerFit?.minPriorAcquisitions || 0, 0] }] }
                ]
              },
              5, 0
            ]
          },
          stakePercentageMatch: {
            $cond: [
              {
                $or: [
                  { $eq: [{ $ifNull: ["$targetCriteria.minStakePercent", null] }, null] },
                  { $eq: [{ $ifNull: [deal.stakePercentage || null, null] }, null] },
                  { $gte: [{ $ifNull: [deal.stakePercentage || 100, 100] }, { $ifNull: ["$targetCriteria.minStakePercent", 0] }] }
                ]
              },
              4, 0
            ]
          }
        }
      },
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
                  80 // 10+10+8+8+5+5+12+4+4+5+5+4 = 80
                ]
              },
              100
            ]
          }
        }
      },
      { $match: { matchPercentage: { $gte: 100 } } },
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
          website: "$website",
          matchScores: {
            industryMatch: "$industryMatch",
            geographyMatch: "$geographyMatch",
            revenueMatch: "$revenueMatch",
            ebitdaMatch: "$ebitdaMatch",
            revenueGrowthMatch: "$revenueGrowthMatch",
            yearsMatch: "$yearsMatch",
            businessModelMatch: "$businessModelMatch",
            capitalAvailabilityMatch: "$capitalAvailabilityMatch",
            companyTypeMatch: "$companyTypeMatch",
            minTransactionSizeMatch: "$minTransactionSizeMatch",
            priorAcquisitionsMatch: "$priorAcquisitionsMatch",
            stakePercentageMatch: "$stakePercentageMatch"
          },
          matchDetails: {
            industryMatch: true,
            geographyMatch: true,
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
            dealRevenue: deal.financialDetails?.trailingRevenueAmount || null,
            dealEbitda: deal.financialDetails?.trailingEBITDAAmount || null,
            dealAvgRevenueGrowth: deal.financialDetails?.avgRevenueGrowth || null,
            dealYearsInBusiness: deal.yearsInBusiness || null,
            dealStakePercentage: deal.stakePercentage || null,
            dealCompanyType: deal.companyType || [],
            dealCapitalAvailability: deal.buyerFit?.capitalAvailability || [],
            dealMinTransactionSize: deal.buyerFit?.minTransactionSize || null,
            dealMinPriorAcquisitions: deal.buyerFit?.minPriorAcquisitions || null,
            dealRewardLevel: deal.rewardLevel,
            expandedGeographies: expandedGeos
          }
        }
      },
      { $sort: { matchPercentage: -1, companyName: 1 } }
    ]).exec();
    return matchingProfiles;
  }
  async targetDealToBuyers(dealId: string, buyerIds: string[]): Promise<DealDocument> {
    const deal = (await this.dealModel.findById(dealId).exec()) as DealDocument;
  
    if (!deal) {
      throw new Error(`Deal with ID ${dealId} not found`);
    }
  
    const existingTargets = deal.targetedBuyers.map((id) => id.toString());
    const newTargets = buyerIds.filter((id) => !existingTargets.includes(id));
  
    if (newTargets.length > 0) {
      deal.targetedBuyers = [...deal.targetedBuyers, ...newTargets];
  
      for (const buyerId of newTargets) {
        deal.invitationStatus.set(buyerId, {
          invitedAt: new Date(),
          response: "pending",
        });
  
        // Send email to invited buyer
        const buyer = await this.buyerModel.findById(buyerId).exec();
        if (buyer) {
          const dealIdStr =
            deal._id instanceof Types.ObjectId ? deal._id.toHexString() : String(deal._id);
  
          const subject = "YOU HAVE A NEW DEAL MATCH ON CIM AMPLIFY";
          const trailingRevenueAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(deal.financialDetails?.trailingRevenueAmount || 0);
          const trailingEBITDAAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(deal.financialDetails?.trailingEBITDAAmount || 0);
          const htmlBody = genericEmailTemplate(subject, buyer.fullName.split(' ')[0], `
            <p><b>Details:</b> ${deal.companyDescription}</p>
            <p><b>T12 Revenue</b>: ${trailingRevenueAmount}</p>
            <p><b>T12 EBITDA</b>: ${trailingEBITDAAmount}</p>
            <p>Many of our deals are exclusive first look for CIM Amplify Members only. Head to your CIM Amplify (<a href="${process.env.FRONTEND_URL}/buyer/login">dashboard</a>) under Pending and click <strong>Move to Active</strong> button to see more details.</p>
            <p>Finally, please keep your dashboard up to date by moving Pending deals to either <b>Pass</b> or <b>Move to Active<b/>.</p>
          `);
  
          await this.mailService.sendEmailWithLogging(
            buyer.email,
            'buyer',
            subject,
            htmlBody,
            [ILLUSTRATION_ATTACHMENT], // attachments
            dealIdStr, // relatedDealId
          );
        }
      }
  
      deal.timeline.updatedAt = new Date();
      await deal.save();
    }
  
    return deal;
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

      // Send email notifications based on status
      if (status === "active") {
        // Buyer accepts deal: Send introduction email to seller and buyer
        const seller = await this.sellerModel.findById(dealDoc.seller).exec();
        const buyer = await this.buyerModel.findById(buyerId).exec();
        const companyProfile = await this.dealModel.db.model('CompanyProfile').findOne({ buyer: buyerId }).lean();

        if (seller && buyer) {
          const sellerSubject = `CIM AMPLIFY INTRODUCTION FOR ${dealDoc.title}`;
          const sellerHtmlBody = genericEmailTemplate(sellerSubject, seller.fullName.split(' ')[0], `
            <p>${buyer.fullName} at ${buyer.companyName} is interested in learning more about ${dealDoc.title}. Please send your NDA to ${buyer.email}.</p>
            <p>Here are the buyer's details:</p>
            <p>
              ${buyer.fullName}<br>
              ${buyer.companyName}<br>
              ${buyer.phone}<br>
              ${(companyProfile as any)?.website || ''}
            </p>
            <p>Thank you!</p>
          `);
          await this.mailService.sendEmailWithLogging(
            seller.email,
            'seller',
            sellerSubject,
            sellerHtmlBody,
            [ILLUSTRATION_ATTACHMENT], // attachments
            (dealDoc._id as Types.ObjectId).toString(), // relatedDealId
          );

          const buyerSubject = `CIM AMPLIFY INTRODUCTION FOR ${dealDoc.title}`;
          const buyerHtmlBody = genericEmailTemplate(buyerSubject, buyer.fullName.split(' ')[0], `
            <p>Thank you for accepting an introduction to <strong>${dealDoc.title}</strong>. We have notified <strong>${seller.fullName}</strong> at <strong>${seller.companyName}</strong>. They will follow up with their NDA and the next steps.</p>
            <p>
              <strong>Seller contact</strong><br>
              ${seller.fullName}<br>
              ${seller.companyName}<br>
              ${seller.email}<br>
              ${seller.website}
            </p>
            <p>If you don’t hear back within 2 business days, reply to this email and our team will assist. You can also access this deal from your <a href="${process.env.FRONTEND_URL}/buyer/login">buyer dashboard</a>.</p>
          `);
          await this.mailService.sendEmailWithLogging(
            buyer.email,
            'buyer',
            buyerSubject,
            buyerHtmlBody,
            [ILLUSTRATION_ATTACHMENT],
            (dealDoc._id as Types.ObjectId).toString(), // relatedDealId
          );
        }
      } else if (status === "rejected") {
        // Buyer rejects deal: Notify seller
        const seller = await this.sellerModel.findById(dealDoc.seller).exec();
        const buyer = await this.buyerModel.findById(buyerId).exec();

        if (seller && buyer) {
          const subject = `${buyer.fullName} from ${buyer.companyName} just passed on ${dealDoc.title}`;
          const htmlBody = genericEmailTemplate(subject, seller.fullName.split(' ')[0], `
            <p>${buyer.fullName} from ${buyer.companyName} just passed on ${dealDoc.title}. You can view all of your buyer activity on your <a href="${process.env.FRONTEND_URL}/seller/login">dashboard</a>.</p>
          `);
          await this.mailService.sendEmailWithLogging(
            seller.email,
            'seller',
            subject,
            htmlBody,
            [ILLUSTRATION_ATTACHMENT], // attachments
            (dealDoc._id as Types.ObjectId).toString(), // relatedDealId
          );
        }
      }

      return { deal: dealDoc, tracking, message: `Deal status updated to ${status}` }
    } catch (error) {
      throw new Error(`Failed to update deal status: ${error.message}`)
    }
  }

  // Replace the existing getBuyerDeals method with this improved version
  async getBuyerDeals(buyerId: string, status?: "pending" | "active" | "rejected" | "completed"): Promise<Deal[]> {
    const queryOptions = {
      sort: { "timeline.updatedAt": -1 },
      populate: { path: 'seller', select: 'fullName companyName' },
    };
  
    if (status === "active") {
      return this.dealModel.find({
        [`invitationStatus.${buyerId}.response`]: "accepted",
        status: { $ne: DealStatus.COMPLETED },
      }, null, queryOptions).exec();
    } else if (status === "rejected") {
      return this.dealModel.find({
        [`invitationStatus.${buyerId}.response`]: "rejected",
        status: { $ne: DealStatus.COMPLETED },
      }, null, queryOptions).exec();
    } else if (status === "pending") {
      return this.dealModel.find({
        [`invitationStatus.${buyerId}.response`]: "pending",
        status: { $ne: DealStatus.COMPLETED },
      }, null, queryOptions).exec();
    } else if (status === "completed") {
      return this.dealModel.find({
        [`invitationStatus.${buyerId}.response`]: "accepted",
        status: DealStatus.COMPLETED,
      }, null, { ...queryOptions, sort: { "timeline.completedAt": -1 } }).exec();
    } else {
      return this.dealModel.find({
        targetedBuyers: buyerId,
        status: { $ne: DealStatus.COMPLETED },
      }, null, queryOptions).exec();
    }
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
      const deal = await this.dealModel.findById(dealId).lean();
      if (!deal) {
        throw new NotFoundException(`Deal with ID ${dealId} not found`);
      }

      // Use Object.entries directly since invitationStatus is already an object
      const invitationStatusObj = deal.invitationStatus || {};

      const invitationStatusArray = Object.entries(invitationStatusObj)
        .filter(([buyerId]) => mongoose.isValidObjectId(buyerId))
        .map(([buyerId, status]) => ({
          buyerId,
          response: status.response,
        }));

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
        const [buyer, companyProfile] = await Promise.all([
          this.buyerModel
            .findById(buyerId)
            .select('fullName email companyName')
            .lean()
            .exec(),
          companyProfileModel.findOne({ buyer: buyerId }).lean(),
        ]);
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
      return result;
    } catch (error) {
      console.error('Error in getDealWithBuyerStatusSummary:', error);
      throw new InternalServerErrorException(`Failed to get deal with buyer status: ${error.message}`);
    }
  }

  async closeDealseller(
    dealId: string,
    userId: string,
    finalSalePrice?: number,
    notes?: string,
    winningBuyerId?: string,
    userRole?: string,
  ): Promise<Deal> {
    const dealDoc = await this.dealModel.findById(dealId).exec();
    if (!dealDoc) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }

    // Only check seller for sellers; allow admin
    if (userRole !== 'admin' && dealDoc.seller.toString() !== userId) {
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
    }

    // Ensure rewardLevel is set (required)
    if (!dealDoc.rewardLevel) {
      const rewardLevelMap: Record<string, 'Seed' | 'Bloom' | 'Fruit'> = {
        seed: 'Seed',
        bloom: 'Bloom',
        fruit: 'Fruit',
      };
      dealDoc.rewardLevel = rewardLevelMap[(dealDoc.visibility || '').toLowerCase()] || 'Seed';
    }

    // Ensure managementPreferences is a string
    if (dealDoc.managementPreferences && typeof dealDoc.managementPreferences !== 'string') {
      dealDoc.managementPreferences = JSON.stringify(dealDoc.managementPreferences);
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
      // Store buyer info in the deal document
      const buyer = await this.buyerModel.findById(winningBuyerId).lean();
      if (buyer) {
        dealDoc.closedWithBuyer = winningBuyerId;
        dealDoc.closedWithBuyerCompany = buyer.companyName || '';
        dealDoc.closedWithBuyerEmail = buyer.email || '';
      }
    }

    const tracking = new dealTrackingModel(trackingData);
    await tracking.save();
    const savedDeal = await dealDoc.save();

    // Phase 4.1: When a deal goes off market (sold to CIM Amplify buyer)
    if (winningBuyerId) {
      const seller = await this.sellerModel.findById(userId).exec();
      const winningBuyer = await this.buyerModel.findById(winningBuyerId).exec();

      if (seller && winningBuyer) {
        const dealIdStr = (dealDoc._id instanceof Types.ObjectId) ? dealDoc._id.toHexString() : String(dealDoc._id);
        // Email to Seller
        const sellerSubject = `Thank you for using CIM Amplify!`;
        const sellerHtmlBody = genericEmailTemplate(sellerSubject, seller.fullName.split(' ')[0], `
          <p>Thank you so much for posting your deal on CIM Amplify! We will be in touch to send you your reward once we have contacted the buyer. This process should not take long but feel free to contact us anytime for an update.</p>
          <p>We hope that you will post with us again soon!</p>
        `);
        await this.mailService.sendEmailWithLogging(
          seller.email,
          'seller',
          sellerSubject,
          sellerHtmlBody,
          [ILLUSTRATION_ATTACHMENT], // attachments
          dealIdStr, // relatedDealId
        );

        // Email to Buyer
        // const buyerSubject = `Congratulations on your new acquisition!`;
        // const buyerHtmlBody = genericEmailTemplate(buyerSubject, winningBuyer.fullName.split(' ')[0], `
        //   <p>Congratulations on your new acquisition! We are excited to have been a part of this journey with you.</p>
        //   <p>We wish you the best in your new venture!</p>
        // `);
        // await this.mailService.sendEmailWithLogging(
        //   winningBuyer.email,
        //   'buyer',
        //   buyerSubject,
        //   buyerHtmlBody,
        //   [ILLUSTRATION_ATTACHMENT], // attachments
        //   dealIdStr,
        // );

        // Send email to project owner
        const ownerSubject = `Deal Complete ${dealDoc.title}`;
        const ownerHtmlBody = genericEmailTemplate(ownerSubject, 'John', `
          <p><b>Date Completed:</b> ${new Date().toLocaleDateString()}</p>
          <p><b>Transaction value:</b> ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(finalSalePrice || 0)}</p>
          <p><b>Seller Name:</b> ${seller.fullName}</p>
          <p><b>Seller Company:</b> ${seller.companyName}</p>
          <p><b>Buyer Name:</b> ${winningBuyer.fullName}</p>
          <p><b>Buyer Company:</b> ${winningBuyer.companyName}</p>
          <p><b>Buyer Email:</b> ${winningBuyer.email}</p>
        `);
        await this.mailService.sendEmailWithLogging(
          'johnm@cimamplify.com',
          'admin',
          ownerSubject,
          ownerHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
          dealIdStr,
        );
      }
    } else {
      // Phase 4.2: When a deal goes off market (not sold)
      const seller = await this.sellerModel.findById(userId).exec();
      if (seller) {
        const subject = `Thank you for using CIM Amplify!`;
        const htmlBody = genericEmailTemplate(subject, seller.fullName.split(' ')[0], `
          <p>Thank you so much for posting your deal on CIM Amplify!</p>
          <p>We apologize deeply for not helping much with this deal! Fortunately we are adding new buyers daily and we hope that you will post with us again soon! Enjoy your gift card as our appreciation of your hard work.</p>
        `);
        const dealIdStr = (dealDoc._id instanceof Types.ObjectId) ? dealDoc._id.toHexString() : String(dealDoc._id);
        await this.mailService.sendEmailWithLogging(
          seller.email,
          'seller',
          subject,
          htmlBody,
          [ILLUSTRATION_ATTACHMENT], // attachments
          dealIdStr,
        );
        
      }
    }

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

  // Add a method for seller's true active deals (at least one invitationStatus.response === 'accepted')
  async getSellerActiveDeals(sellerId: string): Promise<Deal[]> {
    return this.dealModel.find({
      seller: sellerId,
      status: { $ne: DealStatus.COMPLETED },
      $expr: {
        $gt: [
          {
            $size: {
              $filter: {
                input: { $objectToArray: "$invitationStatus" },
                as: "inv",
                cond: { $eq: ["$$inv.v.response", "accepted"] },
              },
            },
          },
          0,
        ],
      },
    }).sort({ "timeline.updatedAt": -1 }).exec();
  }
}