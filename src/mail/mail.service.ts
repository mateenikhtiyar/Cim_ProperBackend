// src/mail/mail.service.ts
// src/mail/mail.service.ts
import { Injectable, Logger, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CommunicationLog, CommunicationLogDocument } from './schemas/communication-log.schema';
import { EmailQueue, EmailQueueDocument } from './schemas/email-queue.schema';
import { join } from 'path';
import * as nodemailer from 'nodemailer';
import { genericEmailTemplate, emailButton } from './generic-email.template';
import { getAdminNotificationEmail } from '../common/admin-notification-email';
import { Deal, DealDocumentType } from '../deals/schemas/deal.schema';
import { Buyer, BuyerDocument } from '../buyers/schemas/buyer.schema';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { Admin, AdminDocument } from '../admin/schemas/admin.schema';
import { TeamMember, TeamMemberDocument } from '../team/schemas/team-member.schema';
import { DealsService } from '../deals/deals.service';
import { advisorMonthlyReportTemplate, type AdvisorReportData, type ReportDeal, type ReportBuyer, type BuyerMovement } from './advisor-monthly-report.template';
import { buyerMonthlyReportTemplate, type BuyerReportData, type BuyerReportDeal } from './buyer-monthly-report.template';
import { getFrontendUrl } from '../common/frontend-url';

export const ILLUSTRATION_ATTACHMENT = {
  filename: 'illustration.png',
  path: join(process.cwd(), 'assets', 'illustration.png'),
  cid: 'illustration',
};


@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly escapeRegexInput = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  constructor(
    @InjectModel(CommunicationLog.name)
    private communicationLogModel: Model<CommunicationLogDocument>,
    @InjectModel(EmailQueue.name)
    private emailQueueModel: Model<EmailQueueDocument>,
    @InjectModel(Deal.name)
    private dealModel: Model<DealDocumentType>,
    @InjectModel(Buyer.name)
    private buyerModel: Model<BuyerDocument>,
    @InjectModel(Seller.name)
    private sellerModel: Model<SellerDocument>,
    @InjectModel(Admin.name)
    private adminModel: Model<AdminDocument>,
    @InjectModel(TeamMember.name)
    private teamMemberModel: Model<TeamMemberDocument>,
    @Inject(forwardRef(() => DealsService))
    private dealsService: DealsService,
  ) {}

  private transporter = nodemailer.createTransport({
    service: 'gmail',
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    rateDelta: 2000,
    rateLimit: 5,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  async sendEmail(to: string, subject: string, htmlBody: string, attachments: any[] = []) {
    try {
      return await this.transporter.sendMail({
        from: `"Deal Flow" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html: htmlBody,
        attachments,
      });
    } catch (error) {
      this.logger.error(`Error sending email: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  }

  async sendEmailWithLogging(
    recipientEmail: string,
    recipientType: string,
    subject: string,
    body: string,
    attachments: any[] = [],
    relatedDealId?: string,
  ): Promise<void> {
    await this.processQueue(10);

    try {
      await this.sendEmail(recipientEmail, subject, body, attachments);

      await this.communicationLogModel.create({
        recipientEmail,
        recipientType,
        subject,
        body,
        sentAt: new Date(),
        communicationType: 'email',
        status: 'sent',
        relatedDealId,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.communicationLogModel.create({
        recipientEmail,
        recipientType,
        subject,
        body,
        sentAt: new Date(),
        communicationType: 'email',
        status: 'failed',
        relatedDealId,
      });

      await this.enqueueRetry({
        recipientEmail,
        recipientType,
        subject,
        body,
        attachments,
        relatedDealId,
        lastError: errorMessage,
      });
      await this.notifyAdminQueueFailure(recipientEmail, subject, errorMessage);
      throw err;
    }
  }

  private async enqueueRetry(params: {
    recipientEmail: string;
    recipientType: string;
    subject: string;
    body: string;
    attachments?: any[];
    relatedDealId?: string;
    lastError: string;
  }): Promise<void> {
    await this.emailQueueModel.create({
      recipientEmail: params.recipientEmail,
      recipientType: params.recipientType,
      subject: params.subject,
      body: params.body,
      attachments: params.attachments || [],
      relatedDealId: params.relatedDealId,
      attempts: 1,
      maxAttempts: 5,
      nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
      lastError: params.lastError,
      status: "pending",
    });
  }

  private async notifyAdminQueueFailure(recipientEmail: string, subject: string, reason: string): Promise<void> {
    try {
      const alertSubject = "CIM Amplify Email Delivery Failure Alert";
      const alertBody = genericEmailTemplate(
        alertSubject,
        "Admin",
        `<p>Email delivery failed and was queued for retry.</p>
         <p><strong>Recipient:</strong> ${recipientEmail}</p>
         <p><strong>Subject:</strong> ${subject}</p>
         <p><strong>Error:</strong> ${reason}</p>`,
      );
      await this.sendEmail(getAdminNotificationEmail(), alertSubject, alertBody, [ILLUSTRATION_ATTACHMENT]);
    } catch {
      // Intentionally ignore to avoid recursive failures.
    }
  }

  async processQueue(limit = 20): Promise<void> {
    const now = new Date();
    const queuedItems = await this.emailQueueModel
      .find({ status: "pending", nextRetryAt: { $lte: now } })
      .sort({ nextRetryAt: 1 })
      .limit(limit)
      .exec();

    for (const queued of queuedItems) {
      try {
        await this.sendEmail(queued.recipientEmail, queued.subject, queued.body, queued.attachments || []);

        queued.status = "sent";
        queued.lastError = null;
        await queued.save();

        await this.communicationLogModel.create({
          recipientEmail: queued.recipientEmail,
          recipientType: queued.recipientType,
          subject: queued.subject,
          body: queued.body,
          sentAt: new Date(),
          communicationType: "email",
          status: "sent",
          relatedDealId: queued.relatedDealId,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        queued.attempts += 1;
        queued.lastError = errorMessage;

        if (queued.attempts >= queued.maxAttempts) {
          queued.status = "dead";
          await this.notifyAdminQueueFailure(queued.recipientEmail, queued.subject, `Permanent failure: ${errorMessage}`);
        } else {
          const nextDelayMinutes = Math.min(60, Math.pow(2, queued.attempts) * 5);
          queued.nextRetryAt = new Date(Date.now() + nextDelayMinutes * 60 * 1000);
        }
        await queued.save();
      }
    }
  }
  async sendResetPasswordEmail(to: string, name: string, resetLink: string): Promise<void> {
    const subject = 'Reset your password';
    const emailContent = `
      <p>Click the button below to reset your password:</p>
      ${emailButton('Reset Password', resetLink)}
      <p>This link will expire in 15 minutes.</p>
    `;

    const emailBody = genericEmailTemplate(subject, name, emailContent);

    await this.sendEmailWithLogging(to, 'user', subject, emailBody, [ILLUSTRATION_ATTACHMENT]);
  }

  async sendEmailDeliveryIssueNotification(
    userEmail: string,
    userName: string,
    userRole: 'buyer' | 'seller',
    contactInfo: {
      companyName?: string;
      phone?: string;
      website?: string;
    },
  ): Promise<void> {
    const subject = `Email Delivery Issue Report - ${userRole.charAt(0).toUpperCase() + userRole.slice(1)} Registration`;
    const emailContent = `
      <p style="font-size: 16px; margin-bottom: 20px;">A new user has reported that they did not receive their welcome email after registration.</p>

      <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="color: #1a1a1a; font-size: 18px; font-weight: 700; margin: 0 0 16px 0; border-bottom: 2px solid #3aafa9; padding-bottom: 8px;">User Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; width: 120px; font-size: 14px;">Name:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;">${userName || 'Not provided'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Email:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;"><a href="mailto:${userEmail}" style="color: #3aafa9; text-decoration: none;">${userEmail}</a></td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Phone:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;">${contactInfo.phone ? `<a href="tel:${contactInfo.phone}" style="color: #3aafa9; text-decoration: none;">${contactInfo.phone}</a>` : 'Not provided'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Company:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;">${contactInfo.companyName || 'Not provided'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Website:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;">${contactInfo.website ? `<a href="${contactInfo.website}" target="_blank" style="color: #3aafa9; text-decoration: none;">${contactInfo.website}</a>` : 'Not provided'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Role:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;"><span style="background-color: ${userRole === 'buyer' ? '#dbeafe' : '#dcfce7'}; color: ${userRole === 'buyer' ? '#1d4ed8' : '#16a34a'}; padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 700;">${userRole.charAt(0).toUpperCase() + userRole.slice(1)}</span></td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Reported At:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;">${new Date().toLocaleString()}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin-top: 20px; border-radius: 0 8px 8px 0;">
        <p style="margin: 0; font-weight: 700; color: #92400e; font-size: 15px;">Action Required</p>
        <p style="margin: 8px 0 0 0; color: #78350f; font-size: 14px;">Please contact this user to assist with their email delivery issue and ensure they can access the platform.</p>
      </div>
    `;

    const emailBody = genericEmailTemplate(subject, 'Support Team', emailContent);

    await this.sendEmailWithLogging(
      getAdminNotificationEmail(),
      'admin',
      subject,
      emailBody,
      [ILLUSTRATION_ATTACHMENT],
    );
  }

  async getAdminEmailLogs(
    page = 1,
    limit = 20,
    search = "",
    status = "",
    recipientType = "",
    ): Promise<{
    data: Array<{
      _id: string;
      recipientEmail: string;
      recipientType: string;
      subject: string;
      status: string;
      sentAt: Date;
      relatedDealId?: string;
      dealName?: string;
      bodyPreview: string;
    }>;
    total: number;
    page: number;
    lastPage: number;
    summary: {
      totalLogged: number;
      sent: number;
      failed: number;
      pendingQueue: number;
      deadQueue: number;
    };
  }> {
    const safePage = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;
    const safeLimit = Number.isFinite(Number(limit)) ? Math.min(100, Math.max(1, Number(limit))) : 20;

    const query: Record<string, any> = { communicationType: "email" };

    if (status && ["sent", "failed"].includes(status)) {
      query.status = status;
    }

    if (recipientType && ["buyer", "seller", "admin", "other", "user"].includes(recipientType)) {
      query.recipientType = recipientType;
    }

    if (search?.trim()) {
      const searchRegex = new RegExp(this.escapeRegexInput(search.trim()), "i");
      query.$or = [
        { recipientEmail: searchRegex },
        { subject: searchRegex },
        { relatedDealId: searchRegex },
      ];
    }

    const total = await this.communicationLogModel.countDocuments(query).exec();
    const lastPage = Math.max(1, Math.ceil(total / safeLimit));
    const effectivePage = Math.min(safePage, lastPage);
    const skip = (effectivePage - 1) * safeLimit;

    const [logs, totalLogged, sent, failed, pendingQueue, deadQueue] = await Promise.all([
      this.communicationLogModel
        .find(query)
        .sort({ sentAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean()
        .exec(),
      this.communicationLogModel.countDocuments({ communicationType: "email" }).exec(),
      this.communicationLogModel.countDocuments({ communicationType: "email", status: "sent" }).exec(),
      this.communicationLogModel.countDocuments({ communicationType: "email", status: "failed" }).exec(),
      this.emailQueueModel.countDocuments({ status: "pending" }).exec(),
      this.emailQueueModel.countDocuments({ status: "dead" }).exec(),
    ]);

    const relatedDealIds = Array.from(
      new Set(
        logs
          .map((log: any) => log.relatedDealId)
          .filter((id: string | undefined) => !!id && Types.ObjectId.isValid(id))
          .map((id: string) => String(id)),
      ),
    );

    const relatedDeals = relatedDealIds.length > 0
      ? await this.dealModel
          .find(
            { _id: { $in: relatedDealIds.map((id) => new Types.ObjectId(id)) } },
            { _id: 1, title: 1 },
          )
          .lean()
          .exec()
      : [];

    const dealNameById = new Map<string, string>(
      relatedDeals.map((deal: any) => [String(deal._id), deal.title || "Untitled Deal"]),
    );

    const data = logs.map((log: any) => {
      const bodyText = String(log.body || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      return {
        _id: String(log._id),
        recipientEmail: log.recipientEmail,
        recipientType: log.recipientType,
        subject: log.subject,
        status: log.status,
        sentAt: log.sentAt || log.createdAt,
        relatedDealId: log.relatedDealId,
        dealName: log.relatedDealId ? dealNameById.get(String(log.relatedDealId)) : undefined,
        bodyPreview: bodyText.slice(0, 180),
      };
    });

    return {
      data,
      total,
      page: effectivePage,
      lastPage,
      summary: {
        totalLogged,
        sent,
        failed,
        pendingQueue,
        deadQueue,
      },
    };
  }

  async sendCustomEmail(params: {
    recipientType: 'single' | 'multiple' | 'all' | 'all-buyers' | 'all-sellers' | 'all-admins' | 'all-members';
    recipientEmail?: string;
    recipientRole?: string;
    multipleRecipients?: Array<{ email: string; role: string }>;
    subject: string;
    body: string;
  }): Promise<{ success: boolean; message: string; sentCount: number }> {
    const { recipientType, recipientEmail, recipientRole, multipleRecipients, subject, body } = params;

    if (recipientType === 'single' && !recipientEmail) {
      throw new BadRequestException('recipientEmail is required for single recipient type');
    }

    if (recipientType === 'multiple' && (!multipleRecipients || multipleRecipients.length === 0)) {
      throw new BadRequestException('multipleRecipients is required for multiple recipient type');
    }

    const emailBody = genericEmailTemplate(subject, 'User', body, true);
    let recipients: Array<{ email: string; name: string; type: string }> = [];

    if (recipientType === 'single') {
      const user = await this.findUserByEmailAndRole(recipientEmail!, recipientRole || 'buyer');
      if (user) {
        recipients = [{ email: user.email, name: user.name, type: user.type }];
      } else {
        recipients = [{ email: recipientEmail!, name: 'User', type: recipientRole || 'user' }];
      }
    } else if (recipientType === 'multiple') {
      for (const recipient of multipleRecipients!) {
        const user = await this.findUserByEmailAndRole(recipient.email, recipient.role);
        if (user) {
          recipients.push({ email: user.email, name: user.name, type: user.type });
        } else {
          recipients.push({ email: recipient.email, name: 'User', type: recipient.role });
        }
      }
    } else if (recipientType === 'all-buyers') {
      const buyers = await this.buyerModel.find({}, { email: 1, fullName: 1 }).lean().exec();
      recipients = buyers.map(b => ({ email: b.email, name: b.fullName, type: 'buyer' }));
    } else if (recipientType === 'all-sellers') {
      const sellers = await this.sellerModel.find({}, { email: 1, fullName: 1 }).lean().exec();
      recipients = sellers.map(s => ({ email: s.email, name: s.fullName, type: 'seller' }));
    } else if (recipientType === 'all-admins') {
      const admins = await this.adminModel.find({}, { email: 1, fullName: 1 }).lean().exec();
      recipients = admins.map(a => ({ email: a.email, name: a.fullName, type: 'admin' }));
    } else if (recipientType === 'all-members') {
      const members = await this.teamMemberModel.find({}, { email: 1, fullName: 1, role: 1 }).lean().exec();
      recipients = members.map(m => ({ email: m.email, name: m.fullName, type: m.role }));
    } else if (recipientType === 'all') {
      const [buyers, sellers, admins, members] = await Promise.all([
        this.buyerModel.find({}, { email: 1, fullName: 1 }).lean().exec(),
        this.sellerModel.find({}, { email: 1, fullName: 1 }).lean().exec(),
        this.adminModel.find({}, { email: 1, fullName: 1 }).lean().exec(),
        this.teamMemberModel.find({}, { email: 1, fullName: 1, role: 1 }).lean().exec(),
      ]);
      recipients = [
        ...buyers.map(b => ({ email: b.email, name: b.fullName, type: 'buyer' })),
        ...sellers.map(s => ({ email: s.email, name: s.fullName, type: 'seller' })),
        ...admins.map(a => ({ email: a.email, name: a.fullName, type: 'admin' })),
        ...members.map(m => ({ email: m.email, name: m.fullName, type: m.role })),
      ];
    }

    let sentCount = 0;
    for (const recipient of recipients) {
      try {
        await this.sendEmailWithLogging(
          recipient.email,
          recipient.type,
          subject,
          emailBody,
          [ILLUSTRATION_ATTACHMENT],
        );
        sentCount++;
      } catch (error) {
        this.logger.error(`Failed to send email to ${recipient.email}: ${error.message}`);
      }
    }

    return {
      success: true,
      message: `Email sent to ${sentCount} of ${recipients.length} recipients`,
      sentCount,
    };
  }

  private async findUserByEmailAndRole(email: string, role: string): Promise<{ email: string; name: string; type: string } | null> {
    const normalizedEmail = email.trim().toLowerCase();
    let user: any = null;

    if (role === 'buyer') {
      user = await this.buyerModel.findOne({ email: normalizedEmail }, { email: 1, fullName: 1 }).lean().exec();
      if (user) return { email: user.email, name: user.fullName, type: 'buyer' };
    } else if (role === 'seller') {
      user = await this.sellerModel.findOne({ email: normalizedEmail }, { email: 1, fullName: 1 }).lean().exec();
      if (user) return { email: user.email, name: user.fullName, type: 'seller' };
    } else if (role === 'admin') {
      user = await this.adminModel.findOne({ email: normalizedEmail }, { email: 1, fullName: 1 }).lean().exec();
      if (user) return { email: user.email, name: user.fullName, type: 'admin' };
    } else if (role === 'buyer-member' || role === 'seller-member') {
      user = await this.teamMemberModel.findOne({ email: normalizedEmail, role }, { email: 1, fullName: 1, role: 1 }).lean().exec();
      if (user) return { email: user.email, name: user.fullName, type: user.role };
    }

    return null;
  }

  async sendTemplateEmail(params: {
    templateType: 'advisor-monthly' | 'buyer-monthly' | 'semiannual-buyer-reminder' | 'introduction-followup';
    recipientType: 'all-buyers' | 'all-sellers' | 'single' | 'all';
    recipientEmail?: string;
  }): Promise<{ success: boolean; message: string; sentCount: number }> {
    const { templateType, recipientType } = params;
    const recipientEmail = params.recipientEmail?.trim().toLowerCase();

    if (recipientType === 'single' && !recipientEmail) {
      throw new BadRequestException('recipientEmail is required for single recipient');
    }

    const buyerTemplates = ['buyer-monthly', 'semiannual-buyer-reminder'];
    const advisorTemplates = ['advisor-monthly'];

    if (buyerTemplates.includes(templateType) && !['all-buyers', 'single'].includes(recipientType)) {
      throw new BadRequestException('Buyer templates can only be sent to buyers');
    }

    if (advisorTemplates.includes(templateType) && !['all-sellers', 'single'].includes(recipientType)) {
      throw new BadRequestException('Advisor templates can only be sent to advisors/sellers');
    }

    if (templateType === 'introduction-followup' && recipientType !== 'all') {
      throw new BadRequestException('Introduction follow-up emails are sent for all eligible introductions');
    }

    const frontendUrl = getFrontendUrl();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthYear = monthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    let sentCount = 0;

    if (templateType === 'buyer-monthly') {
      const buyers = recipientType === 'single'
        ? await this.buyerModel.find({ email: recipientEmail }).exec()
        : await this.buyerModel.find({}).exec();

      if (recipientType === 'single' && buyers.length === 0) {
        throw new BadRequestException('No buyer found with that email');
      }

      for (const buyer of buyers) {
        try {
          const buyerId = buyer._id.toString();
          const [activeDeals, pendingDeals] = await Promise.all([
            this.dealsService.getBuyerDeals(buyerId, 'active'),
            this.dealsService.getBuyerDeals(buyerId, 'pending'),
          ]);

          const reportData: BuyerReportData = await this.buildBuyerReportData(buyer, activeDeals, pendingDeals, monthYear, frontendUrl, now);
          const emailBody = buyerMonthlyReportTemplate(reportData);
          const subject = `Your CIM Amplify Monthly Deal Report — ${monthYear}`;

          await this.sendEmailWithLogging(buyer.email, 'buyer', subject, emailBody, [ILLUSTRATION_ATTACHMENT]);
          sentCount++;
        } catch (error) {
          this.logger.error(`Template email failed for buyer ${buyer.email}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else if (templateType === 'advisor-monthly') {
      const sellers = recipientType === 'single'
        ? await this.sellerModel.find({ email: recipientEmail }).exec()
        : await this.sellerModel.find({}).exec();

      if (recipientType === 'single' && sellers.length === 0) {
        throw new BadRequestException('No advisor/seller found with that email');
      }

      for (const seller of sellers) {
        try {
          const sellerId = seller._id.toString();
          const [activeDeals, loiDeals] = await Promise.all([
            this.dealsService.findBySeller(sellerId) as Promise<DealDocumentType[]>,
            this.dealsService.getSellerLOIDeals(sellerId) as Promise<DealDocumentType[]>,
          ]);

          const reportData: AdvisorReportData = await this.buildAdvisorReportData(seller, activeDeals, loiDeals, monthYear, frontendUrl, monthStart, now);
          const emailBody = advisorMonthlyReportTemplate(reportData);
          const subject = `Your CIM Amplify Monthly Deal Report — ${monthYear}`;

          await this.sendEmailWithLogging(seller.email, 'seller', subject, emailBody, [ILLUSTRATION_ATTACHMENT]);
          sentCount++;
        } catch (error) {
          this.logger.error(`Template email failed for seller ${seller.email}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else if (templateType === 'semiannual-buyer-reminder') {
      const buyers = recipientType === 'single'
        ? await this.buyerModel.find({ email: recipientEmail }).exec()
        : await this.buyerModel.find({}).exec();

      if (recipientType === 'single' && buyers.length === 0) {
        throw new BadRequestException('No buyer found with that email');
      }

      for (const buyer of buyers) {
        try {
          const subject = 'Please Make Sure Your CIM Amplify Target Criteria is Up to Date';
          const emailContent = `
            <p>Don't miss deals that fit your updated criteria! Head to your member dashboard and click on Company Profile to make sure your information is up to date.</p>
            ${emailButton('Update Your Profile', `${frontendUrl}/buyer/profile`)}
          `;

          const emailBody = genericEmailTemplate(subject, buyer.fullName || 'Buyer', emailContent);
          await this.sendEmailWithLogging(buyer.email, 'buyer', subject, emailBody, [ILLUSTRATION_ATTACHMENT]);
          sentCount++;
        } catch (error) {
          this.logger.error(`Template email failed for buyer ${buyer.email}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else if (templateType === 'introduction-followup') {
      sentCount = await this.sendIntroductionFollowUps();
    }

    return {
      success: true,
      message: `Template email sent to ${sentCount} recipient(s)`,
      sentCount,
    };
  }

  private async sendIntroductionFollowUps(): Promise<number> {
    const frontendUrl = getFrontendUrl();
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
    const fourDaysAgo = new Date(now.getTime() - (4 * 24 * 60 * 60 * 1000));

    const deals = await this.dealModel.find({
      status: { $nin: ['completed'] },
    }).exec();

    let followUpsSent = 0;

    for (const deal of deals) {
      const invitationStatusObj = deal.invitationStatus instanceof Map
        ? Object.fromEntries(deal.invitationStatus)
        : (deal.invitationStatus || {});

      for (const [buyerId, statusRaw] of Object.entries(invitationStatusObj)) {
        if (!statusRaw || typeof statusRaw !== 'object') continue;
        const status = statusRaw as any;
        if (status.response !== 'accepted') continue;
        if (!status.respondedAt) continue;
        if (status.introFollowUpSentAt) continue;

        const respondedAt = new Date(status.respondedAt);
        if (respondedAt > threeDaysAgo || respondedAt < fourDaysAgo) continue;

        try {
          const seller = await this.sellerModel.findById(deal.seller).exec();
          const buyer = await this.buyerModel.findById(buyerId).exec();
          if (!seller || !buyer) continue;

          const dealTitle = deal.title || 'Untitled Deal';

          const advisorSubject = `Follow Up: Have you heard from ${buyer.fullName} regarding ${dealTitle}?`;
          const advisorContent = `
            <p>Three days ago we introduced you to <strong>${buyer.fullName}</strong> from <strong>${buyer.companyName}</strong> regarding <strong>${dealTitle}</strong>.</p>
            <p style="font-size: 15px; font-weight: 600; margin: 20px 0 10px;">Have you heard from this buyer?</p>
            <table cellpadding="0" cellspacing="0" style="margin: 0 0 20px;">
              <tr>
                <td style="padding-right: 12px;">
                  ${emailButton('Yes, we connected', `${frontendUrl}/seller/dashboard`)}
                </td>
                <td>
                  <a href="mailto:deals@amp-ven.com?subject=${encodeURIComponent(`No response from buyer: ${buyer.fullName} - ${dealTitle}`)}&body=${encodeURIComponent(`Hi CIM Amplify Team,\n\nI have not heard from ${buyer.fullName} at ${buyer.companyName} regarding ${dealTitle}.\n\nPlease help follow up.\n\nThank you`)}" style="display: inline-block; padding: 10px 24px; background-color: #ef4444; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">No, I haven't heard back</a>
                </td>
              </tr>
            </table>
            <p style="font-size: 13px; color: #666;">If you haven't heard from the buyer, click "No" and our team will follow up with them on your behalf.</p>
            <p>Buyer contact details:</p>
            <p style="margin: 12px 0; padding: 12px; background-color: #f5f5f5; border-radius: 8px;">
              <strong>${buyer.fullName}</strong><br>
              ${buyer.companyName}<br>
              <a href="mailto:${buyer.email}" style="color: #3aafa9;">${buyer.email}</a><br>
              ${buyer.phone || ''}
            </p>
          `;

          const advisorEmailBody = genericEmailTemplate(advisorSubject, seller.fullName || 'Advisor', advisorContent);
          // Isolate the advisor send so a transient failure does not skip the
          // matching buyer email or the introFollowUpSentAt marker further down.
          try {
            await this.sendEmailWithLogging(
              seller.email,
              'seller',
              advisorSubject,
              advisorEmailBody,
              [ILLUSTRATION_ATTACHMENT],
              deal._id instanceof Types.ObjectId ? deal._id.toHexString() : String(deal._id),
            );
            followUpsSent++;
          } catch (advisorErr) {
            this.logger.error(
              `Intro follow-up advisor email failed for deal ${deal._id}, advisor ${seller.email}: ${advisorErr instanceof Error ? advisorErr.message : String(advisorErr)}`,
            );
          }

          const buyerSubject = `Follow Up: Have you heard from ${seller.fullName} regarding ${dealTitle}?`;
          const buyerContent = `
            <p>Three days ago you accepted an introduction to <strong>${dealTitle}</strong> and we connected you with the advisor, <strong>${seller.fullName}</strong> from <strong>${seller.companyName}</strong>.</p>
            <p style="font-size: 15px; font-weight: 600; margin: 20px 0 10px;">Have you heard from this advisor?</p>
            <table cellpadding="0" cellspacing="0" style="margin: 0 0 20px;">
              <tr>
                <td style="padding-right: 12px;">
                  ${emailButton('Yes, we connected', `${frontendUrl}/buyer/deals`)}
                </td>
                <td>
                  <a href="mailto:deals@amp-ven.com?subject=${encodeURIComponent(`No response from advisor: ${seller.fullName} - ${dealTitle}`)}&body=${encodeURIComponent(`Hi CIM Amplify Team,\n\nI have not heard from ${seller.fullName} at ${seller.companyName} regarding ${dealTitle}.\n\nPlease help follow up.\n\nThank you`)}" style="display: inline-block; padding: 10px 24px; background-color: #ef4444; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">No, I haven't heard back</a>
                </td>
              </tr>
            </table>
            <p style="font-size: 13px; color: #666;">If you haven't heard from the advisor, click "No" and our team will follow up with them on your behalf.</p>
            <p>Advisor contact details:</p>
            <p style="margin: 12px 0; padding: 12px; background-color: #f5f5f5; border-radius: 8px;">
              <strong>${seller.fullName}</strong><br>
              ${seller.companyName}<br>
              <a href="mailto:${seller.email}" style="color: #3aafa9;">${seller.email}</a>
            </p>
          `;

          const buyerEmailBody = genericEmailTemplate(buyerSubject, buyer.fullName || 'Buyer', buyerContent);
          try {
            await this.sendEmailWithLogging(
              buyer.email,
              'buyer',
              buyerSubject,
              buyerEmailBody,
              [ILLUSTRATION_ATTACHMENT],
              deal._id instanceof Types.ObjectId ? deal._id.toHexString() : String(deal._id),
            );
            followUpsSent++;
          } catch (buyerErr) {
            this.logger.error(
              `Intro follow-up buyer email failed for deal ${deal._id}, buyer ${buyer.email}: ${buyerErr instanceof Error ? buyerErr.message : String(buyerErr)}`,
            );
          }

          if (deal.invitationStatus instanceof Map) {
            const entry = deal.invitationStatus.get(buyerId);
            if (entry) {
              entry.introFollowUpSentAt = now;
              deal.invitationStatus.set(buyerId, entry);
            }
          }

          deal.markModified('invitationStatus');
          await deal.save();
        } catch (error) {
          this.logger.error(`Introduction follow-up failed for deal ${deal._id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return followUpsSent;
  }

  private async buildBuyerReportData(buyer: any, activeDeals: any[], pendingDeals: any[], monthYear: string, frontendUrl: string, now: Date): Promise<BuyerReportData> {
    const formatCurrency = (amount: number | undefined): string => {
      if (!amount && amount !== 0) return 'N/A';
      if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
      if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
      if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
      return `$${amount.toLocaleString()}`;
    };

    const formatDateShort = (d: Date | string | undefined): string => {
      if (!d) return 'N/A';
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const daysBetween = (d1: Date, d2: Date): number => {
      return Math.max(0, Math.floor((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
    };

    const buyerId = buyer._id.toString();
    const toDealRow = (deal: any, invitedAt?: Date): BuyerReportDeal => ({
      dealId: deal._id instanceof Types.ObjectId ? deal._id.toHexString() : String(deal._id),
      title: deal.title || 'Untitled Deal',
      location: deal.geographySelection || deal.geography || '-',
      industry: deal.industrySector || '-',
      revenue: formatCurrency(deal.financialDetails?.trailingRevenueAmount),
      ebitda: formatCurrency(deal.financialDetails?.trailingEBITDAAmount),
      dateSince: formatDateShort(invitedAt || deal.createdAt),
      daysWaiting: invitedAt ? daysBetween(invitedAt, now) : daysBetween(new Date(deal.createdAt), now),
      isLoi: deal.status === 'loi',
    });

    const activeDealRows: BuyerReportDeal[] = await Promise.all(activeDeals.map(async (deal: any) => {
      const invStatus = deal.invitationStatus instanceof Map
        ? deal.invitationStatus.get(buyerId)
        : deal.invitationStatus?.[buyerId];
      const row = toDealRow(deal, invStatus?.respondedAt ? new Date(invStatus.respondedAt) : undefined);
      const dealId = row.dealId;
      const urls = await this.dealsService.createDealActionUrls(dealId, buyerId);
      return { ...row, ...urls };
    }));

    const newPendingRows: BuyerReportDeal[] = [];
    const oldPendingRows: BuyerReportDeal[] = [];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    for (const deal of pendingDeals) {
      const d = deal as any;
      const invStatus = d.invitationStatus instanceof Map
        ? d.invitationStatus.get(buyerId)
        : d.invitationStatus?.[buyerId];
      const invitedAt = invStatus?.invitedAt ? new Date(invStatus.invitedAt) : new Date(d.createdAt);
      const row = toDealRow(d, invitedAt);
      const urls = await this.dealsService.createDealActionUrls(row.dealId, buyerId);
      const rowWithUrls = { ...row, ...urls };

      if (invitedAt >= thirtyDaysAgo) {
        newPendingRows.push(rowWithUrls);
      } else {
        oldPendingRows.push(rowWithUrls);
      }
    }

    oldPendingRows.sort((a, b) => (b.daysWaiting || 0) - (a.daysWaiting || 0));

    return {
      buyerName: buyer.fullName || 'Buyer',
      buyerCompany: buyer.companyName || '',
      monthYear,
      generatedDate: now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      pendingCount: pendingDeals.length,
      newThisMonthCount: newPendingRows.length,
      activeCount: activeDeals.length,
      activeDeals: activeDealRows,
      newPendingDeals: newPendingRows,
      oldPendingDeals: oldPendingRows,
      frontendUrl,
    };
  }

  private async buildAdvisorReportData(seller: any, activeDeals: DealDocumentType[], loiDeals: DealDocumentType[], monthYear: string, frontendUrl: string, monthStart: Date, monthEnd: Date): Promise<AdvisorReportData> {
    const formatDate = (d: Date | string | undefined): string => {
      if (!d) return 'N/A';
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const formatCurrency = (amount: number | undefined): string => {
      if (!amount && amount !== 0) return 'N/A';
      if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
      if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
      if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
      return `$${amount.toLocaleString()}`;
    };

    const allReportDeals = [
      ...activeDeals.map(d => ({ deal: d, status: 'active' as const })),
      ...loiDeals.map(d => ({ deal: d, status: 'loi' as const })),
    ];

    let totalBuyerInterest = 0;
    let totalMovements = 0;
    const reportDeals: ReportDeal[] = [];

    for (const { deal, status } of allReportDeals) {
      const dealId = deal._id instanceof Types.ObjectId ? deal._id.toHexString() : String(deal._id);
      const invStatusObj = deal.invitationStatus instanceof Map
        ? Object.fromEntries(deal.invitationStatus)
        : (deal.invitationStatus || {});

      const activeBuyerEntries: Array<{ buyerId: string; entry: any }> = [];
      let passedCount = 0;

      for (const [buyerId, entry] of Object.entries(invStatusObj)) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as any;
        if (e.response === 'accepted') {
          activeBuyerEntries.push({ buyerId, entry: e });
        } else if (e.response === 'rejected') {
          passedCount++;
        }
      }

      totalBuyerInterest += activeBuyerEntries.length;

      const activeBuyers: ReportBuyer[] = [];
      for (const { buyerId, entry } of activeBuyerEntries) {
        try {
          const buyer = await this.buyerModel.findById(buyerId).select('fullName companyName').lean().exec();
          const flagInactiveUrl = await this.dealsService.createSellerBuyerFlagUrl(dealId, seller._id.toString(), buyerId);
          activeBuyers.push({
            buyerId,
            fullName: (buyer as any)?.fullName || 'Unknown Buyer',
            companyName: (buyer as any)?.companyName || '',
            interestedSince: formatDate(entry.respondedAt),
            flagInactiveUrl,
            flaggedInactive: !!entry?.flaggedInactive,
          });
        } catch {
          activeBuyers.push({ buyerId, fullName: 'Unknown Buyer', companyName: '', interestedSince: formatDate(entry.respondedAt) });
        }
      }

      const movements: BuyerMovement[] = [];
      for (const [buyerId, entry] of Object.entries(invStatusObj)) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as any;
        if (!e.respondedAt) continue;
        const respondedDate = new Date(e.respondedAt);
        if (respondedDate < monthStart || respondedDate > monthEnd) continue;

        const prevStatus = e.previousStatus || 'pending';
        const currentResponse = e.response;
        let fromLabel = 'Pending';
        let toLabel = 'Active';

        if (prevStatus === 'accepted' || prevStatus === 'active') fromLabel = 'Active';
        else if (prevStatus === 'pending' || prevStatus === 'requested') fromLabel = 'Pending';

        if (currentResponse === 'accepted') toLabel = 'Active';
        else if (currentResponse === 'rejected') toLabel = 'Passed';

        if (fromLabel === toLabel) continue;

        try {
          const buyer = await this.buyerModel.findById(buyerId).select('fullName companyName').lean().exec();
          movements.push({
            buyerName: (buyer as any)?.fullName || 'Unknown Buyer',
            buyerCompany: (buyer as any)?.companyName || '',
            fromStatus: fromLabel,
            toStatus: toLabel,
            date: formatDate(respondedDate),
          });
        } catch {
          movements.push({
            buyerName: 'Unknown Buyer',
            buyerCompany: '',
            fromStatus: fromLabel,
            toStatus: toLabel,
            date: formatDate(respondedDate),
          });
        }
      }

      totalMovements += movements.length;

      reportDeals.push({
        id: dealId,
        title: deal.title || 'Untitled Deal',
        revenue: formatCurrency((deal as any).financialDetails?.trailingRevenueAmount),
        ebitda: formatCurrency((deal as any).financialDetails?.trailingEBITDAAmount),
        listedDate: formatDate((deal as any).createdAt),
        status,
        activeBuyerCount: activeBuyerEntries.length,
        passedCount,
        activeBuyers,
        movements,
        ...(await this.dealsService.createSellerActionUrls(dealId, seller._id.toString())),
      });
    }

    const newBuyersLastMonth = await this.buyerModel.countDocuments({
      createdAt: { $gte: monthStart, $lte: monthEnd },
    }).exec();

    return {
      advisorName: seller.fullName || 'Advisor',
      advisorCompany: seller.companyName || '',
      monthYear,
      activeDealsCount: allReportDeals.length,
      totalBuyerInterest,
      movementsThisMonth: totalMovements,
      deals: reportDeals,
      frontendUrl,
      newBuyersLastMonth,
    };
  }
}
