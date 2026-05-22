import { ForbiddenException, Injectable, Inject, forwardRef, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from "@nestjs/common"
import { Deal, DealDocumentType as DealDocument, DealStatus } from "./schemas/deal.schema"
import { CreateDealDto } from "./dto/create-deal.dto"
import { UpdateDealDto } from "./dto/update-deal.dto"
import { Buyer } from '../buyers/schemas/buyer.schema';
import { Seller } from '../sellers/schemas/seller.schema';
import * as fs from "fs"
import * as path from 'path';
import mongoose, { ClientSession, Model, Types } from 'mongoose';
import { InjectModel } from "@nestjs/mongoose"
import { expandCountryOrRegion, findMatchingGeographies } from '../common/geography-hierarchy';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { MailService } from '../mail/mail.service';
import { genericEmailTemplate, emailButton } from '../mail/generic-email.template';
import { ILLUSTRATION_ATTACHMENT } from '../mail/mail.service';
import { getAdminNotificationEmail } from '../common/admin-notification-email';
import { getFrontendUrl } from '../common/frontend-url';
import { getBackendUrl } from '../common/backend-url';
import { DealActionToken, DealActionTokenDocument } from './schemas/deal-action-token.schema';
import { cached, cacheInvalidate } from '../common/memory-cache';
import { TeamMember, TeamMemberDocument } from "../team/schemas/team-member.schema";
import * as crypto from 'crypto';


interface DocumentInfo {
  filename: string
  originalName: string
  path?: string
  base64Content?: string
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
  flaggedInactive?: boolean;
  flaggedInactiveAt?: Date | string | null;
  flaggedInactiveBy?: string | null;
}

interface BuyerEmailRecipient {
  email: string;
  fullName: string;
}

const escapeRegexInput = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const getFirstName = (fullName?: string | null): string => {
  const trimmed = fullName?.trim();
  if (!trimmed) return "User";
  return trimmed.split(/\s+/)[0] || "User";
};
const escapeHtml = (value?: string | null): string =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  // Email-action token signatures rely on JWT_SECRET. We refuse to operate
  // with the legacy 'fallback-secret' in production: a known constant secret
  // would let anyone forge HMAC signatures and mint valid action tokens.
  // In non-production environments we fall back with a loud warning so local
  // dev still works, but production must always have a real secret set.
  private static cachedHmacSecret: string | null = null;
  private getHmacSecret(): string {
    if (DealsService.cachedHmacSecret) return DealsService.cachedHmacSecret;
    const configured = process.env.JWT_SECRET;
    if (configured && configured.length >= 16) {
      DealsService.cachedHmacSecret = configured;
      return configured;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException('Server misconfigured: JWT_SECRET is missing or too short.');
    }
    if (!configured) {
      this.logger.warn('JWT_SECRET is not set. Using insecure fallback for email-action tokens. SET JWT_SECRET BEFORE DEPLOYING.');
    } else {
      this.logger.warn('JWT_SECRET is shorter than 16 characters. Using as-is in dev only. SET A STRONG SECRET BEFORE DEPLOYING.');
    }
    const dev = configured || 'fallback-secret';
    DealsService.cachedHmacSecret = dev;
    return dev;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack || error.message;
    }
    return String(error);
  }

  private extractBuyerIdsForCountSync(deal: DealDocument): string[] {
    const targeted = (deal.targetedBuyers || []).map((id) => id.toString());
    const invitationIds = deal.invitationStatus instanceof Map
      ? Array.from(deal.invitationStatus.keys())
      : Object.keys((deal.invitationStatus as Record<string, unknown>) || {});
    return Array.from(new Set([...targeted, ...invitationIds].filter(Boolean)));
  }

  private async syncBuyerDealCounts(buyerIds: string[], session?: ClientSession): Promise<void> {
    if (buyerIds.length === 0) {
      return;
    }

    for (const buyerId of buyerIds) {
      const deals = await this.dealModel
        .find(
          { targetedBuyers: buyerId, status: { $ne: DealStatus.COMPLETED } },
          { invitationStatus: 1 },
        )
        .session(session ?? null)
        .lean()
        .exec();

      let activeCount = 0;
      let pendingCount = 0;
      let rejectedCount = 0;

      for (const deal of deals) {
        const invitationStatus = (deal as any).invitationStatus || {};
        const buyerStatus = invitationStatus instanceof Map
          ? invitationStatus.get(buyerId)
          : invitationStatus[buyerId];

        if (!buyerStatus?.response) {
          continue;
        }

        if (buyerStatus.response === "accepted") activeCount += 1;
        else if (buyerStatus.response === "pending") pendingCount += 1;
        else if (buyerStatus.response === "rejected") rejectedCount += 1;
      }

      await this.buyerModel
        .updateOne(
          { _id: buyerId },
          {
            $set: {
              activeDealsCount: activeCount,
              pendingDealsCount: pendingCount,
              rejectedDealsCount: rejectedCount,
            },
          },
        )
        .session(session ?? null)
        .exec();
    }
  }

  private async syncBuyerDealCountsForDeal(deal: DealDocument, session?: ClientSession): Promise<void> {
    const buyerIds = this.extractBuyerIdsForCountSync(deal);
    await this.syncBuyerDealCounts(buyerIds, session);
  }

  private async buyerAllowsFeeAboveAmplify(buyerId: string): Promise<boolean> {
    const companyProfileModel = this.dealModel.db.model('CompanyProfile');
    const profile = await companyProfileModel
      .findOne({ buyer: buyerId }, { preferences: 1 })
      .lean()
      .exec() as any;
    return profile?.preferences?.allowBuyerLikeDeals === true;
  }

  private async filterFeeEligibleBuyerIds(buyerIds: string[]): Promise<string[]> {
    if (buyerIds.length === 0) return [];
    const companyProfileModel = this.dealModel.db.model('CompanyProfile');
    const profiles = await companyProfileModel
      .find(
        {
          buyer: { $in: buyerIds },
          "preferences.allowBuyerLikeDeals": true,
        },
        { buyer: 1 },
      )
      .lean()
      .exec() as any[];
    const allowedSet = new Set(profiles.map((p) => String(p.buyer)));
    return buyerIds.filter((id) => allowedSet.has(String(id)));
  }

  private getDealIndustries(deal: Partial<DealDocument>): string[] {
    const sectors = Array.isArray((deal as any).industrySectors)
      ? ((deal as any).industrySectors as string[]).filter(Boolean)
      : [];
    if (sectors.length > 0) {
      return sectors;
    }
    if ((deal as any).industrySector) {
      return [String((deal as any).industrySector)];
    }
    return [];
  }

  constructor(
    @InjectModel(Deal.name) private dealModel: Model<DealDocument>,
    @InjectModel('Buyer') private buyerModel: Model<Buyer>,
    @InjectModel('Seller') private sellerModel: Model<Seller>,
    @InjectModel(TeamMember.name) private teamMemberModel: Model<TeamMemberDocument>,
    @InjectModel(DealActionToken.name) private dealActionTokenModel: Model<DealActionTokenDocument>,
    @Inject(forwardRef(() => MailService)) private mailService: MailService,
  ) { }

  private async getBuyerEmailRecipients(
    buyer: { _id?: unknown; email?: string; fullName?: string },
  ): Promise<BuyerEmailRecipient[]> {
    const ownerId = buyer?._id ? String(buyer._id) : "";
    if (!ownerId) return [];

    const buyerRecord = await this.buyerModel.findById(ownerId, { preferences: 1, email: 1, fullName: 1 }).lean().exec() as any;
    const allowOwnerDealEmails = buyerRecord?.preferences?.receiveDealEmails !== false;

    const activeMembers = await this.teamMemberModel
      .find(
        {
          ownerId,
          ownerType: "buyer",
          isActive: true,
          permissions: "emails",
        },
        { email: 1, fullName: 1, permissions: 1 },
      )
      .lean()
      .exec();

    const recipients: BuyerEmailRecipient[] = [];

    if (allowOwnerDealEmails && buyer.email && buyer.email.trim().length > 0) {
      recipients.push({
        email: buyer.email.trim().toLowerCase(),
        fullName: (buyer.fullName || "").trim() || "User",
      });
    }

    const normalizedTeamRecipients = activeMembers
      .filter((member) => typeof member?.email === "string" && member.email.trim().length > 0)
      .map((member) => ({
        email: member.email.trim().toLowerCase(),
        fullName: (member.fullName || "").trim() || "Team Member",
      }));

    recipients.push(...normalizedTeamRecipients);

    return Array.from(new Map(recipients.map((recipient) => [recipient.email, recipient])).values());
  }


  /**
   * Build the recipient list for seller-targeted deal emails. Mirrors
   * `getBuyerEmailRecipients` on the buyer side:
   *   1. Seller owner, gated by their `preferences.receiveDealEmails` toggle.
   *   2. Seller team members with `permissions: "emails"` and `isActive: true`.
   * Recipients are deduped by email address.
   */
  private async getSellerEmailRecipients(
    seller: { _id?: unknown; email?: string | null; fullName?: string; preferences?: { receiveDealEmails?: boolean } } | any,
  ): Promise<BuyerEmailRecipient[]> {
    if (!seller) return [];
    const ownerId = seller._id ? String(seller._id) : '';

    const ownerEmail =
      typeof seller.email === 'string' && seller.email.trim().length > 0
        ? seller.email.trim().toLowerCase()
        : '';
    const ownerName = (seller.fullName || '').trim() || 'User';

    if (!ownerId) {
      if (seller?.preferences?.receiveDealEmails === false) return [];
      return ownerEmail ? [{ email: ownerEmail, fullName: ownerName }] : [];
    }

    const sellerRecord = (await this.sellerModel
      .findById(ownerId, { preferences: 1, email: 1, fullName: 1 })
      .lean()
      .exec()) as any;
    const allowOwnerDealEmails =
      sellerRecord?.preferences?.receiveDealEmails !== false;

    const activeMembers = await this.teamMemberModel
      .find(
        {
          ownerId,
          ownerType: 'seller',
          isActive: true,
          permissions: 'emails',
        },
        { email: 1, fullName: 1, permissions: 1 },
      )
      .lean()
      .exec();

    const recipients: BuyerEmailRecipient[] = [];

    if (allowOwnerDealEmails && ownerEmail) {
      recipients.push({ email: ownerEmail, fullName: ownerName });
    }

    const normalizedTeamRecipients = activeMembers
      .filter((member) => typeof member?.email === 'string' && member.email.trim().length > 0)
      .map((member) => ({
        email: member.email.trim().toLowerCase(),
        fullName: (member.fullName || '').trim() || 'Team Member',
      }));

    recipients.push(...normalizedTeamRecipients);

    return Array.from(new Map(recipients.map((recipient) => [recipient.email, recipient])).values());
  }

  /**
   * Send a deal-related email to the seller (advisor) and any seller team
   * members with the `emails` permission turned on. Honors the seller's
   * `preferences.receiveDealEmails` toggle on the owner row.
   *
   * Pass the *inner* HTML content (no `genericEmailTemplate` wrapper) so
   * each recipient gets a body addressed to them by name.
   */
  private async sendSellerDealEmail(
    seller:
      | {
          _id?: unknown;
          email?: string | null;
          fullName?: string;
          preferences?: { receiveDealEmails?: boolean };
        }
      | any
      | null,
    subject: string,
    innerContent: string,
    attachments: any[],
    relatedDealId?: string,
    bannerTitle?: string,
  ): Promise<void> {
    const recipients = await this.getSellerEmailRecipients(seller);
    if (recipients.length === 0) {
      if (seller?.email) {
        this.logger.log(
          `Skipping seller deal email to ${seller.email} (no eligible recipients)`,
        );
      }
      return;
    }

    const title = bannerTitle ?? subject;
    await Promise.allSettled(
      recipients.map((recipient) => {
        const htmlBody = genericEmailTemplate(
          title,
          getFirstName(recipient.fullName),
          innerContent,
        );
        return this.mailService.sendEmailWithLogging(
          recipient.email,
          'seller',
          subject,
          htmlBody,
          attachments,
          relatedDealId,
        );
      }),
    );
  }

  /** Invalidate all admin caches after any deal/buyer/seller mutation */
  private invalidateAdminCaches(): void {
    cacheInvalidate('admin:', true);
  }

  /**
   * Stateless HMAC-signed token used by the public NDA download link in
   * introduction/invitation emails. Token format: `<payload>.<signature>`
   * where payload is base64url JSON of `{ dealId, exp }` and signature is an
   * HMAC-SHA256 over the payload using JWT_SECRET. No DB write required.
   */
  createNdaDownloadToken(dealId: string, ttlMs: number = 90 * 24 * 60 * 60 * 1000): string {
    const exp = Date.now() + ttlMs;
    const payload = Buffer.from(JSON.stringify({ dealId, exp })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.getHmacSecret())
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  /**
   * Public URL the email recipient clicks to download the NDA. Hits the
   * backend directly (the file is served from the deal document, not the
   * frontend).
   */
  buildNdaDownloadUrl(dealId: string): string {
    const token = this.createNdaDownloadToken(dealId);
    return `${getBackendUrl()}/deals/nda/${token}`;
  }

  async getNdaForDownload(token: string): Promise<{ buffer: Buffer; filename: string; mimetype: string }> {
    if (!token || typeof token !== 'string') {
      throw new BadRequestException('Missing token');
    }
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new BadRequestException('Invalid token format');
    }
    const [payload, signature] = parts;
    const expectedSignature = crypto
      .createHmac('sha256', this.getHmacSecret())
      .update(payload)
      .digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new BadRequestException('Invalid token signature');
    }
    let parsed: { dealId?: string; exp?: number };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed token');
    }
    if (!parsed.dealId || typeof parsed.exp !== 'number') {
      throw new BadRequestException('Malformed token');
    }
    if (parsed.exp < Date.now()) {
      throw new BadRequestException('Token expired');
    }
    if (!Types.ObjectId.isValid(parsed.dealId)) {
      throw new BadRequestException('Invalid deal id');
    }
    const deal = await this.dealModel.findById(parsed.dealId).exec();
    if (!deal || !deal.ndaDocument || !deal.ndaDocument.base64Content) {
      throw new NotFoundException('NDA not available for this deal');
    }
    return {
      buffer: Buffer.from(deal.ndaDocument.base64Content, 'base64'),
      filename: deal.ndaDocument.originalName || 'NDA',
      mimetype: deal.ndaDocument.mimetype || 'application/octet-stream',
    };
  }

  async createDealActionUrls(dealId: string, buyerId: string): Promise<{ activateUrl: string; passUrl: string }> {
    let activateUrl = `${getFrontendUrl()}/buyer/deals?action=activate&dealId=${dealId}`;
    let passUrl = `${getFrontendUrl()}/buyer/deals?action=pass&dealId=${dealId}`;

    try {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hmacSecret = this.getHmacSecret();
      const signature = crypto.createHmac('sha256', hmacSecret)
        .update(`${rawToken}:${dealId}:${buyerId}`)
        .digest('hex');
      await this.dealActionTokenModel.create({
        token: rawToken,
        signature,
        dealId,
        buyerId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      activateUrl = `${getFrontendUrl()}/deal-action/${rawToken}?action=activate`;
      passUrl = `${getFrontendUrl()}/deal-action/${rawToken}?action=pass`;
    } catch (tokenErr) {
      this.logger.error(`Token creation failed for buyer ${buyerId} on deal ${dealId}: ${(tokenErr as Error).message}. Falling back to dashboard URL.`);
    }

    return { activateUrl, passUrl };
  }

  async createSellerActionUrls(dealId: string, sellerId: string): Promise<{ loiUrl: string; offMarketUrl: string }> {
    let loiUrl = `${getFrontendUrl()}/seller/dashboard?dealId=${encodeURIComponent(dealId)}`;
    let offMarketUrl = `${getFrontendUrl()}/seller/dashboard?dealId=${encodeURIComponent(dealId)}`;

    try {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const signature = crypto
        .createHmac('sha256', this.getHmacSecret())
        .update(`${rawToken}:${dealId}:${sellerId}`)
        .digest('hex');

      await this.dealActionTokenModel.create({
        token: rawToken,
        signature,
        dealId,
        buyerId: null,
        sellerId,
        recipientRole: 'seller',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      loiUrl = `${getFrontendUrl()}/seller-action/${rawToken}?action=loi`;
      offMarketUrl = `${getFrontendUrl()}/seller-action/${rawToken}?action=off-market`;
    } catch (tokenErr) {
      this.logger.error(`Seller token creation failed for seller ${sellerId} on deal ${dealId}: ${(tokenErr as Error).message}. Falling back to dashboard URL.`);
    }

    return { loiUrl, offMarketUrl };
  }

  async createSellerBuyerFlagUrl(dealId: string, sellerId: string, buyerId: string): Promise<string> {
    let flagUrl = `${getFrontendUrl()}/seller/dashboard?dealId=${encodeURIComponent(dealId)}&buyerId=${encodeURIComponent(buyerId)}`;

    try {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const signature = crypto
        .createHmac('sha256', this.getHmacSecret())
        .update(`${rawToken}:${dealId}:${sellerId}:${buyerId}`)
        .digest('hex');

      await this.dealActionTokenModel.create({
        token: rawToken,
        signature,
        dealId,
        buyerId,
        sellerId,
        recipientRole: 'seller',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });

      flagUrl = `${getFrontendUrl()}/seller-action/${rawToken}?action=flag-inactive`;
    } catch (tokenErr) {
      this.logger.error(`Seller buyer flag token creation failed for seller ${sellerId}, buyer ${buyerId}, deal ${dealId}: ${(tokenErr as Error).message}. Falling back to dashboard URL.`);
    }

    return flagUrl;
  }

  async create(createDealDto: CreateDealDto): Promise<Deal> {
    try {
      const dealData = {
        ...createDealDto,
        documents: createDealDto.documents || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const createdDeal = new this.dealModel(dealData)
      const savedDeal = await createdDeal.save()
      this.invalidateAdminCaches();

      // Send email to seller
      const seller = await this.sellerModel.findById(savedDeal.seller).exec();
      if (seller) {
        const subject = "Thank you for adding a new deal to CIM Amplify!";
        const emailContent = `
          <p>We are truly excited to help you find a great buyer for your deal.</p>
          <p>We will let you know via email when your selected buyers are interested and want more information. You can also check your dashboard at any time to see buyer activity.</p>
          ${emailButton('Go to Dashboard', `${getFrontendUrl()}/seller/dashboard`)}
          <p>Please help us to keep the platform up to date by clicking the <b>Off Market button</b> when the deal is sold or paused When the deal is <b> Under LOI button</b>. If sold to one of our introduced buyers we will be in touch to arrange payment of your reward!</p>
          <p>Finally, If your deal did not fetch any buyers, we are always adding new buyers that may match in the future. To watch for new matches simply click Activity on the deal card and then click on the <b>Invite More Buyers</b> button.</p>
        `;

        await this.sendSellerDealEmail(
          seller,
          subject,
          emailContent,
          [ILLUSTRATION_ATTACHMENT], // attachments
          (savedDeal._id as Types.ObjectId).toString(), // relatedDealId
          'CIM Amplify',
        );
      }

      // Send email to project owner
      const ownerSubject = `New Deal - ${savedDeal.title}`;
      const ownerHeading = `New Deal: <strong>${savedDeal.title}</strong>`;
      const trailingRevenueAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(savedDeal.financialDetails?.trailingRevenueAmount || 0);
      const trailingEBITDAAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(savedDeal.financialDetails?.trailingEBITDAAmount || 0);
      const sellerNameForOwner = seller?.fullName || 'Not provided';
      const sellerCompanyForOwner = seller?.companyName || 'Not provided';
      const sellerEmailForOwner = seller?.email || 'Not provided';
      const ownerHtmlBody = genericEmailTemplate(ownerHeading, 'John', `
        <p><b>Seller Name</b>: ${sellerNameForOwner}</p>
        <p><b>Company Name</b>: ${sellerCompanyForOwner}</p>
        <p><b>Seller Email</b>: ${sellerEmailForOwner}</p>
        <p><b>Description</b>: ${savedDeal.companyDescription}</p>
        <p><b>T12 Revenue</b>: ${trailingRevenueAmount}</p>
        <p><b>T12 EBITDA</b>: ${trailingEBITDAAmount}</p>
        <p><b>Reward Level</b>: ${savedDeal.rewardLevel || 'Not set'}</p>
        <p><b>Marketplace</b>: ${savedDeal.isPublic ? 'Yes' : 'No'}</p>
      `);
      await this.mailService.sendEmailWithLogging(
        getAdminNotificationEmail(),
        'admin',
        ownerSubject,
        ownerHtmlBody,
        [ILLUSTRATION_ATTACHMENT],
        (savedDeal._id as Types.ObjectId).toString(),
      );

      return savedDeal
    } catch (error) {
      throw error
    }
  }





  async findAll(filters: { search?: string, buyerResponse?: string, status?: string, isPublic?: string, excludeStatus?: string } = {}, page: number = 1, limit: number = 10): Promise<any> {
    const skip = (page - 1) * limit;
    const query: any = {};

    if (filters.search) {
      const searchRegex = new RegExp(escapeRegexInput(filters.search), 'i');
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

    const pipeline: any[] = [
      { $match: query },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $addFields: {
                invitationStatusArray: {
                  $objectToArray: { $ifNull: ["$invitationStatus", {}] },
                },
              },
            },
            {
              $addFields: {
                buyersByStatus: {
                  active: {
                    $size: {
                      $filter: {
                        input: "$invitationStatusArray",
                        as: "inv",
                        cond: { $eq: ["$$inv.v.response", "accepted"] },
                      },
                    },
                  },
                  pending: {
                    $size: {
                      $filter: {
                        input: "$invitationStatusArray",
                        as: "inv",
                        cond: { $eq: ["$$inv.v.response", "pending"] },
                      },
                    },
                  },
                  rejected: {
                    $size: {
                      $filter: {
                        input: "$invitationStatusArray",
                        as: "inv",
                        cond: { $eq: ["$$inv.v.response", "rejected"] },
                      },
                    },
                  },
                },
              },
            },
            { $project: { invitationStatusArray: 0 } },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const [result] = await this.dealModel.aggregate(pipeline).exec();
    const dealsWithCounts = result?.data || [];
    const totalDeals = result?.totalCount?.[0]?.count || 0;

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

  async findPublicDealsPaginated(
    buyerId: string,
    page = 1,
    limit = 20,
    location?: string,
    industry?: string,
  ): Promise<{ data: any[]; total: number; page: number; lastPage: number }> {
    const skip = (page - 1) * limit;
    const buyerObjectId = mongoose.isValidObjectId(buyerId) ? new Types.ObjectId(buyerId) : null;
    const matchStage: Record<string, any> = {
      isPublic: true,
      status: { $ne: DealStatus.COMPLETED },
      hiddenByBuyers: { $ne: buyerObjectId || buyerId },
    };

    if (location?.trim()) {
      const matchingGeos = findMatchingGeographies(location.trim());
      if (matchingGeos.length > 0) {
        // Match deals whose geographySelection is in the expanded set OR contains the search term
        const locationFilter = {
          $or: [
            { geographySelection: { $in: matchingGeos } },
            { geographySelection: { $regex: escapeRegexInput(location.trim()), $options: "i" } },
          ],
        };
        matchStage.$and = matchStage.$and || [];
        matchStage.$and.push(locationFilter);
      } else {
        matchStage.geographySelection = {
          $regex: escapeRegexInput(location.trim()),
          $options: "i",
        };
      }
    }

    if (industry?.trim()) {
      const industryRegex = {
        $regex: escapeRegexInput(industry.trim()),
        $options: "i",
      };
      const industryFilter = {
        $or: [
          { industrySector: industryRegex },
          { industrySectors: industryRegex },
        ],
      };
      matchStage.$and = matchStage.$and || [];
      matchStage.$and.push(industryFilter);
    }

    const pipeline: any[] = [
      {
        $match: matchStage,
      },
      {
        $addFields: {
          buyerInvitation: {
            $getField: {
              field: buyerId,
              input: { $ifNull: ["$invitationStatus", {}] },
            },
          },
          currentBuyerRequested: {
            $in: [buyerObjectId || buyerId, { $ifNull: ["$targetedBuyers", []] }],
          },
        },
      },
      {
        $match: {
          $or: [
            { "buyerInvitation.response": { $exists: false } },
            { "buyerInvitation.response": null },
            { "buyerInvitation.response": { $nin: ["pending", "accepted", "rejected"] } },
          ],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: limit },
            {
              $addFields: {
                currentBuyerStatus: {
                  $ifNull: ["$buyerInvitation.response", "none"],
                },
              },
            },
            {
              $project: {
                buyerInvitation: 0,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const [result] = await this.dealModel.aggregate(pipeline).exec();
    const data = result?.data || [];
    const total = result?.totalCount?.[0]?.count || 0;

    return {
      data,
      total,
      page,
      lastPage: Math.ceil(total / limit),
    };
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
    await this.syncBuyerDealCountsForDeal(deal);

    // Send introduction emails to both advisor and buyer (same as pending to active)
    try {
      const seller = await this.sellerModel.findById(deal.seller).exec();
      const buyer = await this.buyerModel.findById(buyerId).exec();
      const companyProfile = await this.dealModel.db.model('CompanyProfile').findOne({ buyer: buyerId }).lean();

      if (seller && buyer) {
        // Email to Advisor (Seller)
        const advisorSubject = `${buyer.companyName} is interested in ${deal.title} on CIM Amplify`;
        const advisorContent = `
          <p>${buyer.fullName} at ${buyer.companyName} is interested in learning more about ${deal.title}.  If you attached an NDA to this deal it has already been sent to the buyer for execution.</p>
          <p>Here are the buyer's details, please reach out to them right away:</p>
          <p>
            ${buyer.fullName}<br>
            ${buyer.companyName}<br>
            ${buyer.email}<br>
            ${buyer.phone}<br>
            ${(companyProfile as any)?.website || ''}
          </p>
        `;

        await this.sendSellerDealEmail(
          seller,
          advisorSubject,
          advisorContent,
          [ILLUSTRATION_ATTACHMENT],
          (deal._id as Types.ObjectId).toString(),
        );

        // Email to Buyer with NDA if available
        const buyerSubject = `CIM AMPLIFY INTRODUCTION FOR ${deal.title}`;
        const hasNda = deal.ndaDocument && deal.ndaDocument.base64Content;
        const ndaFileName = hasNda && deal.ndaDocument ? deal.ndaDocument.originalName : '';
        const ndaDownloadUrl = hasNda ? this.buildNdaDownloadUrl((deal._id as Types.ObjectId).toString()) : '';
        const buyerEmailContent = `
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
                          <span style="color: #666; font-size: 12px;">Click below to download</span>
                        </td>
                      </tr>
                    </table>
                    <a href="${ndaDownloadUrl}" target="_blank" style="display: inline-block; margin-top: 12px; padding: 10px 20px; background-color: #3aafa9; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px;">Download NDA</a>
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
          ${emailButton('View Dashboard', `${getFrontendUrl()}/buyer/deals`)}
          <p>If you don't hear back within 2 days, reply to this email and our team will assist.</p>
        `;

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

        const recipients = await this.getBuyerEmailRecipients(buyer as any);
        if (recipients.length === 0) {
          this.logger.warn(`No intro recipients resolved for buyer ${buyerId} on deal ${(deal._id as Types.ObjectId).toString()}`);
        } else {
          await Promise.allSettled(
            recipients.map((recipient) => {
              const buyerHtmlBody = genericEmailTemplate(
                buyerSubject,
                getFirstName(recipient.fullName),
                buyerEmailContent,
              );

              return this.mailService.sendEmailWithLogging(
                recipient.email,
                'buyer',
                buyerSubject,
                buyerHtmlBody,
                buyerAttachments,
                (deal._id as Types.ObjectId).toString(),
              );
            }),
          );
        }

        const sendMarketplaceInviteEmail = false;
        if (sendMarketplaceInviteEmail) {
          const inviteSubject = `YOU ARE INVITED TO PARTICIPATE IN A ${deal.title} DEAL`;
          const ownerEmail = (buyer.email || '').trim().toLowerCase();
          const inviteRecipients = ownerEmail
            ? Array.from(
                new Map(
                  [
                    ...recipients,
                    { email: ownerEmail, fullName: (buyer.fullName || '').trim() || 'User' },
                  ].map((recipient) => [recipient.email, recipient]),
                ).values(),
              )
            : recipients;

          if (inviteRecipients.length === 0) {
            this.logger.warn(`No invite recipients resolved for buyer ${buyerId} on deal ${(deal._id as Types.ObjectId).toString()}`);
          } else {
          let activateUrl = `${getFrontendUrl()}/buyer/deals?action=activate&dealId=${(deal._id as Types.ObjectId).toString()}`;
          let passUrl = `${getFrontendUrl()}/buyer/deals?action=pass&dealId=${(deal._id as Types.ObjectId).toString()}`;

          try {
            const rawToken = crypto.randomBytes(32).toString('hex');
            const hmacSecret = this.getHmacSecret();
            const dealIdStr = (deal._id as Types.ObjectId).toString();
            const signature = crypto.createHmac('sha256', hmacSecret)
              .update(`${rawToken}:${dealIdStr}:${buyerId}`)
              .digest('hex');
            await this.dealActionTokenModel.create({
              token: rawToken,
              signature,
              dealId: dealIdStr,
              buyerId,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            });
            activateUrl = `${getFrontendUrl()}/deal-action/${rawToken}?action=activate`;
            passUrl = `${getFrontendUrl()}/deal-action/${rawToken}?action=pass`;
          } catch (tokenErr) {
            this.logger.error(`Token creation failed for buyer ${buyerId} on deal ${(deal._id as Types.ObjectId).toString()}: ${(tokenErr as Error).message}. Falling back to dashboard URL.`);
          }

          const hasNda = deal.ndaDocument && deal.ndaDocument.base64Content;
          const ndaFileName = hasNda && deal.ndaDocument ? deal.ndaDocument.originalName : '';
          const ndaDownloadUrl = hasNda ? this.buildNdaDownloadUrl((deal._id as Types.ObjectId).toString()) : '';
          const inviteEmailContent = `
            <p><b>Details:</b> ${deal.companyDescription}</p>
            <p><b>T12 Revenue</b>: ${deal.financialDetails?.trailingRevenueAmount ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(deal.financialDetails.trailingRevenueAmount) : '$0'}</p>
            <p><b>T12 EBITDA</b>: ${deal.financialDetails?.trailingEBITDAAmount ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(deal.financialDetails.trailingEBITDAAmount) : '$0'}</p>

            <!-- Action Buttons -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 24px 0;">
              <tr>
                <td align="center">
                  <a href="${passUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: #E35153; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Pass</a>
                </td>
              </tr>
            </table>

            <p>Many of our deals are exclusive first look for CIM Amplify Members only. Head to your CIM Amplify dashboard under Pending to see more details.</p>
            <p>Please keep your dashboard up to date by responding to Pending deals promptly.</p>
            ${emailButton('View Dashboard', `${getFrontendUrl()}/buyer/deals`)}
          `;

          const buyerAttachments: any[] = [ILLUSTRATION_ATTACHMENT];
          if (hasNda && deal.ndaDocument) {
            const ndaBuffer = Buffer.from(deal.ndaDocument.base64Content, 'base64');
            buyerAttachments.push({
              filename: deal.ndaDocument.originalName,
              content: ndaBuffer,
              contentType: deal.ndaDocument.mimetype,
            });
          }

          await Promise.allSettled(
            inviteRecipients.map((recipient) => {
              const inviteHtmlBody = genericEmailTemplate(
                inviteSubject,
                getFirstName(recipient.fullName),
                inviteEmailContent + (hasNda ? `
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
                              <span style="color: #666; font-size: 12px;">Click below to download</span>
                            </td>
                          </tr>
                        </table>
                        <a href="${ndaDownloadUrl}" target="_blank" style="display: inline-block; margin-top: 12px; padding: 10px 20px; background-color: #3aafa9; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px;">Download NDA</a>
                        <p style="margin: 12px 0 0 0; color: #333; font-size: 13px;">
                          <strong>Next steps:</strong> Fill out and sign the NDA, then send it directly to the Advisor at
                          <a href="mailto:${seller.email}" style="color: #3aafa9;">${seller.email}</a>
                        </p>
                      </td>
                    </tr>
                  </table>
                ` : '')
              );

              return this.mailService.sendEmailWithLogging(
                recipient.email,
                'buyer',
                inviteSubject,
                inviteHtmlBody,
                buyerAttachments,
                (deal._id as Types.ObjectId).toString(),
              );
            }),
          );
          }
        }
      }
    } catch (emailError) {
      this.logger.error(`Failed sending request-access emails for deal ${dealId}`, this.formatError(emailError));
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
    await this.syncBuyerDealCountsForDeal(deal);

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
    await this.syncBuyerDealCountsForDeal(deal);

    // Optionally notify buyer that they have been approved and can move to active
    const buyer = await this.buyerModel.findById(buyerId).exec();
    if (buyer) {
      const subject = `You have access to the Marketplace deal`;
      const htmlBody = genericEmailTemplate(subject, getFirstName(buyer.fullName), `
        <p>Your access request for the Marketplace deal was approved. The deal is now available in your Pending tab. Click <strong>Move to Active</strong> to receive an introduction to the advisor.</p>
        ${emailButton('View Pending Deals', `${getFrontendUrl()}/buyer/deals`)}
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
    await this.syncBuyerDealCountsForDeal(deal);

    // Optional: notify buyer
    const buyer = await this.buyerModel.findById(buyerId).exec();
    if (buyer) {
      const subject = `Access request declined for Marketplace deal`;
      const htmlBody = genericEmailTemplate(subject, getFirstName(buyer.fullName), `
        <p>Your request to access the marketplace deal has been declined by the advisor at this time.</p>
        <p>You can continue browsing the marketplace for other opportunities.</p>
        ${emailButton('Browse Marketplace', `${getFrontendUrl()}/buyer/marketplace`)}
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
    if (documentToRemove.path) {
      try {
        if (fs.existsSync(documentToRemove.path)) {
          fs.unlinkSync(documentToRemove.path);
        }
      } catch (error) {
        this.logger.error("Error removing legacy disk file:", this.formatError(error));
      }
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
    // CA 2.2: Deal title is immutable after creation (defense-in-depth alongside DTO whitelist)
    if ((updateDealDto as any).title) {
      throw new ForbiddenException("Deal title cannot be changed after creation");
    }
    // If admin, allow marking as completed regardless of seller
    if (userRole === 'admin' && updateDealDto.status === DealStatus.COMPLETED) {
      deal.status = DealStatus.COMPLETED;
      if (deal.status !== DealStatus.COMPLETED) {
        deal.timeline.completedAt = new Date();
      }
      deal.timeline.updatedAt = new Date();
      await deal.save();
      await this.syncBuyerDealCountsForDeal(deal);
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
            } catch (trackingError) {
              this.logger.error(`Failed to track marketplace opt-out for buyer ${buyerId} on deal ${id}`, this.formatError(trackingError));
            }
            // Email buyer
            try {
              const buyer = await this.buyerModel.findById(buyerId).exec();
              if (buyer) {
                const subject = `${deal.title} is no longer listed in the marketplace`;
                const htmlBody = genericEmailTemplate(subject, getFirstName(buyer.fullName), `
                  <p>Your request to access <strong>${deal.title}</strong> is no longer available because the advisor removed the listing from the marketplace.</p>
                  <p>You can continue browsing the marketplace for other opportunities.</p>
                  ${emailButton('Browse Marketplace', `${getFrontendUrl()}/buyer/marketplace`)}
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
            } catch (emailError) {
              this.logger.error(`Failed to send marketplace opt-out email to buyer ${buyerId} for deal ${id}`, this.formatError(emailError));
            }
          }
        }
      }
    }
    // Handle NDA document update explicitly.
    // Only wipe NDA when the client sends an EXPLICIT null (intentional removal).
    // undefined (key absent or class-transformer default) must never wipe existing data.
    if (updateDealDto.ndaDocument === null) {
      // Explicit removal requested by the client
      deal.ndaDocument = undefined;
      deal.markModified('ndaDocument');
    } else if (updateDealDto.ndaDocument && typeof updateDealDto.ndaDocument === 'object') {
      // New or preserved NDA data provided
      deal.ndaDocument = {
        originalName: updateDealDto.ndaDocument.originalName,
        base64Content: updateDealDto.ndaDocument.base64Content,
        mimetype: updateDealDto.ndaDocument.mimetype,
        size: updateDealDto.ndaDocument.size,
        uploadedAt: updateDealDto.ndaDocument.uploadedAt || new Date(),
      };
      deal.markModified('ndaDocument');
    }
    // If ndaDocument is undefined (absent from payload), do nothing — preserve existing NDA

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
    await this.syncBuyerDealCountsForDeal(deal);
    this.invalidateAdminCaches();
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
          this.logger.error("Error removing document file:", this.formatError(error))
        }
      })
    }

    await this.dealModel.findByIdAndDelete(id).exec()
    this.invalidateAdminCaches();
  }

  async getDealStatistics(sellerId: string): Promise<any> {
    // TODO: replace with $group aggregation for O(1) memory regardless of deal count.
    const deals = await this.dealModel
      .find({ seller: sellerId })
      .select('status interestedBuyers documents')
      .limit(10000)
      .lean()
      .exec() as any[];

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
    const companyProfileModel = this.dealModel.db.model('CompanyProfile');
    const expandedGeos = expandCountryOrRegion(deal.geographySelection);
    const dealIndustries = this.getDealIndustries(deal);
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
      "targetCriteria.industrySectors": { $in: dealIndustries },
      ...extraMatchCondition,
    };
    if (deal.requiresBuyerFeeAboveAmplifyFees) {
      mandatoryQuery["preferences.allowBuyerLikeDeals"] = true;
    }
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
          // Revenue match - deal revenue must be within buyer's min-max range
          revenueMatch: {
            $cond: [
              {
                $and: [
                  {
                    $or: [
                      { $eq: [{ $ifNull: ["$targetCriteria.revenueMin", null] }, null] },
                      { $gte: [{ $ifNull: [deal.financialDetails?.trailingRevenueAmount || 0, 0] }, { $ifNull: ["$targetCriteria.revenueMin", 0] }] }
                    ]
                  },
                  {
                    $or: [
                      { $eq: [{ $ifNull: ["$targetCriteria.revenueMax", null] }, null] },
                      { $lte: [{ $ifNull: [deal.financialDetails?.trailingRevenueAmount || 0, 0] }, { $ifNull: ["$targetCriteria.revenueMax", Number.MAX_SAFE_INTEGER] }] }
                    ]
                  }
                ]
              },
              8, 0
            ]
          },
          // EBITDA match - deal EBITDA must be within buyer's min-max range
          ebitdaMatch: {
            $cond: [
              {
                $and: [
                  {
                    $or: [
                      { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMin", null] }, null] },
                      { $gte: [{ $ifNull: [deal.financialDetails?.trailingEBITDAAmount || 0, 0] }, { $ifNull: ["$targetCriteria.ebitdaMin", 0] }] }
                    ]
                  },
                  {
                    $or: [
                      { $eq: [{ $ifNull: ["$targetCriteria.ebitdaMax", null] }, null] },
                      { $lte: [{ $ifNull: [deal.financialDetails?.trailingEBITDAAmount || 0, 0] }, { $ifNull: ["$targetCriteria.ebitdaMax", Number.MAX_SAFE_INTEGER] }] }
                    ]
                  }
                ]
              },
              8, 0
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
                      "$yearsMatch",
                      "$businessModelMatch",
                      "$capitalAvailabilityMatch",
                      "$companyTypeMatch",
                      "$minTransactionSizeMatch",
                      "$priorAcquisitionsMatch",
                      "$stakePercentageMatch"
                    ]
                  },
                  75 // 10+10+8+8+5+12+4+4+5+5+4 = 75
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
            dealIndustries,
            dealGeography: deal.geographySelection,
            dealRevenue: deal.financialDetails?.trailingRevenueAmount || null,
            dealEbitda: deal.financialDetails?.trailingEBITDAAmount || null,
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

    let eligibleBuyerIds = buyerIds;
    if (deal.requiresBuyerFeeAboveAmplifyFees) {
      eligibleBuyerIds = await this.filterFeeEligibleBuyerIds(buyerIds);
      if (eligibleBuyerIds.length !== buyerIds.length) {
        throw new BadRequestException(
          "One or more selected buyers do not allow buy-side fees above CIM Amplify fees.",
        );
      }
    }

    const existingTargets = deal.targetedBuyers.map((id) => id.toString());
    const newTargets = eligibleBuyerIds.filter((id) => !existingTargets.includes(id));

    // Idempotency cooldown: skip resending an invite to a buyer whose last invite
    // went out in the last 30 seconds. Resends are a legitimate feature (advisor
    // can re-invite a non-responsive buyer) but a duplicate API call from a
    // double-click would otherwise send the invite email twice within seconds.
    const INVITE_RESEND_COOLDOWN_MS = 30_000;
    const now = Date.now();
    const resendEligibleExistingTargets = eligibleBuyerIds.filter((id) => {
      if (!existingTargets.includes(id)) return false;
      const invitation = deal.invitationStatus?.get(id as any);
      const isResendable = invitation?.response === "pending" || invitation?.response === "requested";
      if (!isResendable) return false;
      const lastInvitedAt = invitation?.invitedAt ? new Date(invitation.invitedAt as any).getTime() : 0;
      if (now - lastInvitedAt < INVITE_RESEND_COOLDOWN_MS) {
        this.logger.warn(
          `targetDealToBuyers cooldown skip: deal=${dealId} buyer=${id} invited ${now - lastInvitedAt}ms ago`,
        );
        return false;
      }
      return true;
    });
    const inviteBuyerIds = Array.from(new Set([...newTargets, ...resendEligibleExistingTargets]));

    if (newTargets.length > 0) {
      deal.targetedBuyers = [...deal.targetedBuyers, ...newTargets];

      for (const buyerId of newTargets) {
        deal.invitationStatus.set(buyerId, {
          invitedAt: new Date(),
          response: "pending",
        });
      }
    }

    // Bump invitedAt for resends too, so the cooldown above works on subsequent calls.
    for (const buyerId of resendEligibleExistingTargets) {
      const existing = deal.invitationStatus?.get(buyerId as any);
      if (existing) {
        deal.invitationStatus.set(buyerId, { ...existing, invitedAt: new Date() });
      }
    }

    if (newTargets.length > 0 || resendEligibleExistingTargets.length > 0) {
      // Save deal FIRST so targeting / invitedAt is persisted regardless of email outcome
      deal.timeline.updatedAt = new Date();
      await deal.save();
      await this.syncBuyerDealCountsForDeal(deal);

      const dealIdStr =
        deal._id instanceof Types.ObjectId ? deal._id.toHexString() : String(deal._id);

      // Await email sending before returning — on serverless (Vercel) fire-and-forget
      // tasks are killed when the HTTP response is sent, so emails would never arrive.
      try {
        await this.sendBuyerInviteEmails(deal, inviteBuyerIds, dealIdStr);
      } catch (err) {
        this.logger.error(`Email sending failed for deal ${dealIdStr}: ${err.message}`);
        // Deal is already saved — don't fail the whole request over email errors
      }
    }

    return deal;
  }

  /**
   * Sends invite emails to buyers in batches to avoid Gmail rate limiting.
   * Runs in the background - errors are logged but don't affect the API response.
   */
  private async sendBuyerInviteEmails(
    deal: DealDocument,
    buyerIds: string[],
    dealIdStr: string,
  ): Promise<void> {
    const BATCH_SIZE = 5;
    const DELAY_BETWEEN_BATCHES_MS = 1000; // 1s between batches to respect Gmail rate limits

    const trailingRevenueAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(deal.financialDetails?.trailingRevenueAmount || 0);
    const trailingEBITDAAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(deal.financialDetails?.trailingEBITDAAmount || 0);

    for (let i = 0; i < buyerIds.length; i += BATCH_SIZE) {
      const batch = buyerIds.slice(i, i + BATCH_SIZE);

      // Add delay between batches (skip delay for the first batch)
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }

      await Promise.allSettled(
        batch.map(async (buyerId) => {
          try {
            const buyer = await this.buyerModel.findById(buyerId).exec();
            if (!buyer) return;

            // Generate a unique token for this deal-buyer pair.
            // Token creation is intentionally isolated — if it fails, email still goes out
            // using the dashboard URL as fallback so buyers are never silently skipped.
            let activateUrl: string;
            let passUrl: string;

            try {
              const rawToken = crypto.randomBytes(32).toString('hex');
              const hmacSecret = this.getHmacSecret();
              const signature = crypto.createHmac('sha256', hmacSecret)
                .update(`${rawToken}:${dealIdStr}:${buyerId}`)
                .digest('hex');
              await this.dealActionTokenModel.create({
                token: rawToken,
                signature,
                dealId: dealIdStr,
                buyerId,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              });
              activateUrl = `${getFrontendUrl()}/deal-action/${rawToken}?action=activate`;
              passUrl = `${getFrontendUrl()}/deal-action/${rawToken}?action=pass`;
            } catch (tokenErr) {
              this.logger.error(`Token creation failed for buyer ${buyerId} on deal ${dealIdStr}: ${tokenErr.message}. Falling back to dashboard URL.`);
              activateUrl = `${getFrontendUrl()}/buyer/deals?action=activate&dealId=${dealIdStr}`;
              passUrl = `${getFrontendUrl()}/buyer/deals?action=pass&dealId=${dealIdStr}`;
            }

            const subject = `YOU ARE INVITED TO PARTICIPATE IN A ${trailingEBITDAAmount} EBITDA DEAL`;

            const recipients = await this.getBuyerEmailRecipients(buyer as any);
            const ownerEmail = (buyer.email || '').trim().toLowerCase();
            const inviteRecipients = ownerEmail
              ? Array.from(
                  new Map(
                    [
                      ...recipients,
                      { email: ownerEmail, fullName: (buyer.fullName || '').trim() || 'User' },
                    ].map((recipient) => [recipient.email, recipient]),
                  ).values(),
                )
              : recipients;

            if (inviteRecipients.length === 0) {
              this.logger.warn(`No invite recipients resolved for buyer ${buyerId} on deal ${dealIdStr}`);
              return;
            }

            const buildInviteBody = (recipientName: string) =>
              genericEmailTemplate(subject, getFirstName(recipientName), `
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
                ${emailButton('View Dashboard', `${getFrontendUrl()}/buyer/deals`)}
              `);

            const sendResults = await Promise.allSettled(
              inviteRecipients.map((recipient) => {
                return this.mailService.sendEmailWithLogging(
                  recipient.email,
                  'buyer',
                  subject,
                  buildInviteBody(recipient.fullName),
                  [ILLUSTRATION_ATTACHMENT],
                  dealIdStr,
                );
              }),
            );

            const successfulSends = sendResults.filter((result) => result.status === 'fulfilled').length;
            sendResults.forEach((result, index) => {
              if (result.status === 'rejected') {
                const failedRecipient = inviteRecipients[index];
                this.logger.error(
                  `Invite email failed for recipient ${failedRecipient?.email || 'unknown'} (buyer=${buyerId}, deal=${dealIdStr}): ${this.formatError(result.reason)}`,
                );
              }
            });
            if (successfulSends === 0) {
              const rejectedReasons = sendResults
                .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
                .map((result) => this.formatError(result.reason))
                .join(' | ');
              this.logger.error(
                `Invite email failed for all resolved recipients (buyer=${buyerId}, deal=${dealIdStr}). Reasons: ${rejectedReasons || 'Unknown error'}`,
              );
            }
          } catch (emailError) {
            this.logger.error(`Failed to send invite email to buyer ${buyerId}: ${emailError.message}`);
          }
        }),
      );
    }
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
      await this.syncBuyerDealCountsForDeal(deal)
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

      // Idempotency: if the buyer's response already matches the requested target,
      // skip the save + tracking insert + intro emails. Without this, a buyer
      // double-clicking "Accept" sends the advisor introduction email twice (and
      // the same NDA-bearing buyer email twice).
      const targetResponse = status === "active" ? "accepted" : status
      if (currentInvitation?.response === targetResponse) {
        this.logger.warn(
          `updateDealStatusByBuyer no-op: deal=${dealId} buyer=${buyerId} already ${targetResponse}; skipping duplicate.`,
        )
        return { deal: dealDoc, tracking: null, message: `Deal status already ${status}` }
      }

      const preserveAdvisorFlag = status === "active" && currentInvitation?.flaggedInactive
      const flagFields = preserveAdvisorFlag
        ? {
            flaggedInactive: true,
            flaggedInactiveAt: currentInvitation?.flaggedInactiveAt,
            flaggedInactiveBy: currentInvitation?.flaggedInactiveBy,
          }
        : {
            flaggedInactive: false,
            flaggedInactiveAt: undefined,
            flaggedInactiveBy: undefined,
          }
      dealDoc.invitationStatus.set(buyerId, {
        invitedAt: currentInvitation?.invitedAt || new Date(),
        respondedAt: new Date(),
        response: status === "active" ? "accepted" : status,
        notes: notes || "",
        decisionBy: 'buyer',
        ...flagFields,
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
      await this.syncBuyerDealCountsForDeal(dealDoc as DealDocument);
      // Invalidate this buyer's cached deal lists so the UI shows fresh state immediately
      cacheInvalidate(`buyer:deals:${buyerId}:`, true);
      this.invalidateAdminCaches();

      // Send email notifications based on status
      if (status === "active") {
        // Buyer accepts deal: Send introduction email to seller and buyer
        const seller = await this.sellerModel.findById(dealDoc.seller).exec();
        const buyer = await this.buyerModel.findById(buyerId).exec();
        const companyProfile = await this.dealModel.db.model('CompanyProfile').findOne({ buyer: buyerId }).lean();

        // Email to Advisor (Seller)
        if (seller && buyer) {
          const advisorSubject = `${buyer.companyName} is interested in ${dealDoc.title} on CIM Amplify`;
          const advisorContent = `
            <p>${buyer.fullName} at ${buyer.companyName} is interested in learning more about ${dealDoc.title}.  If you attached an NDA to this deal it has already been sent to the buyer for execution.</p>
            <p>Here are the buyer's details, please reach out to them right away:</p>
            <p>
              ${buyer.fullName}<br>
              ${buyer.companyName}<br>
              ${buyer.email}<br>
              ${buyer.phone}<br>
              ${(companyProfile as any)?.website || ''}
            </p>
          `;

          try {
            await this.sendSellerDealEmail(
              seller,
              advisorSubject,
              advisorContent,
              [ILLUSTRATION_ATTACHMENT], // attachments
              (dealDoc._id as Types.ObjectId).toString(), // relatedDealId
            );
          } catch (advisorEmailError) {
            // Failed to send email to advisor
          }

          const buyerSubject = `CIM AMPLIFY INTRODUCTION FOR ${dealDoc.title}`;
          const hasNda = dealDoc.ndaDocument && dealDoc.ndaDocument.base64Content;
          const ndaFileName = hasNda && dealDoc.ndaDocument ? dealDoc.ndaDocument.originalName : '';
          const ndaDownloadUrl = hasNda ? this.buildNdaDownloadUrl((dealDoc._id as Types.ObjectId).toString()) : '';
          const buyerEmailContent = `
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
                            <span style="color: #666; font-size: 12px;">Click below to download</span>
                          </td>
                        </tr>
                      </table>
                      <a href="${ndaDownloadUrl}" target="_blank" style="display: inline-block; margin-top: 12px; padding: 10px 20px; background-color: #3aafa9; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px;">Download NDA</a>
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
            ${emailButton('View Dashboard', `${getFrontendUrl()}/buyer/deals`)}
            <p>If you don't hear back within 2 days, reply to this email and our team will assist.</p>
          `;

          // Build attachments array - include NDA if available
          const buyerAttachments: any[] = [ILLUSTRATION_ATTACHMENT];
          if (hasNda && dealDoc.ndaDocument) {
            // Convert base64 string to Buffer for nodemailer
            const ndaBuffer = Buffer.from(dealDoc.ndaDocument.base64Content, 'base64');

            buyerAttachments.push({
              filename: dealDoc.ndaDocument.originalName,
              content: ndaBuffer,
              contentType: dealDoc.ndaDocument.mimetype,
            });
          }

          try {
            const recipients = await this.getBuyerEmailRecipients(buyer as any);
            if (recipients.length === 0) {
              this.logger.warn(`No intro recipients resolved for buyer ${buyerId} on deal ${dealId}`);
            } else {
              await Promise.allSettled(
                recipients.map((recipient) => {
                  const buyerHtmlBody = genericEmailTemplate(
                    buyerSubject,
                    getFirstName(recipient.fullName),
                    buyerEmailContent,
                  );

                  return this.mailService.sendEmailWithLogging(
                    recipient.email,
                    'buyer',
                    buyerSubject,
                    buyerHtmlBody,
                    buyerAttachments,
                    (dealDoc._id as Types.ObjectId).toString(), // relatedDealId
                  );
                }),
              );
            }
          } catch (emailError) {
            this.logger.error(`Failed to send activation email for buyer ${buyerId} on deal ${dealId}`, this.formatError(emailError));
          }
        }
      }

      return { deal: dealDoc, tracking, message: `Deal status updated to ${status}` }
    } catch (error) {
      throw new Error(`Failed to update deal status: ${error.message}`)
    }
  }

  // Replace the existing getBuyerDeals method with this improved version
  async getBuyerDeals(buyerId: string, status?: "pending" | "active" | "rejected" | "completed"): Promise<Deal[]> {
    // Per-buyer cache. 15s TTL keeps dashboards responsive without stale-data pain.
    const key = `buyer:deals:${buyerId}:${status || 'all'}`;
    return cached(key, 15_000, () => this.getBuyerDealsUncached(buyerId, status));
  }

  private async getBuyerDealsUncached(buyerId: string, status?: "pending" | "active" | "rejected" | "completed"): Promise<Deal[]> {
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
    const deals = await this.dealModel
      .find({ seller: sellerId })
      .select('_id')
      .limit(10000)
      .lean()
      .exec()

    const dealIds = deals.map((deal: any) => deal._id)

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
      throw new InternalServerErrorException(`Failed to get ever active buyers: ${error.message}`);
    }
  }


  async getDocumentFile(
    dealId: string,
    filename: string,
    userId: string,
    userRole: string,
  ): Promise<{ buffer: Buffer; mimetype: string; originalName: string }> {
    const deal = await this.findOne(dealId);

    const isAdmin = userRole === "admin";
    const isOwningSeller =
      (userRole === "seller" || userRole === "seller-member") &&
      deal.seller?.toString() === userId;

    let isInvitedBuyer = false;
    if (userRole === "buyer" || userRole === "buyer-member") {
      const invitationStatusObj = deal.invitationStatus instanceof Map
        ? Object.fromEntries(deal.invitationStatus)
        : (deal.invitationStatus || {});
      isInvitedBuyer = Object.prototype.hasOwnProperty.call(invitationStatusObj, userId);
    }

    if (!isAdmin && !isOwningSeller && !isInvitedBuyer) {
      throw new ForbiddenException("You do not have permission to access this document");
    }

    const document = deal.documents?.find((doc) => doc.filename === filename);
    if (!document) {
      throw new NotFoundException(`Document ${filename} not found for deal ${dealId}`);
    }
    if (document.base64Content) {
      return {
        buffer: Buffer.from(document.base64Content, "base64"),
        mimetype: document.mimetype,
        originalName: document.originalName,
      };
    }
    if (document.path) {
      const filePath = path.resolve(document.path);
      if (fs.existsSync(filePath)) {
        return {
          buffer: fs.readFileSync(filePath),
          mimetype: document.mimetype,
          originalName: document.originalName,
        };
      }
    }
    throw new NotFoundException(`File ${filename} not found. Legacy disk uploads are no longer available; please re-upload this document.`);
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
          flaggedInactive: !!(status as any).flaggedInactive,
          flaggedInactiveAt: (status as any).flaggedInactiveAt ?? null,
          flaggedInactiveBy: (status as any).flaggedInactiveBy ?? null,
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
      for (const { buyerId, response, flaggedInactive, flaggedInactiveAt, flaggedInactiveBy } of invitationStatusArray) {
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
          flaggedInactive,
          flaggedInactiveAt,
          flaggedInactiveBy,
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
    buyerFromCIM?: boolean,
  ): Promise<Deal> {
    // Permission check needs the current document — load it once up front.
    const existingDeal = await this.dealModel.findById(dealId).select('seller status').lean().exec();
    if (!existingDeal) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }
    if (userRole !== 'admin' && existingDeal.seller.toString() !== userId) {
      throw new ForbiddenException("You don't have permission to close this deal");
    }

    // Atomic claim: only the first concurrent caller flips status -> COMPLETED.
    // Everyone else sees matchedCount === 0 and returns the existing deal without
    // re-running side effects. Without this, rapid duplicate calls (double-clicks,
    // retried requests, multiple browser tabs) resend the "deal is now off market"
    // notice to every active/pending buyer once per call.
    const claimResult = await this.dealModel.updateOne(
      { _id: dealId, status: { $ne: DealStatus.COMPLETED } },
      { $set: { status: DealStatus.COMPLETED } },
    ).exec();

    if (claimResult.matchedCount === 0) {
      this.logger.warn(
        `closeDealseller called on already-completed deal ${dealId} by user ${userId}; skipping duplicate close.`,
      );
      const alreadyCompleted = await this.dealModel.findById(dealId).exec();
      if (!alreadyCompleted) {
        throw new NotFoundException(`Deal with ID "${dealId}" not found`);
      }
      return alreadyCompleted;
    }

    const dealDoc = await this.dealModel.findById(dealId).exec();
    if (!dealDoc) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }

    // Track if this was an LOI deal before closing (read from the pre-claim snapshot).
    const wasLOIDeal = existingDeal.status === DealStatus.LOI;

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
    const rawWinningBuyerId = (() => {
      if (typeof winningBuyerId === 'string') return winningBuyerId.trim();
      if (winningBuyerId && typeof winningBuyerId === 'object' && '_id' in (winningBuyerId as any)) {
        return String((winningBuyerId as any)._id).trim();
      }
      return '';
    })();
    const normalizedWinningBuyerId = Types.ObjectId.isValid(rawWinningBuyerId) ? rawWinningBuyerId : '';
    const existingWinningBuyerId = dealDoc.closedWithBuyer ? String(dealDoc.closedWithBuyer).trim() : '';
    const explicitlyNonCimBuyer = buyerFromCIM === false;

    const acceptedBuyerIds: string[] = [];
    if (dealDoc.invitationStatus instanceof Map) {
      dealDoc.invitationStatus.forEach((status, buyerId) => {
        if (status?.response === 'accepted') {
          acceptedBuyerIds.push(String(buyerId));
        }
      });
    } else if (dealDoc.invitationStatus && typeof dealDoc.invitationStatus === 'object') {
      Object.entries(dealDoc.invitationStatus as Record<string, any>).forEach(([buyerId, status]) => {
        if ((status as any)?.response === 'accepted') {
          acceptedBuyerIds.push(String(buyerId));
        }
      });
    }

    const inferredAcceptedBuyerId = acceptedBuyerIds.length === 1 ? acceptedBuyerIds[0] : '';
    const resolvedWinningBuyerId = explicitlyNonCimBuyer
      ? ''
      : (normalizedWinningBuyerId || existingWinningBuyerId || inferredAcceptedBuyerId);
    const winningBuyer = resolvedWinningBuyerId && Types.ObjectId.isValid(resolvedWinningBuyerId)
      ? await this.buyerModel.findById(resolvedWinningBuyerId).exec()
      : null;
    const hasCimAmplifyWinningBuyer = !explicitlyNonCimBuyer && !!winningBuyer;
    const shouldMarkAsCimAmplify = !explicitlyNonCimBuyer && (
      buyerFromCIM === true ||
      !!winningBuyer ||
      !!normalizedWinningBuyerId ||
      !!existingWinningBuyerId ||
      !!inferredAcceptedBuyerId
    );

    const trackingData: any = {
      deal: dealId,
      interactionType: 'completed',
      timestamp: new Date(),
      notes: notes || 'Deal closed by seller',
      metadata: {
        finalSalePrice,
        winningBuyerId: winningBuyer?._id?.toString() || normalizedWinningBuyerId || null,
        buyerFromCIM: buyerFromCIM ?? null,
      },
    };

    dealDoc.closedWithCimAmplify = shouldMarkAsCimAmplify;
    dealDoc.markModified('closedWithCimAmplify');

    if (hasCimAmplifyWinningBuyer) {
      trackingData.buyer = winningBuyer!._id.toString();
      // Store buyer info in the deal document
      dealDoc.closedWithBuyer = winningBuyer!._id.toString();
      dealDoc.closedWithBuyerCompany = winningBuyer!.companyName || '';
      dealDoc.closedWithBuyerEmail = winningBuyer!.email || '';
      dealDoc.markModified('closedWithBuyer');
      dealDoc.markModified('closedWithBuyerCompany');
      dealDoc.markModified('closedWithBuyerEmail');
    } else if (shouldMarkAsCimAmplify && normalizedWinningBuyerId) {
      // Preserve selected buyer id even if buyer lookup fails to avoid losing CIM close attribution.
      dealDoc.closedWithBuyer = normalizedWinningBuyerId as any;
      dealDoc.markModified('closedWithBuyer');
    }

    const tracking = new dealTrackingModel(trackingData);
    await tracking.save();
    const savedDeal = await dealDoc.save();
    await this.syncBuyerDealCountsForDeal(dealDoc as DealDocument);

    // Phase 4.1: When a deal goes off market (sold to CIM Amplify buyer)
    if (hasCimAmplifyWinningBuyer) {
      const seller = await this.sellerModel.findById(userId).exec();

      if (seller && winningBuyer) {
        const dealIdStr = (dealDoc._id instanceof Types.ObjectId) ? dealDoc._id.toHexString() : String(dealDoc._id);
        // Email to Advisor (Seller). Isolated so a failure cannot cancel the
        // owner email below or the buyer notifications further down.
        const advisorSubject = `Thank you for using CIM Amplify!`;
        const advisorContent = `
          <p>Thank you so much for posting your deal on CIM Amplify! We will be in touch to send you your reward once we have contacted the buyer. This process should not take long but feel free to contact us anytime for an update.</p>
          <p>We hope that you will post with us again soon!</p>
        `;
        try {
          await this.sendSellerDealEmail(
            seller,
            advisorSubject,
            advisorContent,
            [ILLUSTRATION_ATTACHMENT],
            dealIdStr,
          );
        } catch (advisorErr) {
          this.logger.error(`Off-market advisor thank-you email failed for deal ${dealIdStr}: ${this.formatError(advisorErr)}`);
        }

        // Email to Buyer
        // const buyerSubject = `Congratulations on your new acquisition!`;
        // const buyerHtmlBody = genericEmailTemplate(buyerSubject, getFirstName(winningBuyer.fullName), `
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
        try {
          await this.mailService.sendEmailWithLogging(
            getAdminNotificationEmail(),
            'admin',
            ownerSubject,
            ownerHtmlBody,
            [ILLUSTRATION_ATTACHMENT],
            dealIdStr,
          );
        } catch (ownerErr) {
          this.logger.error(`Off-market owner email failed for deal ${dealIdStr}: ${this.formatError(ownerErr)}`);
        }
      }
    } else {
      // Phase 4.2: When a deal goes off market (not sold)
      const seller = await this.sellerModel.findById(userId).exec();
      if (seller) {
        const subject = `Thank you for using CIM Amplify!`;
        const content = `
          <p>Thank you so much for posting ${dealDoc.title} on CIM Amplify!</p>
          <p>We apologize deeply for not helping much with this deal! Fortunately we are adding new buyers daily and we hope that you will post with us again soon! Enjoy your gift card as our appreciation of your hard work.</p>
        `;
        const dealIdStr = (dealDoc._id instanceof Types.ObjectId) ? dealDoc._id.toHexString() : String(dealDoc._id);
        try {
          await this.sendSellerDealEmail(
            seller,
            subject,
            content,
            [ILLUSTRATION_ATTACHMENT],
            dealIdStr,
          );
        } catch (sellerErr) {
          this.logger.error(`Off-market not-sold thank-you email failed for deal ${dealIdStr}: ${this.formatError(sellerErr)}`);
        }
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
            const winningBuyerIdToSkip = winningBuyer?._id ? winningBuyer._id.toString() : null;
            if (!winningBuyerIdToSkip || buyerId !== winningBuyerIdToSkip) {
              buyerIdsToNotify.push(buyerId);
            }
          }
        });

        if (buyerIdsToNotify.length > 0) {
          const buyers = await this.buyerModel.find({ _id: { $in: buyerIdsToNotify } }).exec();

          // Per-recipient settle so a single failed send (Gmail rate limit,
          // transient SMTP error, bad address) does not silently skip every
          // remaining buyer in the loop. sendEmailWithLogging already enqueues
          // its own retry on failure, so the rejection here just keeps us moving.
          const sendResults = await Promise.allSettled(
            buyers.map(async (buyer) => {
              const buyerStatus = invitationStatus.get(buyer._id.toString());
              const wasActive = buyerStatus?.response === 'accepted';
              const wasPending = buyerStatus?.response === 'pending';

              const subject = `Deal Update: ${dealDoc.title} is now off market`;

              let emailContent = '';
              if (wasActive) {
                emailContent = `
                  <p>We wanted to let you know that <strong>${dealDoc.title}</strong> is now off market.Thank you for reviewing this deal!</p>
                  <p>We will send you an email when you are invited to participate in new deals and there are lots of in Marketplace for you to review.</p>
                  <p>If you have deals sitting in Pending please respond ASAP as advisors are waiting for your response.</p>
                  ${emailButton('View Available Deals', `${getFrontendUrl()}/buyer/deals`)}
                  <p>Stay tuned for more opportunities!</p>
                `;
              } else if (wasPending) {
                emailContent = `
                  <p>We wanted to let you know that <strong>${dealDoc.title}</strong> is now off market.</p>
                  <p>This deal was in your Pending Deals. Please make sure to <strong>respond to Pending Deals as soon as possible</strong> so the Advisor who invited you to the deal knows your intentions.</p>
                  <p>Check out other available deals on your dashboard. Also, check out Marketplace on your dashboard for deals that Advisors have posted to all CIM Amplify Members.</p>
                  ${emailButton('View Available Deals', `${getFrontendUrl()}/buyer/deals`)}
                  <p>Stay tuned for more opportunities!</p>
                `;
              }

              const htmlBody = genericEmailTemplate(subject, getFirstName(buyer.fullName), emailContent);

              return this.mailService.sendEmailWithLogging(
                buyer.email,
                'buyer',
                subject,
                htmlBody,
                [ILLUSTRATION_ATTACHMENT],
                dealIdStr,
              );
            }),
          );

          sendResults.forEach((result, idx) => {
            if (result.status === 'rejected') {
              const failedBuyer = buyers[idx];
              this.logger.error(
                `Off-market email failed for buyer ${failedBuyer?.email || 'unknown'} (deal=${dealIdStr}): ${this.formatError(result.reason)}`,
              );
            }
          });
        }
      }
    } catch (error) {
      // Log but don't fail the operation if notification emails fail
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
        const invitationStatusObj = deal.invitationStatus instanceof Map
          ? deal.invitationStatus.get(String(buyer._id))
          : (deal.invitationStatus as any)?.[String(buyer._id)];

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
        buyer.flaggedInactive = !!invitationStatusObj?.flaggedInactive;
        buyer.flaggedInactiveAt = invitationStatusObj?.flaggedInactiveAt || null;
        buyer.flaggedInactiveBy = invitationStatusObj?.flaggedInactiveBy || null;
      }

      return interestedBuyers.sort(
        (a, b) => new Date(b.lastInteraction || 0).getTime() - new Date(a.lastInteraction || 0).getTime(),
      );
    } catch (error) {
      throw new InternalServerErrorException(`Failed to get interested buyers details: ${error.message}`);
    }
  }

  async flagInterestedBuyerInactive(dealId: string, buyerId: string, actorRole: 'seller' | 'admin' = 'seller'): Promise<Deal> {
    const deal = await this.dealModel.findById(dealId).exec();
    if (!deal) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }

    const buyerExists = (deal.interestedBuyers || []).map(String).includes(String(buyerId));
    if (!buyerExists) {
      throw new BadRequestException('Buyer is not associated with this deal.');
    }

    const current = deal.invitationStatus instanceof Map
      ? deal.invitationStatus.get(String(buyerId))
      : (deal.invitationStatus as any)?.[String(buyerId)];

    // Idempotency: if the buyer is already flagged inactive, skip the save and
    // the "marked you as inactive" email. Otherwise rapid duplicate clicks send
    // the same notice multiple times to the buyer.
    if (current?.flaggedInactive === true) {
      this.logger.warn(
        `flagInterestedBuyerInactive no-op: deal=${dealId} buyer=${buyerId} already flagged inactive; skipping duplicate.`,
      );
      return deal;
    }

    const updatedStatus = {
      invitedAt: current?.invitedAt,
      respondedAt: current?.respondedAt,
      response: 'rejected',
      notes: current?.notes,
      decisionBy: current?.decisionBy,
      introFollowUpSentAt: current?.introFollowUpSentAt,
      previousStatus: current?.response || 'accepted',
      flaggedInactive: true,
      flaggedInactiveAt: new Date(),
      flaggedInactiveBy: actorRole,
    } as any;

    if (!(deal.invitationStatus instanceof Map)) {
      deal.invitationStatus = new Map(Object.entries(deal.invitationStatus || {})) as any;
    }

    deal.invitationStatus.set(String(buyerId), updatedStatus);
    deal.markModified('invitationStatus');
    const savedDeal = await deal.save();

    try {
      const [seller, buyer] = await Promise.all([
        this.sellerModel.findById(deal.seller).exec(),
        this.buyerModel.findById(buyerId).exec(),
      ]);

      if (seller && buyer) {
        const advisorCompany = seller.companyName || seller.fullName || 'The Advisor';
        const dealTitle = savedDeal.title || 'this deal';
        const dashboardUrl = `${getFrontendUrl()}/buyer/deals?tab=passed&dealId=${encodeURIComponent(dealId)}`;
        const subject = `${advisorCompany} marked you as inactive on ${dealTitle}`;
        const recipients = await this.getBuyerEmailRecipients(buyer as any);

        if (recipients.length === 0) {
          this.logger.warn(`No buyer recipients resolved for flagged-inactive email: buyer=${buyerId}, deal=${dealId}`);
        } else {
          await Promise.allSettled(
            recipients.map((recipient) => {
              const firstName = getFirstName(recipient.fullName);
              const htmlBody = genericEmailTemplate(
                subject,
                firstName,
                `
                  <p>Dear ${escapeHtml(firstName)},</p>
                  <p>${escapeHtml(advisorCompany)} marked you as inactive on ${escapeHtml(dealTitle)} which means you have not communicated further on this deal. We have moved this deal to your Passed folder. If this is an error, you can click on Reactivate on this deal from your Passed dashboard.</p>
                  ${emailButton('Open Passed Dashboard', dashboardUrl)}
                  <p>Feel free to reply to this email if you need further assistance.</p>
                `,
                true,
              );

              return this.mailService.sendEmailWithLogging(
                recipient.email,
                'buyer',
                subject,
                htmlBody,
                [ILLUSTRATION_ATTACHMENT],
                dealId,
              );
            }),
          );
        }
      }
    } catch (emailError) {
      this.logger.error(`Failed to send flagged-inactive email to buyer ${buyerId} for deal ${dealId}`, this.formatError(emailError));
    }

    return savedDeal;
  }

  async getAllCompletedDeals(): Promise<Deal[]> {
    try {
      return await this.dealModel.find({ status: 'completed' }).select('+rewardLevel').exec();
    } catch (error) {
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
      throw new InternalServerErrorException(`Failed to fetch deals with accepted invitations: ${error.message}`);
    }
  }

  async getBuyerEngagementDashboard(sellerId: string): Promise<any> {
    try {
      const deals = await this.dealModel
        .find({ seller: sellerId })
        .select('_id')
        .limit(10000)
        .lean()
        .exec();
      const dealIds = deals.map((deal: any) => deal._id);

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
    // Cache per unique filter+page combo for 30s. Dashboard fires 4 sequential
    // calls (one per status bucket); each is cached so tab-switches and refetches
    // are free, and React Query refetchInterval becomes almost cost-free.
    // Skip cache for search (user-typed, high cardinality) to avoid pollution.
    if (!filters.search) {
      const cacheKey = `admin:deals:${JSON.stringify(filters)}:p${page}:l${limit}`;
      return cached(cacheKey, 30_000, () => this.findAllAdminOptimizedUncached(filters, page, limit));
    }
    return this.findAllAdminOptimizedUncached(filters, page, limit);
  }

  async getAdminTabCounts(search: string = ''): Promise<{
    active: number;
    offMarket: number;
    allDeals: number;
    loi: number;
  }> {
    const baseMatch: any = {};

    if (search) {
      const searchRegex = new RegExp(escapeRegexInput(search), 'i');
      baseMatch.$or = [
        { title: searchRegex },
        { companyDescription: searchRegex },
        { industrySector: searchRegex },
      ];
    }

    const [result] = await this.dealModel.aggregate([
      { $match: baseMatch },
      {
        $facet: {
          active: [
            {
              $match: {
                status: { $nin: ['completed', 'loi'] },
                $expr: {
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
                },
              },
            },
            { $count: 'count' },
          ],
          offMarket: [{ $match: { status: 'completed' } }, { $count: 'count' }],
          allDeals: [{ $match: { status: { $ne: 'completed' } } }, { $count: 'count' }],
          loi: [{ $match: { status: 'loi' } }, { $count: 'count' }],
        },
      },
    ]).exec();

    return {
      active: result?.active?.[0]?.count || 0,
      offMarket: result?.offMarket?.[0]?.count || 0,
      allDeals: result?.allDeals?.[0]?.count || 0,
      loi: result?.loi?.[0]?.count || 0,
    };
  }

  private async findAllAdminOptimizedUncached(
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
      const searchRegex = new RegExp(escapeRegexInput(filters.search), 'i');
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
                let: {
                  sellerId: {
                    $cond: [
                      { $eq: [{ $type: '$seller' }, 'objectId'] },
                      '$seller',
                      {
                        $convert: {
                          input: '$seller',
                          to: 'objectId',
                          onError: null,
                          onNull: null,
                        },
                      },
                    ],
                  },
                },
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
            {
              $lookup: {
                from: 'dealtrackings',
                let: { dealId: '$_id' },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$deal', '$$dealId'] },
                          { $eq: ['$interactionType', 'completed'] },
                        ],
                      },
                    },
                  },
                  { $sort: { timestamp: -1 } },
                  { $limit: 1 },
                  {
                    $project: {
                      _id: 0,
                      buyerFromCIM: '$metadata.buyerFromCIM',
                      winningBuyerId: '$metadata.winningBuyerId',
                    },
                  },
                ],
                as: 'completionTracking',
              },
            },
            {
              $addFields: {
                closedWithBuyer: {
                  $ifNull: [
                    '$closedWithBuyer',
                    {
                      $convert: {
                        input: { $arrayElemAt: ['$completionTracking.winningBuyerId', 0] },
                        to: 'objectId',
                        onError: null,
                        onNull: null,
                      },
                    },
                  ],
                },
                closedWithCimAmplify: {
                  $ifNull: [
                    '$closedWithCimAmplify',
                    {
                      $or: [
                        { $eq: [{ $arrayElemAt: ['$completionTracking.buyerFromCIM', 0] }, true] },
                        {
                          $gt: [
                            {
                              $strLenCP: {
                                $ifNull: [
                                  {
                                    $convert: {
                                      input: '$closedWithBuyer',
                                      to: 'string',
                                      onError: '',
                                      onNull: '',
                                    },
                                  },
                                  '',
                                ],
                              },
                            },
                            0,
                          ],
                        },
                        { $gt: [{ $strLenCP: { $ifNull: ['$closedWithBuyerCompany', ''] } }, 0] },
                        { $gt: [{ $strLenCP: { $ifNull: ['$closedWithBuyerEmail', ''] } }, 0] },
                      ],
                    },
                  ],
                },
              },
            },
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
            { $project: { invitationStatusArray: 0, completionTracking: 0 } },
          ],
          // Get total count
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.dealModel.aggregate(pipeline).exec();

    const data = result?.data || [];
    const total = result?.totalCount?.[0]?.count || 0;

    // Global stats change slowly — cache for 60s so 4+ sequential admin calls
    // share a single Mongo round-trip block instead of 5 × N.
    const { totalDeals, activeDeals, completedDeals, totalBuyers, totalSellers } =
      await cached('admin:global-counts', 60_000, async () => {
        const [td, ad, cd, tb, ts] = await Promise.all([
          this.dealModel.countDocuments({}).exec(),
          this.dealModel.countDocuments({ status: { $ne: 'completed' } }).exec(),
          this.dealModel.countDocuments({ status: 'completed' }).exec(),
          this.buyerModel.countDocuments({}).exec(),
          this.sellerModel.countDocuments({}).exec(),
        ]);
        return { totalDeals: td, activeDeals: ad, completedDeals: cd, totalBuyers: tb, totalSellers: ts };
      });

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
    marketplaceDeals: number;
    dealsPreviousWeek: number;
    buyersPreviousWeek: number;
    dealsCurrentWeek: number;
    buyersCurrentWeek: number;
    previousWeekStart: string;
    previousWeekEnd: string;
    currentWeekStart: string;
    activeRevenueSize: number;
    activeEbitdaSize: number;
    totalRevenueSize: number;
    totalEbitdaSize: number;
    totalInvitations: number;
    buyerResponseSummary: {
      accepted: number;
      pending: number;
      rejected: number;
      totalInvitations: number;
    };
    rewardLevelBreakdown: {
      seed: number;
      bloom: number;
      fruit: number;
    };
    dealValueDistribution: Array<{ name: string; deals: number }>;
    dealsTrendLast6Months: Array<{ month: string; deals: number }>;
    buyerReferralSources: Array<{ name: string; value: number }>;
    sellerReferralSources: Array<{ name: string; value: number }>;
    industryBreakdown: Array<{ name: string; value: number }>;
  }> {
    // This method fires ~21 parallel queries (countDocuments + aggregations).
    // Cache 60s — dashboard stats don't need second-level accuracy.
    return cached('admin:dashboard-stats', 60_000, () => this.computeAdminDashboardStats());
  }

  private async computeAdminDashboardStats(): Promise<any> {
    const getStartOfWeekMonday = (date: Date): Date => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const day = (d.getDay() + 6) % 7; // Monday=0 ... Sunday=6
      d.setDate(d.getDate() - day);
      return d;
    };

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const startOfCurrentWeek = getStartOfWeekMonday(now);
    const startOfPreviousWeek = new Date(startOfCurrentWeek);
    startOfPreviousWeek.setDate(startOfPreviousWeek.getDate() - 7);
    const endOfPreviousWeek = new Date(startOfCurrentWeek);
    endOfPreviousWeek.setDate(endOfPreviousWeek.getDate() - 1);

    const [
      totalDeals,
      activeDeals,
      completedDeals,
      loiDeals,
      totalBuyers,
      totalSellers,
      dealsThisMonth,
      dealsLastMonth,
      marketplaceDeals,
      dealsPreviousWeek,
      buyersPreviousWeek,
      dealsCurrentWeek,
      buyersCurrentWeek,
      activeRevenueAgg,
      activeEbitdaAgg,
      revenueAgg,
      ebitdaAgg,
      invitationsAgg,
      buyerResponseAgg,
      rewardLevelAgg,
      dealValueDistributionAgg,
      dealsTrendAgg,
      buyerReferralSourcesAgg,
      sellerReferralSourcesAgg,
      industryBreakdownAgg,
    ] = await Promise.all([
      this.dealModel.countDocuments({}).exec(),
      this.dealModel.countDocuments({ status: 'active' }).exec(),
      this.dealModel.countDocuments({ status: 'completed' }).exec(),
      this.dealModel.countDocuments({ status: 'loi' }).exec(),
      this.buyerModel.countDocuments({}).exec(),
      this.sellerModel.countDocuments({}).exec(),
      this.dealModel.countDocuments({ createdAt: { $gte: startOfMonth } }).exec(),
      this.dealModel.countDocuments({
        createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth },
      }).exec(),
      // Public marketplace listings that are still open (not completed/off-market)
      this.dealModel.countDocuments({ isPublic: true, status: { $ne: 'completed' } }).exec(),
      this.dealModel.countDocuments({
        createdAt: { $gte: startOfPreviousWeek, $lt: startOfCurrentWeek },
      }).exec(),
      this.buyerModel.countDocuments({
        createdAt: { $gte: startOfPreviousWeek, $lt: startOfCurrentWeek },
      }).exec(),
      this.dealModel.countDocuments({
        createdAt: { $gte: startOfCurrentWeek },
      }).exec(),
      this.buyerModel.countDocuments({
        createdAt: { $gte: startOfCurrentWeek },
      }).exec(),
      // Active deals financial totals.
      // "Active" matches the Accepted Deals definition used elsewhere on the
      // admin overview: not completed/loi, with at least one accepted buyer
      // in invitationStatus. Mirrors findAllAdminOptimized's buyerResponse=accepted
      // branch.
      this.dealModel.aggregate([
        {
          $match: {
            status: { $nin: ['completed', 'loi'] },
            $expr: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: { $objectToArray: { $ifNull: ['$invitationStatus', {}] } },
                      as: 'item',
                      cond: { $eq: ['$$item.v.response', 'accepted'] },
                    },
                  },
                },
                0,
              ],
            },
          },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$financialDetails.trailingRevenueAmount', 0] } } } },
      ]).exec(),
      this.dealModel.aggregate([
        {
          $match: {
            status: { $nin: ['completed', 'loi'] },
            $expr: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: { $objectToArray: { $ifNull: ['$invitationStatus', {}] } },
                      as: 'item',
                      cond: { $eq: ['$$item.v.response', 'accepted'] },
                    },
                  },
                },
                0,
              ],
            },
          },
        },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$financialDetails.trailingEBITDAAmount', 0] } } } },
      ]).exec(),
      // System-wide totals across all deals
      this.dealModel.aggregate([
        { $group: { _id: null, total: { $sum: { $ifNull: ['$financialDetails.trailingRevenueAmount', 0] } } } },
      ]).exec(),
      this.dealModel.aggregate([
        { $group: { _id: null, total: { $sum: { $ifNull: ['$financialDetails.trailingEBITDAAmount', 0] } } } },
      ]).exec(),
      this.dealModel.aggregate([
        { $project: { targetedCount: { $size: { $ifNull: ['$targetedBuyers', []] } } } },
        { $group: { _id: null, total: { $sum: '$targetedCount' } } },
      ]).exec(),
      this.dealModel.aggregate([
        { $project: { invitationEntries: { $objectToArray: { $ifNull: ['$invitationStatus', {}] } } } },
        { $unwind: { path: '$invitationEntries', preserveNullAndEmptyArrays: false } },
        {
          $group: {
            _id: null,
            accepted: {
              $sum: { $cond: [{ $eq: ['$invitationEntries.v.response', 'accepted'] }, 1, 0] },
            },
            pending: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: ['$invitationEntries.v.response', 'pending'] },
                      { $eq: ['$invitationEntries.v.response', 'requested'] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            rejected: {
              $sum: { $cond: [{ $eq: ['$invitationEntries.v.response', 'rejected'] }, 1, 0] },
            },
          },
        },
      ]).exec(),
      this.dealModel.aggregate([
        { $project: { rewardLower: { $toLower: { $ifNull: ['$rewardLevel', ''] } } } },
        {
          $group: {
            _id: null,
            seed: { $sum: { $cond: [{ $eq: ['$rewardLower', 'seed'] }, 1, 0] } },
            bloom: { $sum: { $cond: [{ $eq: ['$rewardLower', 'bloom'] }, 1, 0] } },
            fruit: { $sum: { $cond: [{ $eq: ['$rewardLower', 'fruit'] }, 1, 0] } },
          },
        },
      ]).exec(),
      this.dealModel.aggregate([
        { $project: { askingPrice: { $ifNull: ['$financialDetails.askingPrice', 0] } } },
        {
          $bucket: {
            groupBy: '$askingPrice',
            boundaries: [0, 1000000, 5000000, 10000000, 50000000, Number.MAX_VALUE],
            default: 'other',
            output: { count: { $sum: 1 } },
          },
        },
      ]).exec(),
      this.dealModel.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
            },
            deals: { $sum: 1 },
          },
        },
      ]).exec(),
      this.buyerModel.aggregate([
        {
          $project: {
            normalizedSource: {
              $trim: { input: { $ifNull: ['$referralSource', ''] } },
            },
          },
        },
        {
          $project: {
            source: {
              $cond: [
                { $eq: ['$normalizedSource', ''] },
                'Unknown',
                '$normalizedSource',
              ],
            },
          },
        },
        { $group: { _id: '$source', value: { $sum: 1 } } },
        { $project: { _id: 0, name: '$_id', value: 1 } },
        { $sort: { value: -1, name: 1 } },
      ]).exec(),
      this.sellerModel.aggregate([
        {
          $project: {
            normalizedSource: {
              $trim: { input: { $ifNull: ['$referralSource', ''] } },
            },
          },
        },
        {
          $project: {
            source: {
              $cond: [
                { $eq: ['$normalizedSource', ''] },
                'Unknown',
                '$normalizedSource',
              ],
            },
          },
        },
        { $group: { _id: '$source', value: { $sum: 1 } } },
        { $project: { _id: 0, name: '$_id', value: 1 } },
        { $sort: { value: -1, name: 1 } },
      ]).exec(),
      this.dealModel.aggregate([
        {
          $project: {
            industries: {
              $cond: [
                {
                  $and: [
                    { $isArray: '$industrySectors' },
                    { $gt: [{ $size: '$industrySectors' }, 0] },
                  ],
                },
                '$industrySectors',
                {
                  $cond: [
                    { $and: [{ $ne: [{ $ifNull: ['$industrySector', ''] }, ''] }] },
                    ['$industrySector'],
                    ['Unknown'],
                  ],
                },
              ],
            },
          },
        },
        { $unwind: '$industries' },
        {
          $project: {
            industry: { $trim: { input: '$industries' } },
          },
        },
        {
          $match: { industry: { $ne: '' } },
        },
        { $group: { _id: '$industry', value: { $sum: 1 } } },
        { $project: { _id: 0, name: '$_id', value: 1 } },
        { $sort: { value: -1, name: 1 } },
      ]).exec(),
    ]);

    const totalInvitationsAllDeals = invitationsAgg?.[0]?.total || 0;
    const buyerResponseSummary = {
      accepted: buyerResponseAgg?.[0]?.accepted || 0,
      pending: buyerResponseAgg?.[0]?.pending || 0,
      rejected: buyerResponseAgg?.[0]?.rejected || 0,
      totalInvitations: totalInvitationsAllDeals,
    };

    const rewardLevelBreakdown = {
      seed: rewardLevelAgg?.[0]?.seed || 0,
      bloom: rewardLevelAgg?.[0]?.bloom || 0,
      fruit: rewardLevelAgg?.[0]?.fruit || 0,
    };

    const valueBucketMap = new Map<string, number>(
      (dealValueDistributionAgg || []).map((row: any) => [String(row?._id), Number(row?.count || 0)]),
    );
    const dealValueDistribution = [
      { name: '<$1M', deals: valueBucketMap.get('0') || 0 },
      { name: '$1M-$5M', deals: valueBucketMap.get('1000000') || 0 },
      { name: '$5M-$10M', deals: valueBucketMap.get('5000000') || 0 },
      { name: '$10M-$50M', deals: valueBucketMap.get('10000000') || 0 },
      { name: '>$50M', deals: valueBucketMap.get('50000000') || 0 },
    ];

    const trendMap = new Map<string, number>(
      (dealsTrendAgg || []).map((row: any) => [
        `${row?._id?.year}-${String(row?._id?.month).padStart(2, '0')}`,
        Number(row?.deals || 0),
      ]),
    );
    const dealsTrendLast6Months = Array.from({ length: 6 }, (_, idx) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return {
        month: d.toLocaleDateString('en-US', { month: 'short' }),
        deals: trendMap.get(key) || 0,
      };
    });

    return {
      totalDeals,
      activeDeals,
      completedDeals,
      loiDeals,
      totalBuyers,
      totalSellers,
      dealsThisMonth,
      dealsLastMonth,
      marketplaceDeals,
      dealsPreviousWeek,
      buyersPreviousWeek,
      dealsCurrentWeek,
      buyersCurrentWeek,
      previousWeekStart: startOfPreviousWeek.toISOString(),
      previousWeekEnd: endOfPreviousWeek.toISOString(),
      currentWeekStart: startOfCurrentWeek.toISOString(),
      activeRevenueSize: activeRevenueAgg?.[0]?.total || 0,
      activeEbitdaSize: activeEbitdaAgg?.[0]?.total || 0,
      totalRevenueSize: revenueAgg?.[0]?.total || 0,
      totalEbitdaSize: ebitdaAgg?.[0]?.total || 0,
      totalInvitations: totalInvitationsAllDeals,
      buyerResponseSummary,
      rewardLevelBreakdown,
      dealValueDistribution,
      dealsTrendLast6Months,
      buyerReferralSources: buyerReferralSourcesAgg,
      sellerReferralSources: sellerReferralSourcesAgg,
      industryBreakdown: industryBreakdownAgg,
    };
  }

  /**
   * Move a deal to LOI (Letter of Intent) status - pauses the deal for LOI negotiations
   */
  async moveDealToLOI(
    dealId: string,
    userId: string,
    userRole?: string,
    loiBuyerId?: string,
  ): Promise<Deal> {
    // Permission check needs the current document — load it once up front.
    const existingDeal = await this.dealModel.findById(dealId).select('seller status').lean().exec();
    if (!existingDeal) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }
    if (userRole !== 'admin' && existingDeal.seller.toString() !== userId) {
      throw new ForbiddenException("You don't have permission to modify this deal");
    }

    // Atomic claim: only the first concurrent caller flips status -> LOI.
    // Duplicate calls (double-clicks, retries) return the existing deal without
    // re-sending the LOI pause emails to advisors and buyers.
    const claimResult = await this.dealModel.updateOne(
      { _id: dealId, status: { $in: [DealStatus.ACTIVE, DealStatus.DRAFT] } },
      { $set: { status: DealStatus.LOI } },
    ).exec();

    if (claimResult.matchedCount === 0) {
      const current = await this.dealModel.findById(dealId).exec();
      if (!current) {
        throw new NotFoundException(`Deal with ID "${dealId}" not found`);
      }
      if (current.status === DealStatus.LOI) {
        this.logger.warn(
          `moveDealToLOI called on already-LOI deal ${dealId} by user ${userId}; skipping duplicate.`,
        );
        return current;
      }
      throw new BadRequestException(`Deal must be active or draft to be paused for LOI. Current status: ${current.status}`);
    }

    const dealDoc = await this.dealModel.findById(dealId).exec();
    if (!dealDoc) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }

    dealDoc.status = DealStatus.LOI;

    if (loiBuyerId) {
      const everActiveBuyerIds = (dealDoc.everActiveBuyers || []).map((id) => id.toString());
      if (!everActiveBuyerIds.includes(loiBuyerId)) {
        throw new BadRequestException("Selected LOI buyer is not associated with this deal.");
      }
      const loiBuyer = await this.buyerModel.findById(loiBuyerId).lean();
      if (!loiBuyer) {
        throw new BadRequestException("Selected LOI buyer was not found");
      }
      dealDoc.loiWithBuyer = loiBuyerId;
      dealDoc.loiWithBuyerCompany = (loiBuyer as any).companyName || "";
      dealDoc.loiWithBuyerEmail = (loiBuyer as any).email || "";
    } else {
      dealDoc.loiWithBuyer = undefined as any;
      dealDoc.loiWithBuyerCompany = undefined as any;
      dealDoc.loiWithBuyerEmail = undefined as any;
    }

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
    await this.syncBuyerDealCountsForDeal(dealDoc as DealDocument);

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

      // Single batched fetch for both active and pending buyers — avoids the
      // previous N+1 (one findById per buyer id, ~200 queries on a 100-buyer
      // deal). Build a Map keyed by buyer _id, then group results.
      const allBuyerIds = Array.from(new Set([...activeBuyerIds, ...pendingBuyerIds]));
      const buyerDocs = allBuyerIds.length > 0
        ? await this.buyerModel
            .find({ _id: { $in: allBuyerIds } })
            .select('fullName companyName email')
            .lean()
            .exec()
        : [];
      const buyerById = new Map<string, { fullName: string; companyName: string; email: string }>();
      for (const b of buyerDocs) {
        buyerById.set(String(b._id), {
          fullName: (b as any).fullName,
          companyName: (b as any).companyName,
          email: (b as any).email,
        });
      }

      const activeBuyers = activeBuyerIds
        .map((id) => buyerById.get(String(id)))
        .filter((b): b is { fullName: string; companyName: string; email: string } => !!b);
      const pendingBuyers = pendingBuyerIds
        .map((id) => buyerById.get(String(id)))
        .filter((b): b is { fullName: string; companyName: string; email: string } => !!b);
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
      // Build LOI buyer info for project owner email
      const loiBuyerHtml = dealDoc.loiWithBuyer
        ? `<p><strong>LOI Buyer (CIM Amplify):</strong> ${dealDoc.loiWithBuyerCompany || 'N/A'} (${dealDoc.loiWithBuyerEmail || 'N/A'})</p>`
        : `<p><strong>LOI Buyer:</strong> Not from CIM Amplify</p>`;

      // Email to Project Owner. Isolated so a failure here cannot cancel the
      // advisor/buyer notifications that follow.
      const ownerSubject = `Deal Paused for LOI: ${dealDoc.title}`;
      const ownerHtmlBody = genericEmailTemplate(ownerSubject, 'John', `
        <p>A deal has been paused for Letter of Intent (LOI) negotiations.</p>
        <p><strong>Deal:</strong> ${dealDoc.title}</p>
        <p><strong>Seller:</strong> ${seller?.fullName || 'Unknown'} (${seller?.companyName || 'N/A'})</p>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        ${loiBuyerHtml}
        ${activeBuyersHtml}
        ${pendingBuyersHtml}
      `);
      try {
        await this.mailService.sendEmailWithLogging(
          getAdminNotificationEmail(),
          'admin',
          ownerSubject,
          ownerHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
          dealIdStr,
        );
      } catch (ownerErr) {
        this.logger.error(`LOI owner email failed for deal ${dealIdStr}: ${this.formatError(ownerErr)}`);
      }

      // Email to Advisor (Seller). sendSellerDealEmail uses Promise.allSettled
      // internally, but wrap defensively in case it throws on lookup errors.
      if (seller) {
        const advisorSubject = `Your Deal Has Been Paused for LOI`;
        const advisorContent = `
          <p>Your deal <strong>${dealDoc.title}</strong> has been paused for Letter of Intent (LOI) negotiations.</p>
          <p>While your deal is paused, it will not be visible to new buyers on the marketplace. Existing active buyers have been notified about this status change.</p>
          <p>When you are ready to make the deal active again, you can revive it from your LOI Deals dashboard. If the deal does sell please click Off Market and let us know the details of the sale.</p>
          ${emailButton('View LOI Deals', `${getFrontendUrl()}/seller/loi-deals`)}
        `;
        try {
          await this.sendSellerDealEmail(
            seller,
            advisorSubject,
            advisorContent,
            [ILLUSTRATION_ATTACHMENT],
            dealIdStr,
          );
        } catch (advisorErr) {
          this.logger.error(`LOI advisor email failed for deal ${dealIdStr}: ${this.formatError(advisorErr)}`);
        }
      }

      // Per-recipient settle so a single failed send does not silently skip
      // every remaining buyer in the loop.
      const activeBuyerResults = await Promise.allSettled(
        activeBuyers.map((buyer) => {
          const buyerSubject = `Deal Update: ${dealDoc.title} - Paused for LOI`;
          const buyerHtmlBody = genericEmailTemplate(buyerSubject, getFirstName(buyer.fullName), `
            <p>The deal <strong>${dealDoc.title}</strong> has been paused by the advisor for Letter of Intent (LOI) negotiations.</p>
            <p>This means the advisor is currently in advanced discussions with a potential buyer. The deal will remain in your Active deals, and you will be notified if it becomes available again.</p>
            <p>In the meantime, feel free to explore other opportunities on CIM Amplify.</p>
            ${emailButton('Browse Marketplace', `${getFrontendUrl()}/buyer/marketplace`)}
          `);
          return this.mailService.sendEmailWithLogging(
            buyer.email,
            'buyer',
            buyerSubject,
            buyerHtmlBody,
            [ILLUSTRATION_ATTACHMENT],
            dealIdStr,
          );
        }),
      );
      activeBuyerResults.forEach((result, idx) => {
        if (result.status === 'rejected') {
          this.logger.error(
            `LOI active-buyer email failed for ${activeBuyers[idx]?.email || 'unknown'} (deal=${dealIdStr}): ${this.formatError(result.reason)}`,
          );
        }
      });

      const pendingBuyerResults = await Promise.allSettled(
        pendingBuyers.map((buyer) => {
          const buyerSubject = `Deal Update: ${dealDoc.title} - Paused for LOI`;
          const buyerHtmlBody = genericEmailTemplate(buyerSubject, getFirstName(buyer.fullName), `
            <p>One of your Pending Deals has gone under LOI before you had a chance to respond. This deal will remain in your Pending Deals until it either becomes active again or is taken off market.</p>
            <p>Please remember that you need to <strong>respond to Pending Deals as soon as possible</strong> so the Advisor who invited you to the deal knows your intentions.</p>
            ${emailButton('See Pending Deals', `${getFrontendUrl()}/buyer/deals`)}
          `);
          return this.mailService.sendEmailWithLogging(
            buyer.email,
            'buyer',
            buyerSubject,
            buyerHtmlBody,
            [ILLUSTRATION_ATTACHMENT],
            dealIdStr,
          );
        }),
      );
      pendingBuyerResults.forEach((result, idx) => {
        if (result.status === 'rejected') {
          this.logger.error(
            `LOI pending-buyer email failed for ${pendingBuyers[idx]?.email || 'unknown'} (deal=${dealIdStr}): ${this.formatError(result.reason)}`,
          );
        }
      });
    } catch (emailError) {
      this.logger.error(`Failed sending LOI pause emails for deal ${dealId}`, this.formatError(emailError));
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
    // Permission check needs the current document — load it once up front.
    const existingDeal = await this.dealModel.findById(dealId).select('seller status').lean().exec();
    if (!existingDeal) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }
    if (userRole !== 'admin' && existingDeal.seller.toString() !== userId) {
      throw new ForbiddenException("You don't have permission to modify this deal");
    }

    // Atomic claim: only the first concurrent caller flips status LOI -> ACTIVE.
    // Duplicate calls return the existing deal without re-sending revive emails.
    const claimResult = await this.dealModel.updateOne(
      { _id: dealId, status: DealStatus.LOI },
      { $set: { status: DealStatus.ACTIVE } },
    ).exec();

    if (claimResult.matchedCount === 0) {
      const current = await this.dealModel.findById(dealId).exec();
      if (!current) {
        throw new NotFoundException(`Deal with ID "${dealId}" not found`);
      }
      if (current.status === DealStatus.ACTIVE) {
        this.logger.warn(
          `reviveDealFromLOI called on already-active deal ${dealId} by user ${userId}; skipping duplicate.`,
        );
        return current;
      }
      throw new BadRequestException(`Deal must be in LOI status to be revived. Current status: ${current.status}`);
    }

    const dealDoc = await this.dealModel.findById(dealId).exec();
    if (!dealDoc) {
      throw new NotFoundException(`Deal with ID "${dealId}" not found`);
    }

    dealDoc.status = DealStatus.ACTIVE;

    // Ensure timeline object exists
    if (!dealDoc.timeline || typeof dealDoc.timeline !== 'object') {
      dealDoc.timeline = {} as any;
    }
    dealDoc.timeline.updatedAt = new Date();
    dealDoc.markModified('timeline');

    const savedDeal = await dealDoc.save();
    await this.syncBuyerDealCountsForDeal(dealDoc as DealDocument);

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

      // Email to Project Owner. Isolated so a failure here cannot cancel the
      // advisor/buyer notifications that follow.
      const ownerSubject = `Deal Revived from LOI: ${dealDoc.title}`;
      const ownerHtmlBody = genericEmailTemplate(ownerSubject, 'John', `
        <p>A deal has been revived from Letter of Intent (LOI) status and is now active again.</p>
        <p><strong>Deal:</strong> ${dealDoc.title}</p>
        <p><strong>Seller:</strong> ${seller?.fullName || 'Unknown'} (${seller?.companyName || 'N/A'})</p>
        <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        ${activeBuyersHtml}
        ${pendingBuyersHtml}
      `);
      try {
        await this.mailService.sendEmailWithLogging(
          getAdminNotificationEmail(),
          'admin',
          ownerSubject,
          ownerHtmlBody,
          [ILLUSTRATION_ATTACHMENT],
          dealIdStr,
        );
      } catch (ownerErr) {
        this.logger.error(`LOI-revive owner email failed for deal ${dealIdStr}: ${this.formatError(ownerErr)}`);
      }

      // Email to Advisor (Seller).
      if (seller) {
        const advisorSubject = `Your Deal Is Now Active Again`;
        const advisorContent = `
          <p>Your deal <strong>${dealDoc.title}</strong> has been revived and is now active again on CIM Amplify.</p>
          <p>Your deal is now visible on the marketplace, and existing active and pending buyers have been notified that the deal is available again.</p>
          <p>You can manage your deal and view interested buyers from your dashboard.</p>
          ${emailButton('View Dashboard', `${getFrontendUrl()}/seller/dashboard`)}
        `;
        try {
          await this.sendSellerDealEmail(
            seller,
            advisorSubject,
            advisorContent,
            [ILLUSTRATION_ATTACHMENT],
            dealIdStr,
          );
        } catch (advisorErr) {
          this.logger.error(`LOI-revive advisor email failed for deal ${dealIdStr}: ${this.formatError(advisorErr)}`);
        }
      }

      // Per-recipient settle so a single failed send does not silently skip
      // every remaining buyer in the loop.
      const activeBuyerResults = await Promise.allSettled(
        activeBuyers.map((buyer) => {
          const buyerSubject = `Great News: ${dealDoc.title} Is Active Again!`;
          const buyerHtmlBody = genericEmailTemplate(buyerSubject, getFirstName(buyer.fullName), `
            <p>The deal <strong>${dealDoc.title}</strong> is now active again on CIM Amplify!</p>
            <p>The advisor has completed their LOI negotiations and the deal is available for new discussions. This is a great opportunity to engage with the advisor if you're still interested.</p>
            <p>View the deal details and reach out to the advisor directly from your Active deals.</p>
            ${emailButton('View Active Deals', `${getFrontendUrl()}/buyer/deals`)}
          `);
          return this.mailService.sendEmailWithLogging(
            buyer.email,
            'buyer',
            buyerSubject,
            buyerHtmlBody,
            [ILLUSTRATION_ATTACHMENT],
            dealIdStr,
          );
        }),
      );
      activeBuyerResults.forEach((result, idx) => {
        if (result.status === 'rejected') {
          this.logger.error(
            `LOI-revive active-buyer email failed for ${activeBuyers[idx]?.email || 'unknown'} (deal=${dealIdStr}): ${this.formatError(result.reason)}`,
          );
        }
      });

      const pendingBuyerResults = await Promise.allSettled(
        pendingBuyers.map((buyer) => {
          const buyerSubject = `Great News: ${dealDoc.title} Is Active Again!`;
          const buyerHtmlBody = genericEmailTemplate(buyerSubject, getFirstName(buyer.fullName), `
            <p>The deal <strong>${dealDoc.title}</strong> is now active again on CIM Amplify!</p>
            <p>The advisor has completed their LOI negotiations and the deal is available for new discussions. This is a great opportunity to continue your interest in this deal.</p>
            <p>View your pending deals and respond to the invitation from the advisor.</p>
            ${emailButton('View My Deals', `${getFrontendUrl()}/buyer/deals`)}
          `);
          return this.mailService.sendEmailWithLogging(
            buyer.email,
            'buyer',
            buyerSubject,
            buyerHtmlBody,
            [ILLUSTRATION_ATTACHMENT],
            dealIdStr,
          );
        }),
      );
      pendingBuyerResults.forEach((result, idx) => {
        if (result.status === 'rejected') {
          this.logger.error(
            `LOI-revive pending-buyer email failed for ${pendingBuyers[idx]?.email || 'unknown'} (deal=${dealIdStr}): ${this.formatError(result.reason)}`,
          );
        }
      });
    } catch (emailError) {
      this.logger.error(`Failed sending LOI revive emails for deal ${dealId}`, this.formatError(emailError));
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

  /**
   * Validate a deal-action email token without consuming it.
   * Used by public endpoints that need to read deal data scoped to a token
   * (for example, fetching the buyer list before submitting an action).
   */
  private async validateEmailActionToken(token: string, ip?: string): Promise<DealActionTokenDocument> {
    const actionToken = await this.dealActionTokenModel.findOne({ token }).exec();

    if (!actionToken) {
      this.logger.warn(`Invalid email action token attempt from IP: ${ip || 'unknown'}`);
      throw new NotFoundException('This link is invalid or has expired.');
    }

    const hmacSecret = this.getHmacSecret();
    const recipientId = actionToken.recipientRole === 'seller'
      ? (actionToken.sellerId || '')
      : (actionToken.buyerId || '');
    const signaturePayload = actionToken.recipientRole === 'seller' && actionToken.buyerId
      ? `${token}:${actionToken.dealId}:${recipientId}:${actionToken.buyerId}`
      : `${token}:${actionToken.dealId}:${recipientId}`;
    const expectedSignature = crypto.createHmac('sha256', hmacSecret)
      .update(signaturePayload)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(actionToken.signature), Buffer.from(expectedSignature))) {
      this.logger.warn(`HMAC signature mismatch for token from IP: ${ip || 'unknown'}`);
      throw new BadRequestException('This link is invalid.');
    }

    if (actionToken.expiresAt < new Date()) {
      throw new BadRequestException('This link has expired. Please log in to your dashboard to take action.');
    }

    return actionToken;
  }

  /**
   * Public lookup of ever-active buyers for the deal referenced by an email
   * action token. Used by the seller-action page to populate the buyer
   * selection list for LOI / Off Market without requiring login.
   */
  async getEverActiveBuyersByActionToken(token: string, ip?: string): Promise<any[]> {
    const actionToken = await this.validateEmailActionToken(token, ip);

    if (actionToken.recipientRole !== 'seller') {
      throw new BadRequestException('This link does not allow buyer selection.');
    }

    if (actionToken.used) {
      return [];
    }

    return this.getEverActiveBuyers(actionToken.dealId);
  }

  /**
   * Build the human-readable "already done" message for a used action token.
   * Centralised so the GET /status endpoint and the POST handler agree, and
   * so we can correctly disambiguate flag-inactive tokens from off-market
   * ones — both used to be stored with actionTaken='completed', so we fall
   * back to inspecting the token shape (buyerId presence on a seller token
   * means it's a buyer-flag token).
   */
  private describePreviousAction(actionToken: DealActionTokenDocument): string {
    const isLegacyFlagInactive =
      actionToken.actionTaken === 'completed' &&
      actionToken.recipientRole === 'seller' &&
      !!actionToken.buyerId;

    if (actionToken.actionTaken === 'flag-inactive' || isLegacyFlagInactive) {
      return 'flagged this buyer as inactive on';
    }
    if (actionToken.actionTaken === 'active') return 'moved to Active';
    if (actionToken.actionTaken === 'loi') return 'paused for LOI';
    if (actionToken.actionTaken === 'completed') return 'taken off market';
    if (actionToken.actionTaken === 'rejected') return 'passed on';
    // Unknown / null — generic fallback.
    return 'taken action on';
  }

  private buildAlreadyDoneMessage(actionToken: DealActionTokenDocument): string {
    const verb = this.describePreviousAction(actionToken);
    if (verb === 'flagged this buyer as inactive on') {
      return 'You have already flagged this buyer as inactive on this deal.';
    }
    if (verb === 'taken action on') {
      return 'You have already taken action on this deal.';
    }
    return `You have already ${verb} this deal.`;
  }

  /**
   * Public token status lookup so the seller-action page can detect, on load,
   * that a previously-used token should immediately show "already done"
   * instead of re-prompting the user with the action dialog.
   */
  async getEmailActionTokenStatus(
    token: string,
    ip?: string,
  ): Promise<{ used: boolean; actionTaken?: string; recipientRole?: string; message?: string }> {
    const actionToken = await this.validateEmailActionToken(token, ip);

    if (!actionToken.used) {
      return { used: false, recipientRole: actionToken.recipientRole };
    }

    return {
      used: true,
      actionTaken: actionToken.actionTaken || undefined,
      recipientRole: actionToken.recipientRole,
      message: this.buildAlreadyDoneMessage(actionToken),
    };
  }

  /**
   * Handle a deal action from an email link using a token (no login required).
   * Validates the token, performs the action, and marks the token as used.
   */
  async handleEmailAction(
    token: string,
    action: 'activate' | 'pass' | 'loi' | 'off-market' | 'flag-inactive',
    ip?: string,
    userAgent?: string,
    payload: {
      buyerFromCIM?: boolean;
      winningBuyerId?: string;
      loiBuyerId?: string;
      finalSalePrice?: number;
    } = {},
  ): Promise<{ success: boolean; message: string; dealTitle?: string }> {
    const actionToken = await this.validateEmailActionToken(token, ip);

    if (actionToken.used) {
      return {
        success: true,
        message: this.buildAlreadyDoneMessage(actionToken),
      };
    }

    // Defensive payload validation. Email-action endpoints are public (no auth)
    // so we cannot trust client-supplied fields beyond the HMAC-signed token.
    const buyerFromCIMRaw = payload.buyerFromCIM;
    if (buyerFromCIMRaw !== undefined && typeof buyerFromCIMRaw !== 'boolean') {
      throw new BadRequestException('Invalid buyerFromCIM value.');
    }
    const buyerFromCIM = buyerFromCIMRaw === true;

    let validatedFinalSalePrice: number | undefined;
    if (payload.finalSalePrice !== undefined && payload.finalSalePrice !== null) {
      const price = Number(payload.finalSalePrice);
      // Cap at 1 trillion USD to prevent overflow / nonsense values.
      if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000_000) {
        throw new BadRequestException('Invalid final sale price.');
      }
      validatedFinalSalePrice = price;
    }

    const candidateBuyerId = buyerFromCIM
      ? (action === 'loi' ? payload.loiBuyerId : action === 'off-market' ? payload.winningBuyerId : undefined)
      : undefined;
    let validatedBuyerId: string | undefined;
    if (candidateBuyerId !== undefined) {
      if (typeof candidateBuyerId !== 'string' || !Types.ObjectId.isValid(candidateBuyerId)) {
        throw new BadRequestException('Invalid buyer id.');
      }
      // Ensure the buyer was actually associated with this deal — prevents a
      // valid-token holder from attributing the close to an arbitrary buyer.
      const dealForBuyerCheck = await this.dealModel.findById(actionToken.dealId).select('everActiveBuyers').lean().exec();
      const everActive = ((dealForBuyerCheck as any)?.everActiveBuyers || []).map((id: any) => String(id));
      if (!everActive.includes(candidateBuyerId)) {
        throw new BadRequestException('Selected buyer is not associated with this deal.');
      }
      validatedBuyerId = candidateBuyerId;
    }

    try {
      let result: any;
      let statusMessage = 'Action taken via email link';

      if (actionToken.recipientRole === 'seller') {
        if (!actionToken.sellerId) {
          throw new BadRequestException('Invalid seller action token.');
        }

        if (action === 'loi') {
          result = await this.moveDealToLOI(actionToken.dealId, actionToken.sellerId, 'seller', validatedBuyerId);
          statusMessage = 'Deal paused for LOI via email link';
        } else if (action === 'off-market') {
          result = await this.closeDealseller(
            actionToken.dealId,
            actionToken.sellerId,
            validatedFinalSalePrice,
            'Action taken via email link',
            validatedBuyerId,
            'seller',
            buyerFromCIMRaw === undefined ? undefined : buyerFromCIM,
          );
          statusMessage = 'Deal taken off market via email link';
        } else if (action === 'flag-inactive') {
          if (!actionToken.buyerId) {
            throw new BadRequestException('Invalid buyer action token.');
          }
          result = await this.flagInterestedBuyerInactive(actionToken.dealId, actionToken.buyerId, 'seller');
          statusMessage = 'Buyer flagged inactive via email link';
        } else {
          throw new BadRequestException("Invalid action for seller email link.");
        }
      } else {
        if (!actionToken.buyerId) {
          throw new BadRequestException('Invalid buyer action token.');
        }

        const status: 'active' | 'rejected' = action === 'activate' ? 'active' : 'rejected';
        result = await this.updateDealStatusByBuyer(
          actionToken.dealId,
          actionToken.buyerId,
          status,
          statusMessage,
        );
      }

      // Mark token as used and log request metadata
      actionToken.used = true;
      actionToken.actionTaken =
        actionToken.recipientRole === 'seller'
          ? (action === 'loi'
              ? 'loi'
              : action === 'flag-inactive'
                ? 'flag-inactive'
                : 'completed')
          : (action === 'activate' ? 'active' : 'rejected');
      actionToken.usedAt = new Date();
      actionToken.usedFromIp = ip || null;
      actionToken.usedUserAgent = userAgent || null;
      await actionToken.save();

      const dealTitle = result?.deal?.title || 'the deal';
      const logRecipientId = actionToken.recipientRole === 'seller'
        ? (actionToken.sellerId || '')
        : (actionToken.buyerId || '');
      this.logger.log(`Email action completed: ${actionToken.recipientRole}=${logRecipientId}, deal=${actionToken.dealId}, action=${action}, IP=${ip || 'unknown'}`);

      return {
        success: true,
        message: actionToken.recipientRole === 'seller'
          ? (action === 'loi'
            ? 'Deal has been paused for LOI.'
            : action === 'flag-inactive'
              ? 'Buyer has been flagged inactive.'
              : 'Deal has been taken off market.')
          : '',
        dealTitle,
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error(`Failed to handle email action: ${this.formatError(error)}`);
      throw new InternalServerErrorException('Something went wrong while processing your action. Please try again or log in to your dashboard.');
    }
  }
}
