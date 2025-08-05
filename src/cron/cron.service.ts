import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DealsService } from '../deals/deals.service';
import { MailService } from '../mail/mail.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Seller, SellerDocument } from '../sellers/schemas/seller.schema';
import { Buyer, BuyerDocument } from '../buyers/schemas/buyer.schema';
import { DealDocumentType } from '../deals/schemas/deal.schema';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private dealsService: DealsService,
    private mailService: MailService,
    @InjectModel(Seller.name) private sellerModel: Model<SellerDocument>,
    @InjectModel(Buyer.name) private buyerModel: Model<BuyerDocument>,
  ) {}

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async handleMonthlySellerActivitySummary() {
    this.logger.log('Running monthly seller activity summary cron job');
    const sellers = await this.sellerModel.find().exec();

    for (const seller of sellers) {
      const dealsRaw = await this.dealsService.findBySeller(seller._id.toString());
      const deals = dealsRaw as DealDocumentType[];

      let activeDealsCount = 0;
      let pendingDealsCount = 0;
      let rejectedDealsCount = 0;

      for (const deal of deals) {
        const dealIdStr =
          deal._id instanceof Types.ObjectId ? deal._id.toHexString() : String(deal._id);

        const summary = await this.dealsService.getDealWithBuyerStatusSummary(dealIdStr);

        activeDealsCount += summary.summary.totalActive;
        pendingDealsCount += summary.summary.totalPending;
        rejectedDealsCount += summary.summary.totalRejected;
      }

      const subject = 'Monthly Deal Activity Summary';
      const htmlBody = `
        <p>Dear ${seller.fullName},</p>
        <p>Here is a summary of your deal activity for the past month:</p>
        <ul>
          <li>Active Deals: ${activeDealsCount}</li>
          <li>Pending Deals: ${pendingDealsCount}</li>
          <li>Rejected Deals: ${rejectedDealsCount}</li>
        </ul>
        <p>Thank you for being a part of CIM Amplify.</p>
        <p>Best regards,</p>
        <p>The CIM Amplify Team</p>
      `;
      await this.mailService.sendEmailWithLogging(seller.email, 'seller', subject, htmlBody);
    }
  }

  @Cron('0 0 1 */2 *') // every two months
  async handleBiMonthlySellerReminder() {
    this.logger.log('Running bi-monthly seller reminder cron job');
    const sellers = await this.sellerModel.find().exec();

    for (const seller of sellers) {
      const activeDeals = await this.dealsService.getSellerActiveDeals(seller._id.toString());
      if (activeDeals.length === 0) {
        const subject = 'Time to add new deals to CIM Amplify!';
        const htmlBody = `
          <p>Dear ${seller.fullName},</p>
          <p>We noticed you don't have any active deals on CIM Amplify at the moment.</p>
          <p>Don't miss out on potential matches! Add new deals today to connect with interested buyers.</p>
          <p>Best regards,</p>
          <p>The CIM Amplify Team</p>
        `;
        await this.mailService.sendEmailWithLogging(seller.email, 'seller', subject, htmlBody);
      }
    }
  }

  @Cron(CronExpression.EVERY_6_MONTHS) // every Jan and Jul 1st
  async handleSemiAnnualBuyerReminder() {
    this.logger.log('Running semi-annual buyer reminder cron job');
    const buyers = await this.buyerModel.find().exec();

    for (const buyer of buyers) {
      const subject = 'Update your target criteria on CIM Amplify!';
      const htmlBody = `
        <p>Dear ${buyer.fullName},</p>
        <p>It's been a while since you last updated your target criteria on CIM Amplify.</p>
        <p>Ensure you're getting the best deal matches by reviewing and updating your preferences.</p>
        <p>Best regards,</p>
        <p>The CIM Amplify Team</p>
      `;
      await this.mailService.sendEmailWithLogging(buyer.email, 'buyer', subject, htmlBody);
    }
  }
}
