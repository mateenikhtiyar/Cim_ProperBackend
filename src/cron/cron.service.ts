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

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private dealsService: DealsService,
    private mailService: MailService,
    @InjectModel(Seller.name) private sellerModel: Model<SellerDocument>,
    @InjectModel(Buyer.name) private buyerModel: Model<BuyerDocument>,
    @InjectModel(EmailVerification.name) private emailVerificationModel: Model<EmailVerificationDocument>,
  ) {}

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
          <p>We are always adding new buyers that may be a match. To watch for new matches simply click Activity on the deal card and then click on the Invite Additional Buyers button.</p>
          <p>Please help us to keep the platform up to date by clicking the Off Market button when the deal is sold or paused. If sold to one of our introduced buyers we will be in touch to arrange payment of your reward!</p>
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
          <p>Please keep your <a href="${process.env.FRONTEND_URL}/buyer/login">dashboard</a> up to date by moving Pending deals to either Pass or View CIM.</p>
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
