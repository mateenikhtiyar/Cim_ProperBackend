import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CronService } from './cron.service';
import { DealsModule } from '../deals/deals.module';
import { MailModule } from '../mail/mail.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { Buyer, BuyerSchema } from '../buyers/schemas/buyer.schema';
import { EmailVerification, EmailVerificationSchema } from '../auth/schemas/email-verification.schema';
import { CompanyProfile, CompanyProfileSchema } from '../company-profile/schemas/company-profile.schema';

@Module({
  imports: [
    DealsModule,
    MailModule,
    MongooseModule.forFeature([
      { name: Seller.name, schema: SellerSchema },
      { name: Buyer.name, schema: BuyerSchema },
      { name: EmailVerification.name, schema: EmailVerificationSchema },
      { name: CompanyProfile.name, schema: CompanyProfileSchema },
    ]),
  ],
  providers: [CronService],
  exports: [CronService],
})
export class CronModule {}
