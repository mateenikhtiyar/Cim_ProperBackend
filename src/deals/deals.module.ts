import { Module, forwardRef } from "@nestjs/common"
import { DealsController } from "./deals.controller"
import { DealsService } from "./deals.service"
import { AuthModule } from "../auth/auth.module"
import { DealTrackingService } from "../deal-tracking/deal-tracking.service"
import { MailModule } from "../mail/mail.module"
import { MongooseModule } from "@nestjs/mongoose"
import { SellerSchema, Seller } from "../sellers/schemas/seller.schema"
import { Deal, DealSchema } from "./schemas/deal.schema"
import { Buyer, BuyerSchema } from "../buyers/schemas/buyer.schema"
import { DealTrackingModule } from "../deal-tracking/deal-tracking.module"

@Module({
  imports: [
    forwardRef(() => AuthModule),
    MailModule,
    MongooseModule.forFeature([
      { name: Seller.name, schema: SellerSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Buyer.name, schema: BuyerSchema },
    ]),
    forwardRef(() => DealTrackingModule),
  ],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule { }