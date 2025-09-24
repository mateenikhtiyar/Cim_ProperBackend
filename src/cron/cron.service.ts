import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DealsService } from '../deals/deals.service';
import { MailService } from '../mail/mail.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { Buyer, BuyerDocument } from '../buyers/schemas/buyer.schema';
import { DealDocumentType } from '../deals/schemas/deal.schema';
import { genericEmailTemplate } from '../mail/generic-email.template';
import { ILLUSTRATION_ATTACHMENT } from '../mail/mail.service';
import { join } from 'path';
import { EmailVerification, EmailVerificationDocument } from '../auth/schemas/email-verification.schema';
import { CompanyProfile, CompanyProfileDocument } from '../company-profile/schemas/company-profile.schema';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private dealsService: DealsService,
    private mailService: MailService,
    @InjectModel(Seller.name) private sellerModel: Model<SellerDocument>,
    @InjectModel(Buyer.name) private buyerModel: Model<BuyerDocument>,
    @InjectModel(CompanyProfile.name) private companyProfileModel: Model<CompanyProfileDocument>,
    @InjectModel(EmailVerification.name) private emailVerificationModel: Model<EmailVerificationDocument>,
  ) {}


  private isProfileComplete(profile: CompanyProfile): boolean {
    return !!(
      profile.companyName &&
      profile.companyName !== "Set your company name" &&
      profile.website &&
      profile.companyType &&
      profile.companyType !== "Other" &&
      profile.capitalEntity &&
      profile.dealsCompletedLast5Years !== undefined &&
      profile.averageDealSize !== undefined &&
      profile.targetCriteria?.countries?.length > 0 &&
      profile.targetCriteria?.industrySectors?.length > 0 &&
      profile.targetCriteria?.revenueMin !== undefined &&
      profile.targetCriteria?.revenueMax !== undefined &&
      profile.targetCriteria?.ebitdaMin !== undefined &&
      profile.targetCriteria?.ebitdaMax !== undefined &&
      profile.targetCriteria?.transactionSizeMin !== undefined &&
      profile.targetCriteria?.transactionSizeMax !== undefined &&
      profile.targetCriteria?.revenueGrowth !== undefined &&
      profile.targetCriteria?.minStakePercent !== undefined &&
      profile.targetCriteria?.minYearsInBusiness !== undefined &&
      profile.targetCriteria?.preferredBusinessModels?.length > 0 &&
      profile.targetCriteria?.description &&
      profile.agreements?.feeAgreementAccepted
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleProfileCompletionReminder() {
    this.logger.log('Running profile completion reminder cron job');

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000));

    const buyers = await this.buyerModel.find({
      isEmailVerified: true,
      profileCompletionReminderCount: { $lt: 5 },
      $or: [
        { lastProfileCompletionReminderSentAt: { $eq: null } },
        { lastProfileCompletionReminderSentAt: { $lte: twoDaysAgo } }
      ]
    }).populate('companyProfileId').exec();

    for (const buyer of buyers) {
      if (!buyer.companyProfileId) continue;

      const profile = buyer.companyProfileId as any;

      // Check if profile is incomplete
      if (!this.isProfileComplete(profile)) {
        const subject = 'CIM Amplify can not send you deals until you complete your company profile';
        const emailContent = `
          <p>If you have run into any issues please reply to this email with what is happening and we will help to solve the problem.</p>
          <p>If you did not receive a validation email from us please use this link to request a new one: </p>
          
          <p><a href="http://localhost:3000/resend-verification" style="background-color: #3aafa9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Resend Verification Email</a></p>

          <p>Then check your inbox or spam for an email from deals@amp-ven.com</p>

          <p style="color: red;"><b>If you don't plan to complete your profile please reply delete to this email and we will remove your registration.</b></p>

          <p>If you have questions check out our FAQ section at https://cimamplify.com/#FAQs or reply to this email.</p>
        `;

        const emailBody = genericEmailTemplate(subject, buyer.fullName.split(' ')[0], emailContent);

        await this.mailService.sendEmailWithLogging(
          buyer.email,
          'buyer',
          subject,
          emailBody,
          [ILLUSTRATION_ATTACHMENT]
        );

        buyer.profileCompletionReminderCount += 1;
        buyer.lastProfileCompletionReminderSentAt = now;
        await buyer.save();

        this.logger.log(`Profile completion reminder sent to buyer: ${buyer.email}. Count: ${buyer.profileCompletionReminderCount}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async handleMonthlySellerActivitySummary() {
    this.logger.log('Running monthly seller activity summary cron job');
    const sellers = await this.sellerModel.find().exec();

    for (const seller of sellers) {
      const dealsRaw = await this.dealsService.findBySeller(seller._id.toString());
      const deals = dealsRaw as DealDocumentType[];

      for (const deal of deals) {
        const dealIdStr =
          deal._id instanceof Types.ObjectId ? deal._id.toHexString() : String(deal._id);

        const summary = await this.dealsService.getDealWithBuyerStatusSummary(dealIdStr);

        const subject = `Update on ${deal.title} from CIM Amplify`;
        const emailContent = `
          <p>You have ${summary.summary.totalActive} Active, ${summary.summary.totalPending} Pending and ${summary.summary.totalRejected} Passed buyers on <a href="${process.env.FRONTEND_URL}/seller/login">CIM Amplify</a>.</p>
          <p>We are always adding new buyers that may be a match. To watch for new matches simply click Activity on the deal card and then click on the <b>Invite More Buyers</b> button.</p>
          <p>Please help us to keep the platform up to date by clicking the <b>Off Market button</b> when the deal is sold or paused. If sold to one of our introduced buyers we will be in touch to arrange payment of your reward!</p>
        `;

        const emailBody = genericEmailTemplate(subject, seller.fullName.split(' ')[0], emailContent);

        await this.mailService.sendEmailWithLogging(seller.email, 'seller', subject, emailBody, [ILLUSTRATION_ATTACHMENT]);
      }
    }
  }

  @Cron('0 0 1 */2 *') // every two months
  async handleBiMonthlySellerReminder() {
    this.logger.log('Running bi-monthly seller reminder cron job');
    const sellers = await this.sellerModel.find().exec();

    for (const seller of sellers) {
      const activeDeals = await this.dealsService.getSellerActiveDeals(seller._id.toString());
      if (activeDeals.length === 0) {
        const subject = 'Don’t forget to add your new deals over $1 million in EBITDA to CIM Amplify';
        const emailContent = `
          <p>CIM Amplify buyers are incredibly active and we are adding new buyers constantly. Let’s help your clients to find a great buyer together!</p>
          <p>Log in to your <a href="${process.env.FRONTEND_URL}/seller/login">membership portal</a> to add your deals.</p>
        `;

        const emailBody = genericEmailTemplate(subject, seller.fullName.split(' ')[0], emailContent);

        await this.mailService.sendEmailWithLogging(seller.email, 'seller', subject, emailBody, [ILLUSTRATION_ATTACHMENT]);
      }
    }
  }

  @Cron(CronExpression.EVERY_WEEK)
  async handleWeeklyPendingDealsReminder() {
    this.logger.log('Running weekly pending deals reminder cron job');
    const buyers = await this.buyerModel.find().exec();

    for (const buyer of buyers) {
      const pendingDeals = await this.dealsService.getBuyerDeals(buyer._id.toString(), 'pending');

      if (pendingDeals.length > 0) {
        const subject = 'You Have at Least One Deal Pending on CIM Amplify';
        const emailContent = `
          <p>Please keep your <a href="${process.env.FRONTEND_URL}/buyer/login">dashboard</a> up to date by moving Pending deals to either <b>Pass</b> or <b>Move to Active<b/>.</p>
        `;

        const emailBody = genericEmailTemplate(subject, buyer.fullName.split(' ')[0], emailContent);

        await this.mailService.sendEmailWithLogging(
            buyer.email,
            'buyer',
            subject,
            emailBody,
            [ILLUSTRATION_ATTACHMENT],
            );
      }
    }
  }

  @Cron(CronExpression.EVERY_6_MONTHS) // every Jan and Jul 1st
  async handleSemiAnnualBuyerReminder() {
    this.logger.log('Running semi-annual buyer reminder cron job');
    const buyers = await this.buyerModel.find().exec();

    for (const buyer of buyers) {
      const subject = 'Please Make Sure Your CIM Amplify Target Criteria is Up to Date';
      const emailContent = `
        <p>Don’t miss deals that fit your updated criteria! Head to your member <a href="${process.env.FRONTEND_URL}/buyer/login">dashboard</a> and click on Company Profile to make sure your information is up to date.</p>
      `;

      const emailBody = genericEmailTemplate(subject, buyer.fullName.split(' ')[0], emailContent);

      await this.mailService.sendEmailWithLogging(
          buyer.email,
          'buyer',
          subject,
          emailBody,
          [ILLUSTRATION_ATTACHMENT],
          );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanUpExpiredVerificationTokens() {
    this.logger.log('Running cron job to clean up expired verification tokens');
    const result = await this.emailVerificationModel.deleteMany({
      expiresAt: { $lt: new Date() },
      isUsed: false,
    }).exec();
    this.logger.log(`Cleaned up ${result.deletedCount} expired and unused verification tokens.`);
  }
}
