import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CronService } from './cron.service';
import { DealsModule } from '../deals/deals.module';
import { MailModule } from '../mail/mail.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { Buyer, BuyerSchema } from '../buyers/schemas/buyer.schema';

@Module({
  imports: [
    DealsModule,
    MailModule,
    MongooseModule.forFeature([
      { name: Seller.name, schema: SellerSchema },
      { name: Buyer.name, schema: BuyerSchema },
    ]),
  ],
  providers: [CronService],
})
export class CronModule {}
