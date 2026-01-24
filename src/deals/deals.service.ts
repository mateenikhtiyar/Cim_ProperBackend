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
import { genericEmailTemplate, emailButton } from '../mail/generic-email.template';
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
          <p>We will let you know via email when your selected buyers change from pending to active to pass. You can also check your dashboard at any time to see buyer activity.</p>
          ${emailButton('Go to Dashboard', `${process.env.FRONTEND_URL}/seller/dashboard`)}
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
      const ownerSubject = `New Deal - ${savedDeal.title}`;
      const ownerHeading = `New Deal: <strong>${savedDeal.title}</strong>`;
      const trailingRevenueAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(savedDeal.financialDetails?.trailingRevenueAmount || 0);
      const trailingEBITDAAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(savedDeal.financialDetails?.trailingEBITDAAmount || 0);
      const sellerNameForOwner = seller?.fullName || 'Not provided';
      const sellerEmailForOwner = seller?.email || 'Not provided';
      const ownerHtmlBody = genericEmailTemplate(ownerHeading, 'John', `
        <p><b>Seller Name</b>: ${sellerNameForOwner}</p>
        <p><b>Seller Email</b>: ${sellerEmailForOwner}</p>
        <p><b>Description</b>: ${savedDeal.companyDescription}</p>
        <p><b>T12 Revenue</b>: ${trailingRevenueAmount}</p>
        <p><b>T12 EBITDA</b>: ${trailingEBITDAAmount}</p>
      `);
      await this.mailService.sendEmailWithLogging(
        'canotifications@amp-ven.com',
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





  async findAll(filters: { search?: string, buyerResponse?: string, status?: string, isPublic?: string, excludeStatus?: string } = {}, page: number = 1, limit: number = 10): Promise<any> {
    const skip = (page - 1) * limit;
    const query: any = {};

    if (filters.search) {
      const searchRegex = new RegExp(filters.search, 'i');
      query.$or = [
        { title: searchRegex },
        { companyDescription: searchRegex },
      ];
    }

    // Handle status filtering - this needs to be done carefully to avoid conflicts
    let statusFilterApplied = false;

    if (filters.buyerResponse === 'accepted') {
      query['$expr'] = {
        '$gt': [
          {
            '$size': {
              '$filter': {
                input: { '$objectToArray': '$invitationStatus' },
                as: 'item',
                cond: { '$eq': ['$$item.v.response', 'accepted'] }
              }
            }
          },
          0
        ]
      };
      query.status = { $nin: ['completed', 'loi'] }; // Exclude completed and LOI deals from active deals
      statusFilterApplied = true;
    }

    // Handle status filtering
    if (filters.status && !statusFilterApplied) {
      if (filters.status === 'active') {
        // For active status, exclude completed and LOI deals
        query.status = { $nin: ['completed', 'loi'] };
      } else {
        query.status = filters.status;
      }
      statusFilterApplied = true;
    }

    // Handle excludeStatus parameter - only apply if status filter wasn't applied
    // This is used for "All Deals" view which shows Active + LOI deals (excludes only completed/off-market)
    if (filters.excludeStatus && !statusFilterApplied) {
      query.status = { $ne: filters.excludeStatus };
    }

    if (filters.isPublic !== undefined) {
      query.isPublic = filters.isPublic === 'true';
    }

    const deals = await this.dealModel.find(query).skip(skip).limit(limit).exec();
    const totalDeals = await this.dealModel.countDocuments(query).exec();

    // Add buyer status counts for each deal
    const dealsWithCounts = await Promise.all(deals.map(async (deal) => {
      try {
        // Get the buyer status summary for this deal
        const statusSummary = await this.getDealWithBuyerStatusSummary((deal as any)._id.toString());

        // Add buyer counts to the deal object
        return {
          ...deal.toObject(),
          buyersByStatus: {
            active: statusSummary.summary.totalActive || 0,
            pending: statusSummary.summary.totalPending || 0,
            rejected: statusSummary.summary.totalRejected || 0,
          }
        };
      } catch (error) {
        // If there's an error getting status summary, return deal with zero counts
        return {
          ...deal.toObject(),
          buyersByStatus: {
            active: 0,
            pending: 0,
            rejected: 0,
          }
        };
      }
    }));

    return {
      data: dealsWithCounts,
      total: totalDeals,
      page,
      lastPage: Math.ceil(totalDeals / limit),
    };
  }

  async findBySeller(sellerId: string): Promise<Deal[]> {
    return this.dealModel
      .find({
        seller: sellerId,
        status: { $nin: [DealStatus.COMPLETED, DealStatus.LOI] },
      })
      .exec()
  }

  /**
   * Get ALL deals for a seller (for admin "All deals" view)
   * Excludes only completed deals but includes LOI deals
   */
  async findAllDealsBySeller(sellerId: string): Promise<Deal[]> {
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
        status: { $ne: DealStatus.COMPLETED },
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

  async requestAccess(dealId: string, buyerId: string): Promise<{ message: string }> {
    const deal = await this.dealModel.findById(dealId).exec() as DealDocument;
    if (!deal) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }
    if (!deal.isPublic) {
      throw new ForbiddenException('This deal is not listed in the marketplace');
    }

    // Add buyer to targetedBuyers so it shows in seller dashboard
    if (!deal.targetedBuyers.map(String).includes(buyerId)) {
      deal.targetedBuyers.push(buyerId);
    }

    // Add buyer to interestedBuyers (Active buyers)
    if (!deal.interestedBuyers.map(String).includes(buyerId)) {
      deal.interestedBuyers.push(buyerId);
    }

    // Track that this buyer has ever had the deal in Active (for "Buyer from CIM Amplify" dropdown)
    if (!deal.everActiveBuyers) {
      deal.everActiveBuyers = [];
    }
    if (!deal.everActiveBuyers.map(String).includes(buyerId)) {
      deal.everActiveBuyers.push(buyerId);
    }

    // Set status directly to 'accepted' so deal goes to buyer's Active tab immediately
    const current = deal.invitationStatus.get(buyerId);
    deal.invitationStatus.set(buyerId, {
      invitedAt: current?.invitedAt || new Date(),
      respondedAt: new Date(),
      response: 'accepted',
      notes: 'Moved to Active from marketplace',
      decisionBy: 'buyer',
    });

    // Log interaction for traceability
    const dealTrackingModel = this.dealModel.db.model('DealTracking');
    const tracking = new dealTrackingModel({
      deal: dealId,
      buyer: buyerId,
      interactionType: 'view',
      timestamp: new Date(),
      notes: 'Buyer moved deal to Active from marketplace',
      metadata: { source: 'marketplace' },
    });
    await tracking.save();

    deal.timeline.updatedAt = new Date();
    await deal.save();

    // Send introduction emails to both advisor and buyer (same as pending to active)
    try {
      const seller = await this.sellerModel.findById(deal.seller).exec();
      const buyer = await this.buyerModel.findById(buyerId).exec();
      const companyProfile = await this.dealModel.db.model('CompanyProfile').findOne({ buyer: buyerId }).lean();

      if (seller && buyer) {
        // Email to Advisor (Seller)
        const advisorSubject = `CIM AMPLIFY INTRODUCTION FOR ${deal.title}`;
        const advisorHtmlBody = genericEmailTemplate(advisorSubject, seller.fullName.split(' ')[0], `
          <p>${buyer.fullName} at ${buyer.companyName} is interested in learning more about ${deal.title}.  If you attached an NDA to this deal it has already been sent to the buyer for execution.</p>
          <p>Here are the buyer's details:</p>
          <p>
            ${buyer.fullName}<br>
            ${buyer.companyName}<br>
            ${buyer.email}<br>
            ${buyer.phone}<br>
            ${(companyProfile as any)?.website || ''}
          </p>
        `);

        await this.mailService.sendEmailWithLogging(
          seller.email,
          'seller',
          advisorSubject,
          advisorHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
          (deal._id as Types.ObjectId).toString(),
        );

        // Email to Buyer with NDA if available
        const buyerSubject = `CIM AMPLIFY INTRODUCTION FOR ${deal.title}`;
        const hasNda = deal.ndaDocument && deal.ndaDocument.base64Content;
        const ndaFileName = hasNda && deal.ndaDocument ? deal.ndaDocument.originalName : '';
        const buyerHtmlBody = genericEmailTemplate(buyerSubject, buyer.fullName.split(' ')[0], `
          <p>Thank you for accepting an introduction to <strong>${deal.title}</strong>. We've notified the Advisor who will reach out to you directly:</p>
          <p style="margin: 16px 0; padding: 12px; background-color: #f5f5f5; border-radius: 8px;">
            <strong>${seller.fullName}</strong><br>
            ${seller.companyName}<br>
            <a href="mailto:${seller.email}" style="color: #3aafa9;">${seller.email}</a>
          </p>
          ${hasNda
            ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; border: 2px solid #3aafa9; border-radius: 8px; overflow: hidden;">
                <tr>
                  <td style="background-color: #3aafa9; padding: 12px 16px;">
                    <strong style="color: #ffffff; font-size: 14px;">📎 NDA DOCUMENT ATTACHED</strong>
                  </td>
                </tr>
                <tr>
                  <td style="background-color: #e8f5f3; padding: 16px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right: 12px;">
                          <div style="width: 40px; height: 40px; background-color: #3aafa9; border-radius: 4px; text-align: center; line-height: 40px;">
                            <span style="color: white; font-size: 18px;">📄</span>
                          </div>
                        </td>
                        <td>
                          <strong style="color: #333; font-size: 14px;">${ndaFileName}</strong><br>
                          <span style="color: #666; font-size: 12px;">Please download the attachment</span>
                        </td>
                      </tr>
                    </table>
                    <p style="margin: 12px 0 0 0; color: #333; font-size: 13px;">
                      <strong>Next steps:</strong> Fill out and sign the NDA, then send it directly to the Advisor at
                      <a href="mailto:${seller.email}" style="color: #3aafa9;">${seller.email}</a>
                    </p>
                  </td>
                </tr>
              </table>
            `
            : ''
          }
          <p>To review this and other deals please go to your dashboard.</p>
          ${emailButton('View Dashboard', `${process.env.FRONTEND_URL}/buyer/deals`)}
          <p>If you don't hear back within 2 days, reply to this email and our team will assist.</p>
        `);

        // Build attachments array - include NDA if available
        const buyerAttachments: any[] = [ILLUSTRATION_ATTACHMENT];
        if (hasNda && deal.ndaDocument) {
          const ndaBuffer = Buffer.from(deal.ndaDocument.base64Content, 'base64');
          buyerAttachments.push({
            filename: deal.ndaDocument.originalName,
            content: ndaBuffer,
            contentType: deal.ndaDocument.mimetype,
          });
        }

        await this.mailService.sendEmailWithLogging(
          buyer.email,
          'buyer',
          buyerSubject,
          buyerHtmlBody,
          buyerAttachments,
          (deal._id as Types.ObjectId).toString(),
        );
      }
    } catch (emailError) {
      console.error('Failed to send marketplace introduction emails:', emailError);
      // Don't fail the operation if emails fail
    }

    return { message: 'Deal added to your Active deals!' };
  }

  async markNotInterested(dealId: string, buyerId: string): Promise<{ message: string }> {
    const deal = await this.dealModel.findById(dealId).exec() as DealDocument;
    if (!deal) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }
    if (!deal.isPublic) {
      throw new ForbiddenException('This deal is not listed in the marketplace');
    }

    // Add buyer to hiddenByBuyers array - this just hides the deal from marketplace for this buyer
    // It doesn't reject the deal, so if the deal matches their criteria later, they can still receive it
    if (!deal.hiddenByBuyers) {
      deal.hiddenByBuyers = [];
    }
    if (!deal.hiddenByBuyers.map(String).includes(buyerId)) {
      deal.hiddenByBuyers.push(buyerId);
    }

    await deal.save();

    return { message: 'Deal removed from your marketplace' };
  }

  async approveAccess(dealId: string, sellerId: string, buyerId: string): Promise<any> {
    const deal = await this.dealModel.findById(dealId).exec() as DealDocument;
    if (!deal) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }
    if (deal.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to approve access for this deal");
    }
    // Ensure buyer is targeted (requestAccess should have done this)
    if (!deal.targetedBuyers.map(String).includes(buyerId)) {
      deal.targetedBuyers.push(buyerId);
    }
    // Mark as pending so it shows in buyer's Pending tab
    const current = deal.invitationStatus.get(buyerId);
    deal.invitationStatus.set(buyerId, {
      invitedAt: current?.invitedAt || new Date(),
      respondedAt: new Date(),
      response: 'pending',
      notes: 'Marketplace access approved by seller',
      decisionBy: 'seller',
    });

    // Log interaction
    const dealTrackingModel = this.dealModel.db.model('DealTracking');
    const tracking = new dealTrackingModel({
      deal: dealId,
      buyer: buyerId,
      interactionType: 'view',
      timestamp: new Date(),
      notes: 'Seller approved marketplace access (pending)',
      metadata: { source: 'seller-approve' },
    });
    await tracking.save();

    deal.timeline.updatedAt = new Date();
    await deal.save();

    // Optionally notify buyer that they have been approved and can move to active
    const buyer = await this.buyerModel.findById(buyerId).exec();
    if (buyer) {
      const subject = `You have access to the Marketplace deal`;
      const htmlBody = genericEmailTemplate(subject, buyer.fullName.split(' ')[0], `
        <p>Your access request for the Marketplace deal was approved. The deal is now available in your Pending tab. Click <strong>Move to Active</strong> to receive an introduction to the advisor.</p>
        ${emailButton('View Pending Deals', `${process.env.FRONTEND_URL}/buyer/deals`)}
      `);
      await this.mailService.sendEmailWithLogging(
        buyer.email,
        'buyer',
        subject,
        htmlBody,
        [ILLUSTRATION_ATTACHMENT],
        (deal._id as Types.ObjectId).toString(),
      );
    }

    return { message: 'Access approved and moved to Pending for buyer' };
  }

  async denyAccess(dealId: string, sellerId: string, buyerId: string): Promise<any> {
    const deal = await this.dealModel.findById(dealId).exec() as DealDocument;
    if (!deal) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }
    if (deal.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to deny access for this deal");
    }
    // Ensure targeted so it appears in dashboards
    if (!deal.targetedBuyers.map(String).includes(buyerId)) {
      deal.targetedBuyers.push(buyerId);
    }
    const current = deal.invitationStatus.get(buyerId);
    deal.invitationStatus.set(buyerId, {
      invitedAt: current?.invitedAt || new Date(),
      respondedAt: new Date(),
      response: 'rejected',
      notes: 'Marketplace access denied by seller',
      decisionBy: 'seller',
    });

    // Track rejection
    const dealTrackingModel = this.dealModel.db.model('DealTracking');
    const tracking = new dealTrackingModel({
      deal: dealId,
      buyer: buyerId,
      interactionType: 'rejected',
      timestamp: new Date(),
      notes: 'Marketplace access denied by seller',
      metadata: { source: 'seller-deny' },
    });
    await tracking.save();

    // Remove from interested if present
    deal.interestedBuyers = deal.interestedBuyers.filter((id) => id.toString() !== buyerId);
    deal.timeline.updatedAt = new Date();
    await deal.save();

    // Optional: notify buyer
    const buyer = await this.buyerModel.findById(buyerId).exec();
    if (buyer) {
      const subject = `Access request declined for Marketplace deal`;
      const htmlBody = genericEmailTemplate(subject, buyer.fullName.split(' ')[0], `
        <p>Your request to access the marketplace deal has been declined by the advisor at this time.</p>
        <p>You can continue browsing the marketplace for other opportunities.</p>
        ${emailButton('Browse Marketplace', `${process.env.FRONTEND_URL}/buyer/marketplace`)}
      `);
      await this.mailService.sendEmailWithLogging(
        buyer.email,
        'buyer',
        subject,
        htmlBody,
        [ILLUSTRATION_ATTACHMENT],
        (deal._id as Types.ObjectId).toString(),
      );
    }

    return { message: 'Access denied', dealId, buyerId };
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

    // Handle marketplace opt-out flow: if toggling isPublic from true -> false,
    // decline all outstanding marketplace requests (response === 'requested').
    if (typeof updateDealDto.isPublic === 'boolean') {
      const wasPublic = !!deal.isPublic;
      const willBePublic = !!updateDealDto.isPublic;
      if (wasPublic && !willBePublic) {
        const invitationEntries: Array<[string, any]> = deal.invitationStatus instanceof Map
          ? Array.from(deal.invitationStatus.entries())
          : Object.entries((deal.invitationStatus as any) || {});

        for (const [buyerId, inv] of invitationEntries) {
          if (inv?.response === 'requested') {
            // Mark as rejected by seller and notify
            deal.invitationStatus.set(buyerId, {
              invitedAt: inv.invitedAt || new Date(),
              respondedAt: new Date(),
              response: 'rejected',
              notes: 'Marketplace listing removed by seller',
              decisionBy: 'seller',
            });
            // Tracking
            try {
              const dealTrackingModel = this.dealModel.db.model('DealTracking');
              const tracking = new dealTrackingModel({
                deal: id,
                buyer: buyerId,
                interactionType: 'rejected',
                timestamp: new Date(),
                notes: 'Listing removed by seller (marketplace opt-out)',
                metadata: { source: 'marketplace-optout' },
              });
              await tracking.save();
            } catch { }
            // Email buyer
            try {
              const buyer = await this.buyerModel.findById(buyerId).exec();
              if (buyer) {
                const subject = `${deal.title} is no longer listed in the marketplace`;
                const htmlBody = genericEmailTemplate(subject, buyer.fullName.split(' ')[0], `
                  <p>Your request to access <strong>${deal.title}</strong> is no longer available because the advisor removed the listing from the marketplace.</p>
                  <p>You can continue browsing the marketplace for other opportunities.</p>
                  ${emailButton('Browse Marketplace', `${process.env.FRONTEND_URL}/buyer/marketplace`)}
                `);
                await this.mailService.sendEmailWithLogging(
                  buyer.email,
                  'buyer',
                  subject,
                  htmlBody,
                  [ILLUSTRATION_ATTACHMENT],
                  (deal._id as Types.ObjectId).toString(),
                );
              }
            } catch { }
          }
        }
      }
    }
    // Handle NDA document update explicitly
    if ('ndaDocument' in updateDealDto) {
      if (updateDealDto.ndaDocument === null || updateDealDto.ndaDocument === undefined) {
        // Remove NDA document if explicitly set to null/undefined
        deal.ndaDocument = undefined;
        deal.markModified('ndaDocument');
      } else if (updateDealDto.ndaDocument) {
        // Update NDA document with new data
        deal.ndaDocument = {
          originalName: updateDealDto.ndaDocument.originalName,
          base64Content: updateDealDto.ndaDocument.base64Content,
          mimetype: updateDealDto.ndaDocument.mimetype,
          size: updateDealDto.ndaDocument.size,
          uploadedAt: updateDealDto.ndaDocument.uploadedAt || new Date(),
        };
        deal.markModified('ndaDocument');
      }
    }

    // Only update provided fields, do not overwrite required fields with undefined
    for (const [key, value] of Object.entries(updateDataWithoutDocuments)) {
      if (typeof value !== "undefined" && key !== 'ndaDocument') {
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















  // ----------------------------------------------------------------------------------------------------------------



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

          const trailingRevenueAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(deal.financialDetails?.trailingRevenueAmount || 0);
          const trailingEBITDAAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(deal.financialDetails?.trailingEBITDAAmount || 0);
          const subject = `YOU ARE INVITED TO PARTICIPATE IN A ${trailingEBITDAAmount} DEAL`;

          // Build action URLs for email buttons
          const activateUrl = `${process.env.FRONTEND_URL}/buyer/deals?action=activate&dealId=${dealIdStr}`;
          const passUrl = `${process.env.FRONTEND_URL}/buyer/deals?action=pass&dealId=${dealIdStr}`;

          const htmlBody = genericEmailTemplate(subject, buyer.fullName.split(' ')[0], `
            <p><b>Details:</b> ${deal.companyDescription}</p>
            <p><b>T12 Revenue</b>: ${trailingRevenueAmount}</p>
            <p><b>T12 EBITDA</b>: ${trailingEBITDAAmount}</p>

            <!-- Action Buttons -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
              <tr>
                <td align="center">
                  <table border="0" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" style="padding-right: 12px;">
                        <a href="${activateUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: #3AAFA9; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Move to Active / Request Info</a>
                      </td>
                      <td align="center" style="padding-left: 12px;">
                        <a href="${passUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: #E35153; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Pass</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p>Many of our deals are exclusive first look for CIM Amplify Members only. Head to your CIM Amplify dashboard under Pending to see more details.</p>
            <p>Please keep your dashboard up to date by responding to Pending deals promptly.</p>
            ${emailButton('View Dashboard', `${process.env.FRONTEND_URL}/buyer/deals`)}
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
          decisionBy: 'buyer',
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
          // Track that this buyer has ever had the deal in Active
          if (!deal.everActiveBuyers) {
            deal.everActiveBuyers = []
          }
          if (!deal.everActiveBuyers.map(String).includes(buyerId)) {
            deal.everActiveBuyers.push(buyerId)
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
        decisionBy: 'buyer',
      })

      // Update interested buyers list
      if (status === "active") {
        if (!dealDoc.interestedBuyers.includes(buyerId)) {
          dealDoc.interestedBuyers.push(buyerId)
        }
        // Track that this buyer has ever had the deal in Active
        if (!dealDoc.everActiveBuyers) {
          dealDoc.everActiveBuyers = []
        }
        if (!dealDoc.everActiveBuyers.map(String).includes(buyerId)) {
          dealDoc.everActiveBuyers.push(buyerId)
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
      console.log('[Introduction Email] Status is:', status);
      if (status === "active") {
        console.log('[Introduction Email] Entering active status block');
        // Buyer accepts deal: Send introduction email to seller and buyer
        const seller = await this.sellerModel.findById(dealDoc.seller).exec();
        const buyer = await this.buyerModel.findById(buyerId).exec();
        const companyProfile = await this.dealModel.db.model('CompanyProfile').findOne({ buyer: buyerId }).lean();

        // Debug logging for NDA
        console.log('[Introduction Email] Deal:', dealDoc.title);
        console.log('[Introduction Email] Seller found:', !!seller);
        console.log('[Introduction Email] Buyer found:', !!buyer);
        console.log('[Introduction Email] Has NDA Document:', !!dealDoc.ndaDocument);
        if (dealDoc.ndaDocument) {
          console.log('[Introduction Email] NDA Original Name:', dealDoc.ndaDocument.originalName);
          console.log('[Introduction Email] NDA Has Base64:', !!dealDoc.ndaDocument.base64Content);
        }

        // Email to Advisor (Seller)
        if (seller && buyer) {
          console.log('[Introduction Email] Both advisor and buyer found, preparing emails');
          const advisorSubject = `CIM AMPLIFY INTRODUCTION FOR ${dealDoc.title}`;
          const advisorHtmlBody = genericEmailTemplate(advisorSubject, seller.fullName.split(' ')[0], `
            <p>${buyer.fullName} at ${buyer.companyName} is interested in learning more about ${dealDoc.title}.  If you attached an NDA to this deal it has already been sent to the buyer for execution.</p>
            <p>Here are the buyer's details:</p>
            <p>
              ${buyer.fullName}<br>
              ${buyer.companyName}<br>
              ${buyer.email}<br>
              ${buyer.phone}<br>
              ${(companyProfile as any)?.website || ''}
            </p>
            <p>Thank you!</p>
          `);

          try {
            console.log('[Introduction Email] Sending email to advisor:', seller.email);
            await this.mailService.sendEmailWithLogging(
              seller.email,
              'seller',
              advisorSubject,
              advisorHtmlBody,
              [ILLUSTRATION_ATTACHMENT], // attachments
              (dealDoc._id as Types.ObjectId).toString(), // relatedDealId
            );
            console.log('[Introduction Email] Email sent successfully to advisor');
          } catch (advisorEmailError) {
            console.error('[Introduction Email] Failed to send email to advisor:', advisorEmailError);
          }

          const buyerSubject = `CIM AMPLIFY INTRODUCTION FOR ${dealDoc.title}`;
          const hasNda = dealDoc.ndaDocument && dealDoc.ndaDocument.base64Content;
          const ndaFileName = hasNda && dealDoc.ndaDocument ? dealDoc.ndaDocument.originalName : '';
          const buyerHtmlBody = genericEmailTemplate(buyerSubject, buyer.fullName.split(' ')[0], `
            <p>Thank you for accepting an introduction to <strong>${dealDoc.title}</strong>. We've notified the Advisor who will reach out to you directly:</p>
            <p style="margin: 16px 0; padding: 12px; background-color: #f5f5f5; border-radius: 8px;">
              <strong>${seller.fullName}</strong><br>
              ${seller.companyName}<br>
              <a href="mailto:${seller.email}" style="color: #3aafa9;">${seller.email}</a>
            </p>
            ${hasNda
              ? `
                <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; border: 2px solid #3aafa9; border-radius: 8px; overflow: hidden;">
                  <tr>
                    <td style="background-color: #3aafa9; padding: 12px 16px;">
                      <strong style="color: #ffffff; font-size: 14px;">📎 NDA DOCUMENT ATTACHED</strong>
                    </td>
                  </tr>
                  <tr>
                    <td style="background-color: #e8f5f3; padding: 16px;">
                      <table cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="padding-right: 12px;">
                            <div style="width: 40px; height: 40px; background-color: #3aafa9; border-radius: 4px; text-align: center; line-height: 40px;">
                              <span style="color: white; font-size: 18px;">📄</span>
                            </div>
                          </td>
                          <td>
                            <strong style="color: #333; font-size: 14px;">${ndaFileName}</strong><br>
                            <span style="color: #666; font-size: 12px;">Please download the attachment</span>
                          </td>
                        </tr>
                      </table>
                      <p style="margin: 12px 0 0 0; color: #333; font-size: 13px;">
                        <strong>Next steps:</strong> Fill out and sign the NDA, then send it directly to the Advisor at
                        <a href="mailto:${seller.email}" style="color: #3aafa9;">${seller.email}</a>
                      </p>
                    </td>
                  </tr>
                </table>
              `
              : ''
            }
            <p>To review this and other deals please go to your dashboard.</p>
            ${emailButton('View Dashboard', `${process.env.FRONTEND_URL}/buyer/deals`)}
            <p>If you don't hear back within 2 days, reply to this email and our team will assist.</p>
          `);

          // Build attachments array - include NDA if available
          const buyerAttachments: any[] = [ILLUSTRATION_ATTACHMENT];
          if (hasNda && dealDoc.ndaDocument) {
            console.log('[Introduction Email] Adding NDA attachment:', dealDoc.ndaDocument.originalName);
            console.log('[Introduction Email] NDA base64 length:', dealDoc.ndaDocument.base64Content?.length || 0);

            // Convert base64 string to Buffer for nodemailer
            const ndaBuffer = Buffer.from(dealDoc.ndaDocument.base64Content, 'base64');
            console.log('[Introduction Email] NDA buffer size:', ndaBuffer.length);

            buyerAttachments.push({
              filename: dealDoc.ndaDocument.originalName,
              content: ndaBuffer,
              contentType: dealDoc.ndaDocument.mimetype,
            });
          }

          try {
            console.log('[Introduction Email] Sending email to buyer:', buyer.email);
            await this.mailService.sendEmailWithLogging(
              buyer.email,
              'buyer',
              buyerSubject,
              buyerHtmlBody,
              buyerAttachments,
              (dealDoc._id as Types.ObjectId).toString(), // relatedDealId
            );
            console.log('[Introduction Email] Email sent successfully to buyer');
          } catch (emailError) {
            console.error('[Introduction Email] Failed to send email to buyer:', emailError);
          }
        }
      } else if (status === "rejected") {
        // Buyer rejects deal: Notify seller
        const seller = await this.sellerModel.findById(dealDoc.seller).exec();
        const buyer = await this.buyerModel.findById(buyerId).exec();

        if (seller && buyer) {
          const subject = `${buyer.fullName} from ${buyer.companyName} just passed on ${dealDoc.title}`;
          const htmlBody = genericEmailTemplate(subject, seller.fullName.split(' ')[0], `
            <p>${buyer.fullName} from ${buyer.companyName} just passed on ${dealDoc.title}. You can view all of your buyer activity on your dashboard.</p>
            ${emailButton('View Dashboard', `${process.env.FRONTEND_URL}/seller/dashboard`)}
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
      const responsePath = `invitationStatus.${buyerId}.response`;
      const decisionByPath = `invitationStatus.${buyerId}.decisionBy`;
      const filter: Record<string, any> = {
        [responsePath]: "rejected",
        status: { $ne: DealStatus.COMPLETED },
      };
      filter.$or = [
        { [decisionByPath]: "buyer" },
        { [decisionByPath]: { $exists: false } },
        { [decisionByPath]: null },
      ];
      return this.dealModel.find(filter, null, queryOptions).exec();
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

  // Get buyers who have ever had this deal in their Active tab (for "Buyer from CIM Amplify" dropdown)
  async getEverActiveBuyers(dealId: string): Promise<any[]> {
    try {
      const deal = await this.dealModel.findById(dealId).exec();
      if (!deal) {
        throw new NotFoundException(`Deal with ID "${dealId}" not found`);
      }

      const everActiveBuyerIds = deal.everActiveBuyers || [];
      if (everActiveBuyerIds.length === 0) {
        return [];
      }

      // Populate buyer details with company profile info
      const buyers = await this.buyerModel.find({
        _id: { $in: everActiveBuyerIds }
      }).lean();

      const companyProfileModel = this.dealModel.db.model('CompanyProfile');
      const companyProfiles = await companyProfileModel.find({
        buyer: { $in: everActiveBuyerIds }
      }).lean();

      // Create a map for quick lookup
      const profileMap = new Map();
      companyProfiles.forEach((profile: any) => {
        profileMap.set(profile.buyer.toString(), profile);
      });

      // Get current status from invitationStatus
      const result = buyers.map((buyer: any) => {
        const profile = profileMap.get(buyer._id.toString());
        const invitationInfo = deal.invitationStatus?.get(buyer._id.toString());

        return {
          _id: buyer._id,
          fullName: buyer.fullName,
          email: buyer.email,
          companyName: buyer.companyName || profile?.companyName,
          companyType: profile?.companyType,
          currentStatus: invitationInfo?.response || 'unknown',
          // Indicate if buyer is currently in Active (accepted) or has passed (rejected)
          wasEverActive: true,
          isCurrentlyActive: invitationInfo?.response === 'accepted',
        };
      });

      return result;
    } catch (error) {
      console.error('Error in getEverActiveBuyers:', error);
      throw new InternalServerErrorException(`Failed to get ever active buyers: ${error.message}`);
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

      // Process invitationStatus - this is the authoritative source for buyer counts
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
          continue;
        }

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

        // Only use invitationStatus for categorization to avoid double counting
        switch (response) {
          case 'accepted':
            buyersByStatus.active.push(buyerData);
            break;
          case 'pending':
          case 'requested':
            buyersByStatus.pending.push(buyerData);
            break;
          case 'rejected':
            buyersByStatus.rejected.push(buyerData);
            break;
        }
      }

      // Only add interaction details to existing buyers, don't create new categorizations
      const buyerInteractions = await this.getBuyerInteractionsForDeal(dealId);
      for (const interaction of buyerInteractions) {
        if (!mongoose.isValidObjectId(interaction.buyerId)) {
          continue;
        }

        // Only update existing buyers with interaction details
        if (buyerIds.has(interaction.buyerId)) {
          const existing = buyerMap.get(interaction.buyerId)!;
          existing.companyType = interaction.companyType || existing.companyType;
          existing.lastInteraction = interaction.lastInteraction || existing.lastInteraction;
          existing.totalInteractions = interaction.totalInteractions || existing.totalInteractions;
          existing.interactions = interaction.interactions || existing.interactions;
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

    // Track if this was an LOI deal before closing
    const wasLOIDeal = dealDoc.status === DealStatus.LOI;

    dealDoc.status = DealStatus.COMPLETED;

    // Ensure timeline object exists
    if (!dealDoc.timeline || typeof dealDoc.timeline !== 'object') {
      dealDoc.timeline = {} as any;
    }
    dealDoc.timeline.completedAt = new Date();
    dealDoc.timeline.updatedAt = new Date();
    dealDoc.markModified('timeline');

    if (finalSalePrice !== undefined && finalSalePrice !== null) {
      if (!dealDoc.financialDetails || typeof dealDoc.financialDetails !== 'object') {
        dealDoc.financialDetails = {};
      }
      dealDoc.financialDetails.finalSalePrice = finalSalePrice;
      dealDoc.markModified('financialDetails');
    }

    // Store if this was an LOI deal
    (dealDoc as any).wasLOIDeal = wasLOIDeal;
    dealDoc.markModified('wasLOIDeal');

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
        dealDoc.markModified('closedWithBuyer');
        dealDoc.markModified('closedWithBuyerCompany');
        dealDoc.markModified('closedWithBuyerEmail');
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
        // Email to Advisor (Seller)
        const advisorSubject = `Thank you for using CIM Amplify!`;
        const advisorHtmlBody = genericEmailTemplate(advisorSubject, seller.fullName.split(' ')[0], `
          <p>Thank you so much for posting your deal on CIM Amplify! We will be in touch to send you your reward once we have contacted the buyer. This process should not take long but feel free to contact us anytime for an update.</p>
          <p>We hope that you will post with us again soon!</p>
        `);
        await this.mailService.sendEmailWithLogging(
          seller.email,
          'seller',
          advisorSubject,
          advisorHtmlBody,
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
        // canotifications@amp-ven.com
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
          'canotifications@amp-ven.com',
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

    // Notify active and pending buyers that the deal is now off-market
    // This gives them FOMO and keeps them engaged for future deals
    try {
      const dealIdStr = (dealDoc._id instanceof Types.ObjectId) ? dealDoc._id.toHexString() : String(dealDoc._id);
      const seller = await this.sellerModel.findById(dealDoc.seller).exec();

      // Get all buyers with active or pending status for this deal
      const invitationStatus = dealDoc.invitationStatus;
      if (invitationStatus && invitationStatus.size > 0) {
        const buyerIdsToNotify: string[] = [];

        invitationStatus.forEach((status, buyerId) => {
          // Notify both active (accepted) and pending buyers
          if (status.response === 'accepted' || status.response === 'pending') {
            // Skip the winning buyer if there is one
            if (!winningBuyerId || buyerId !== winningBuyerId) {
              buyerIdsToNotify.push(buyerId);
            }
          }
        });

        if (buyerIdsToNotify.length > 0) {
          const buyers = await this.buyerModel.find({ _id: { $in: buyerIdsToNotify } }).exec();

          for (const buyer of buyers) {
            const buyerStatus = invitationStatus.get(buyer._id.toString());
            const wasActive = buyerStatus?.response === 'accepted';
            const wasPending = buyerStatus?.response === 'pending';

            const subject = `Deal Update: ${dealDoc.title} is now off market`;
            
            let emailContent = '';
            if (wasActive) {
              // Email for Active Buyers
              emailContent = `
                <p>We wanted to let you know that <strong>${dealDoc.title}</strong> is now off market.Thank you for reviewing this deal!</p>
                <p>We will send you an email when you are invited to participate in new deals and there are lots of in Marketplace for you to review.</p>
                <p>If you have deals sitting in Pending please respond ASAP as advisors are waiting for your response.</p>
                ${emailButton('View Available Deals', `${process.env.FRONTEND_URL}/buyer/deals`)}
                <p>Stay tuned for more opportunities!</p>
              `;
            } else if (wasPending) {
              // Email for Pending Buyers
              emailContent = `
                <p>We wanted to let you know that <strong>${dealDoc.title}</strong> is now off market.</p>
                <p>This deal was in your Pending Deals. Please make sure to <strong>respond to Pending Deals as soon as possible</strong> so the Advisor who invited you to the deal knows your intentions.</p>
                <p>Check out other available deals on your dashboard. Also, check out Marketplace on your dashboard for deals that Advisors have posted to all CIM Amplify Members.</p>
                ${emailButton('View Available Deals', `${process.env.FRONTEND_URL}/buyer/deals`)}
                <p>Stay tuned for more opportunities!</p>
              `;
            }

            const htmlBody = genericEmailTemplate(subject, buyer.fullName.split(' ')[0], emailContent);

            await this.mailService.sendEmailWithLogging(
              buyer.email,
              'buyer',
              subject,
              htmlBody,
              [ILLUSTRATION_ATTACHMENT],
              dealIdStr,
            );
          }
        }
      }
    } catch (error) {
      // Log but don't fail the operation if notification emails fail
      console.error('Error sending off-market notifications to buyers:', error);
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
  // Excludes both 'completed' (off-market) and 'loi' deals
  async getSellerActiveDeals(sellerId: string): Promise<Deal[]> {
    return this.dealModel.find({
      seller: sellerId,
      status: { $nin: [DealStatus.COMPLETED, DealStatus.LOI] },
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

  /**
   * Optimized admin deals fetch - Single aggregation query that:
   * 1. Filters deals by status/search
   * 2. Joins seller profiles
   * 3. Calculates buyer status summaries
   * 4. Returns paginated results with total count
   */
  async findAllAdminOptimized(
    filters: {
      search?: string;
      buyerResponse?: string;
      status?: string;
      isPublic?: string;
      excludeStatus?: string;
    } = {},
    page: number = 1,
    limit: number = 10
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    lastPage: number;
    stats: {
      totalDeals: number;
      activeDeals: number;
      completedDeals: number;
      totalBuyers: number;
      totalSellers: number;
    };
  }> {
    const skip = (page - 1) * limit;

    // Build match stage
    const matchStage: any = {};

    if (filters.search) {
      const searchRegex = new RegExp(filters.search, 'i');
      matchStage.$or = [
        { title: searchRegex },
        { companyDescription: searchRegex },
        { industrySector: searchRegex },
      ];
    }

    // Status filtering logic
    if (filters.buyerResponse === 'accepted') {
      matchStage.$expr = {
        $gt: [
          {
            $size: {
              $filter: {
                input: { $objectToArray: '$invitationStatus' },
                as: 'item',
                cond: { $eq: ['$$item.v.response', 'accepted'] },
              },
            },
          },
          0,
        ],
      };
      matchStage.status = { $nin: ['completed', 'loi'] };
    } else if (filters.status) {
      if (filters.status === 'active') {
        matchStage.status = { $nin: ['completed', 'loi'] };
      } else {
        matchStage.status = filters.status;
      }
    } else if (filters.excludeStatus) {
      // This is used for "All Deals" view which shows Active + LOI deals (excludes only completed/off-market)
      matchStage.status = { $ne: filters.excludeStatus };
    }

    if (filters.isPublic !== undefined) {
      matchStage.isPublic = filters.isPublic === 'true';
    }

    // Single aggregation pipeline
    const pipeline: any[] = [
      { $match: matchStage },
      // Sort by most recent first
      { $sort: { 'timeline.updatedAt': -1, createdAt: -1 } },
      // Facet for parallel execution of data + count + stats
      {
        $facet: {
          // Get paginated deals with seller lookup
          data: [
            { $skip: skip },
            { $limit: limit },
            // Lookup seller profile
            {
              $lookup: {
                from: 'sellers',
                let: { sellerId: { $toObjectId: '$seller' } },
                pipeline: [
                  { $match: { $expr: { $eq: ['$_id', '$$sellerId'] } } },
                  {
                    $project: {
                      _id: 1,
                      fullName: 1,
                      email: 1,
                      companyName: 1,
                      phoneNumber: 1,
                      website: 1,
                      profilePicture: 1,
                    },
                  },
                ],
                as: 'sellerProfile',
              },
            },
            { $unwind: { path: '$sellerProfile', preserveNullAndEmptyArrays: true } },
            // Calculate buyer status summary from invitationStatus
            {
              $addFields: {
                invitationStatusArray: { $objectToArray: { $ifNull: ['$invitationStatus', {}] } },
              },
            },
            {
              $addFields: {
                statusSummary: {
                  totalTargeted: { $size: { $ifNull: ['$targetedBuyers', []] } },
                  totalActive: {
                    $size: {
                      $filter: {
                        input: '$invitationStatusArray',
                        as: 'inv',
                        cond: { $eq: ['$$inv.v.response', 'accepted'] },
                      },
                    },
                  },
                  totalPending: {
                    $size: {
                      $filter: {
                        input: '$invitationStatusArray',
                        as: 'inv',
                        cond: {
                          $or: [
                            { $eq: ['$$inv.v.response', 'pending'] },
                            { $eq: ['$$inv.v.response', 'requested'] },
                          ],
                        },
                      },
                    },
                  },
                  totalRejected: {
                    $size: {
                      $filter: {
                        input: '$invitationStatusArray',
                        as: 'inv',
                        cond: { $eq: ['$$inv.v.response', 'rejected'] },
                      },
                    },
                  },
                },
              },
            },
            // Clean up temporary fields
            { $project: { invitationStatusArray: 0 } },
          ],
          // Get total count
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.dealModel.aggregate(pipeline).exec();

    const data = result?.data || [];
    const total = result?.totalCount?.[0]?.count || 0;

    // Get global stats in parallel (cached for performance)
    const [totalDeals, activeDeals, completedDeals, totalBuyers, totalSellers] = await Promise.all([
      this.dealModel.countDocuments({}).exec(),
      this.dealModel.countDocuments({ status: { $ne: 'completed' } }).exec(),
      this.dealModel.countDocuments({ status: 'completed' }).exec(),
      this.buyerModel.countDocuments({}).exec(),
      this.sellerModel.countDocuments({}).exec(),
    ]);

    return {
      data,
      total,
      page,
      lastPage: Math.ceil(total / limit),
      stats: {
        totalDeals,
        activeDeals,
        completedDeals,
        totalBuyers,
        totalSellers,
      },
    };
  }

  /**
   * Get admin dashboard statistics
   */
  async getAdminDashboardStats(): Promise<{
    totalDeals: number;
    activeDeals: number;
    completedDeals: number;
    loiDeals: number;
    totalBuyers: number;
    totalSellers: number;
    dealsThisMonth: number;
    dealsLastMonth: number;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalDeals,
      activeDeals,
      completedDeals,
      loiDeals,
      totalBuyers,
      totalSellers,
      dealsThisMonth,
      dealsLastMonth,
    ] = await Promise.all([
      this.dealModel.countDocuments({}).exec(),
      this.dealModel.countDocuments({ status: { $nin: ['completed', 'loi'] } }).exec(),
      this.dealModel.countDocuments({ status: 'completed' }).exec(),
      this.dealModel.countDocuments({ status: 'loi' }).exec(),
      this.buyerModel.countDocuments({}).exec(),
      this.sellerModel.countDocuments({}).exec(),
      this.dealModel.countDocuments({ createdAt: { $gte: startOfMonth } }).exec(),
      this.dealModel.countDocuments({
        createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
      }).exec(),
    ]);

    return {
      totalDeals,
      activeDeals,
      completedDeals,
      loiDeals,
      totalBuyers,
      totalSellers,
      dealsThisMonth,
      dealsLastMonth,
    };
  }

  /**
   * Move a deal to LOI (Letter of Intent) status - pauses the deal for LOI negotiations
   */
  async moveDealToLOI(
    dealId: string,
    userId: string,
    userRole?: string,
  ): Promise<Deal> {
    const dealDoc = await this.dealModel.findById(dealId).exec();
    if (!dealDoc) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }

    // Only check seller for sellers; allow admin
    if (userRole !== 'admin' && dealDoc.seller.toString() !== userId) {
      throw new ForbiddenException("You don't have permission to modify this deal");
    }

    // Can only move active deals to LOI
    if (dealDoc.status !== DealStatus.ACTIVE && dealDoc.status !== DealStatus.DRAFT) {
      throw new BadRequestException(`Deal must be active or draft to be paused for LOI. Current status: ${dealDoc.status}`);
    }

    dealDoc.status = DealStatus.LOI;

    // Ensure timeline object exists
    if (!dealDoc.timeline || typeof dealDoc.timeline !== 'object') {
      dealDoc.timeline = {} as any;
    }
    dealDoc.timeline.updatedAt = new Date();
    dealDoc.markModified('timeline');

    // Ensure rewardLevel is set (required)
    if (!dealDoc.rewardLevel) {
      const rewardLevelMap: Record<string, 'Seed' | 'Bloom' | 'Fruit'> = {
        seed: 'Seed',
        bloom: 'Bloom',
        fruit: 'Fruit',
      };
      dealDoc.rewardLevel = rewardLevelMap[(dealDoc.visibility || '').toLowerCase()] || 'Seed';
    }

    const savedDeal = await dealDoc.save();

    // Send LOI pause email notifications
    try {
      const dealIdStr = (dealDoc._id instanceof Types.ObjectId) ? dealDoc._id.toHexString() : String(dealDoc._id);
      const seller = await this.sellerModel.findById(dealDoc.seller).exec();

      // Get active and pending buyers (those with 'accepted' or 'pending' invitation status)
      const activeBuyerIds: string[] = [];
      const pendingBuyerIds: string[] = [];
      if (dealDoc.invitationStatus) {
        const invitationStatusObj = dealDoc.invitationStatus instanceof Map
          ? Object.fromEntries(dealDoc.invitationStatus)
          : dealDoc.invitationStatus;

        for (const [buyerId, status] of Object.entries(invitationStatusObj)) {
          if (status && typeof status === 'object') {
            if ((status as any).response === 'accepted') {
              activeBuyerIds.push(buyerId);
            } else if ((status as any).response === 'pending') {
              pendingBuyerIds.push(buyerId);
            }
          }
        }
      }

      // Fetch active buyers info
      const activeBuyers: { fullName: string; companyName: string; email: string }[] = [];
      for (const buyerId of activeBuyerIds) {
        const buyer = await this.buyerModel.findById(buyerId).exec();
        if (buyer) {
          activeBuyers.push({
            fullName: buyer.fullName,
            companyName: buyer.companyName,
            email: buyer.email,
          });
        }
      }

      // Fetch pending buyers info
      const pendingBuyers: { fullName: string; companyName: string; email: string }[] = [];
      for (const buyerId of pendingBuyerIds) {
        const buyer = await this.buyerModel.findById(buyerId).exec();
        if (buyer) {
          pendingBuyers.push({
            fullName: buyer.fullName,
            companyName: buyer.companyName,
            email: buyer.email,
          });
        }
      }

      // Build active buyers list HTML for project owner
      const activeBuyersHtml = activeBuyers.length > 0
        ? `<p><strong>Active Buyers (${activeBuyers.length}):</strong></p>
           <ul style="margin: 8px 0; padding-left: 20px;">
             ${activeBuyers.map(b => `<li style="margin-bottom: 4px;"><strong>${b.fullName}</strong> - ${b.companyName} (${b.email})</li>`).join('')}
           </ul>`
        : `<p><strong>Active Buyers:</strong> None</p>`;

      // Build pending buyers list HTML for project owner
      const pendingBuyersHtml = pendingBuyers.length > 0
        ? `<p><strong>Pending Buyers (${pendingBuyers.length}):</strong></p>
           <ul style="margin: 8px 0; padding-left: 20px;">
             ${pendingBuyers.map(b => `<li style="margin-bottom: 4px;"><strong>${b.fullName}</strong> - ${b.companyName} (${b.email})</li>`).join('')}
           </ul>`
        : `<p><strong>Pending Buyers:</strong> None</p>`;

      // Email to Project Owner
      const ownerSubject = `Deal Paused for LOI: ${dealDoc.title}`;
      const ownerHtmlBody = genericEmailTemplate(ownerSubject, 'John', `
        <p>A deal has been paused for Letter of Intent (LOI) negotiations.</p>
        <p><strong>Deal:</strong> ${dealDoc.title}</p>
        <p><strong>Seller:</strong> ${seller?.fullName || 'Unknown'} (${seller?.companyName || 'N/A'})</p>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        ${activeBuyersHtml}
        ${pendingBuyersHtml}
      `);
      await this.mailService.sendEmailWithLogging(
        'canotifications@amp-ven.com',
        'admin',
        ownerSubject,
        ownerHtmlBody,
        [ILLUSTRATION_ATTACHMENT],
        dealIdStr,
      );

      // Email to Advisor (Seller)
      if (seller) {
        const advisorSubject = `Your Deal Has Been Paused for LOI`;
        const advisorHtmlBody = genericEmailTemplate(advisorSubject, seller.fullName.split(' ')[0], `
          <p>Your deal <strong>${dealDoc.title}</strong> has been paused for Letter of Intent (LOI) negotiations.</p>
          <p>While your deal is paused, it will not be visible to new buyers on the marketplace. Existing active buyers have been notified about this status change.</p>
          <p>When you are ready to make the deal active again, you can revive it from your LOI Deals dashboard. If the deal does sell please click Off Market and let us know the details of the sale.</p>
          ${emailButton('View LOI Deals', `${process.env.FRONTEND_URL || 'https://app.cimamplify.com'}/seller/loi-deals`)}
        `);
        await this.mailService.sendEmailWithLogging(
          seller.email,
          'seller',
          advisorSubject,
          advisorHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
          dealIdStr,
        );
      }

      // Email to Active Buyers (reuse already fetched buyer data)
      for (const buyer of activeBuyers) {
        const buyerSubject = `Deal Update: ${dealDoc.title} - Paused for LOI`;
        const buyerHtmlBody = genericEmailTemplate(buyerSubject, buyer.fullName.split(' ')[0], `
          <p>The deal <strong>${dealDoc.title}</strong> has been paused by the advisor for Letter of Intent (LOI) negotiations.</p>
          <p>This means the advisor is currently in advanced discussions with a potential buyer. The deal will remain in your Active deals, and you will be notified if it becomes available again.</p>
          <p>In the meantime, feel free to explore other opportunities on CIM Amplify.</p>
          ${emailButton('Browse Marketplace', `${process.env.FRONTEND_URL || 'https://app.cimamplify.com'}/buyer/marketplace`)}
        `);
        await this.mailService.sendEmailWithLogging(
          buyer.email,
          'buyer',
          buyerSubject,
          buyerHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
          dealIdStr,
        );
      }

      // Email to Pending Buyers - give them FOMO to encourage faster response next time
      for (const buyer of pendingBuyers) {
        const buyerSubject = `Deal Update: ${dealDoc.title} - Paused for LOI`;
        const buyerHtmlBody = genericEmailTemplate(buyerSubject, buyer.fullName.split(' ')[0], `
          <p>One of your Pending Deals has gone under LOI before you had a chance to respond. This deal will remain in your Pending Deals until it either becomes active again or is taken off market.</p>
          <p>Please remember that you need to <strong>respond to Pending Deals as soon as possible</strong> so the Advisor who invited you to the deal knows your intentions.</p>
          ${emailButton('See Pending Deals', `${process.env.FRONTEND_URL}/buyer/deals`)}
        `);
        await this.mailService.sendEmailWithLogging(
          buyer.email,
          'buyer',
          buyerSubject,
          buyerHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
          dealIdStr,
        );
      }
    } catch (emailError) {
      // Log email error but don't fail the LOI operation
      console.error('Failed to send LOI pause email notifications:', emailError);
    }

    return savedDeal;
  }

  /**
   * Revive a deal from LOI status back to Active
   */
  async reviveDealFromLOI(
    dealId: string,
    userId: string,
    userRole?: string,
  ): Promise<Deal> {
    const dealDoc = await this.dealModel.findById(dealId).exec();
    if (!dealDoc) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }

    // Only check seller for sellers; allow admin
    if (userRole !== 'admin' && dealDoc.seller.toString() !== userId) {
      throw new ForbiddenException("You don't have permission to modify this deal");
    }

    // Can only revive LOI deals
    if (dealDoc.status !== DealStatus.LOI) {
      throw new BadRequestException(`Deal must be in LOI status to be revived. Current status: ${dealDoc.status}`);
    }

    dealDoc.status = DealStatus.ACTIVE;

    // Ensure timeline object exists
    if (!dealDoc.timeline || typeof dealDoc.timeline !== 'object') {
      dealDoc.timeline = {} as any;
    }
    dealDoc.timeline.updatedAt = new Date();
    dealDoc.markModified('timeline');

    const savedDeal = await dealDoc.save();

    // Send LOI revive email notifications
    try {
      const dealIdStr = (dealDoc._id instanceof Types.ObjectId) ? dealDoc._id.toHexString() : String(dealDoc._id);
      const seller = await this.sellerModel.findById(dealDoc.seller).exec();

      // Get active and pending buyers from invitation status
      const activeBuyerIds: string[] = [];
      const pendingBuyerIds: string[] = [];
      if (dealDoc.invitationStatus) {
        const invitationStatusObj = dealDoc.invitationStatus instanceof Map
          ? Object.fromEntries(dealDoc.invitationStatus)
          : dealDoc.invitationStatus;

        for (const [buyerId, status] of Object.entries(invitationStatusObj)) {
          if (status && typeof status === 'object') {
            const response = (status as any).response;
            if (response === 'accepted') {
              activeBuyerIds.push(buyerId);
            } else if (response === 'pending') {
              pendingBuyerIds.push(buyerId);
            }
          }
        }
      }

      // Fetch active buyers info for project owner email
      const activeBuyers: { fullName: string; companyName: string; email: string }[] = [];
      for (const buyerId of activeBuyerIds) {
        const buyer = await this.buyerModel.findById(buyerId).exec();
        if (buyer) {
          activeBuyers.push({
            fullName: buyer.fullName,
            companyName: buyer.companyName,
            email: buyer.email,
          });
        }
      }

      // Fetch pending buyers info for project owner email
      const pendingBuyers: { fullName: string; companyName: string; email: string }[] = [];
      for (const buyerId of pendingBuyerIds) {
        const buyer = await this.buyerModel.findById(buyerId).exec();
        if (buyer) {
          pendingBuyers.push({
            fullName: buyer.fullName,
            companyName: buyer.companyName,
            email: buyer.email,
          });
        }
      }

      // Build active buyers list HTML for project owner
      const activeBuyersHtml = activeBuyers.length > 0
        ? `<p><strong>Active Buyers (${activeBuyers.length}):</strong></p>
           <ul style="margin: 8px 0; padding-left: 20px;">
             ${activeBuyers.map(b => `<li style="margin-bottom: 4px;"><strong>${b.fullName}</strong> - ${b.companyName} (${b.email})</li>`).join('')}
           </ul>`
        : `<p><strong>Active Buyers:</strong> None</p>`;

      // Build pending buyers list HTML for project owner
      const pendingBuyersHtml = pendingBuyers.length > 0
        ? `<p><strong>Pending Buyers (${pendingBuyers.length}):</strong></p>
           <ul style="margin: 8px 0; padding-left: 20px;">
             ${pendingBuyers.map(b => `<li style="margin-bottom: 4px;"><strong>${b.fullName}</strong> - ${b.companyName} (${b.email})</li>`).join('')}
           </ul>`
        : `<p><strong>Pending Buyers:</strong> None</p>`;

      // Email to Project Owner
      const ownerSubject = `Deal Revived from LOI: ${dealDoc.title}`;
      const ownerHtmlBody = genericEmailTemplate(ownerSubject, 'John', `
        <p>A deal has been revived from Letter of Intent (LOI) status and is now active again.</p>
        <p><strong>Deal:</strong> ${dealDoc.title}</p>
        <p><strong>Seller:</strong> ${seller?.fullName || 'Unknown'} (${seller?.companyName || 'N/A'})</p>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        ${activeBuyersHtml}
        ${pendingBuyersHtml}
      `);
      await this.mailService.sendEmailWithLogging(
        'canotifications@amp-ven.com',
        'admin',
        ownerSubject,
        ownerHtmlBody,
        [ILLUSTRATION_ATTACHMENT],
        dealIdStr,
      );

      // Email to Advisor (Seller)
      if (seller) {
        const advisorSubject = `Your Deal Is Now Active Again`;
        const advisorHtmlBody = genericEmailTemplate(advisorSubject, seller.fullName.split(' ')[0], `
          <p>Your deal <strong>${dealDoc.title}</strong> has been revived and is now active again on CIM Amplify.</p>
          <p>Your deal is now visible on the marketplace, and existing active and pending buyers have been notified that the deal is available again.</p>
          <p>You can manage your deal and view interested buyers from your dashboard.</p>
          ${emailButton('View Dashboard', `${process.env.FRONTEND_URL || 'https://app.cimamplify.com'}/seller/dashboard`)}
        `);
        await this.mailService.sendEmailWithLogging(
          seller.email,
          'seller',
          advisorSubject,
          advisorHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
          dealIdStr,
        );
      }

      // Email to Active Buyers (reuse already fetched buyer data)
      for (const buyer of activeBuyers) {
        const buyerSubject = `Great News: ${dealDoc.title} Is Active Again!`;
        const buyerHtmlBody = genericEmailTemplate(buyerSubject, buyer.fullName.split(' ')[0], `
          <p>The deal <strong>${dealDoc.title}</strong> is now active again on CIM Amplify!</p>
          <p>The advisor has completed their LOI negotiations and the deal is available for new discussions. This is a great opportunity to engage with the advisor if you're still interested.</p>
          <p>View the deal details and reach out to the advisor directly from your Active deals.</p>
          ${emailButton('View Active Deals', `${process.env.FRONTEND_URL || 'https://app.cimamplify.com'}/buyer/deals`)}
        `);
        await this.mailService.sendEmailWithLogging(
          buyer.email,
          'buyer',
          buyerSubject,
          buyerHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
          dealIdStr,
        );
      }

      // Email to Pending Buyers (reuse already fetched buyer data)
      for (const buyer of pendingBuyers) {
        const buyerSubject = `Great News: ${dealDoc.title} Is Active Again!`;
        const buyerHtmlBody = genericEmailTemplate(buyerSubject, buyer.fullName.split(' ')[0], `
          <p>The deal <strong>${dealDoc.title}</strong> is now active again on CIM Amplify!</p>
          <p>The advisor has completed their LOI negotiations and the deal is available for new discussions. This is a great opportunity to continue your interest in this deal.</p>
          <p>View your pending deals and respond to the invitation from the advisor.</p>
          ${emailButton('View My Deals', `${process.env.FRONTEND_URL || 'https://app.cimamplify.com'}/buyer/deals`)}
        `);
        await this.mailService.sendEmailWithLogging(
          buyer.email,
          'buyer',
          buyerSubject,
          buyerHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
          dealIdStr,
        );
      }
    } catch (emailError) {
      // Log email error but don't fail the revive operation
      console.error('Failed to send LOI revive email notifications:', emailError);
    }

    return savedDeal;
  }

  /**
   * Get all LOI deals for a seller
   */
  async getSellerLOIDeals(sellerId: string): Promise<Deal[]> {
    return this.dealModel
      .find({
        seller: sellerId,
        status: DealStatus.LOI,
      })
      .sort({ 'timeline.updatedAt': -1 })
      .exec();
  }
}
