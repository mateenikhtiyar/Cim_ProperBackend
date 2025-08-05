import { Module, forwardRef } from "@nestjs/common"
import { DealsController } from "./deals.controller"
import { DealsService } from "./deals.service"
import { AuthModule } from "../auth/auth.module"
import { SharedModule } from "../shared.module"
import { DealTrackingService } from "../deal-tracking/deal-tracking.service"
import { MailModule } from "../mail/mail.module"
import { MongooseModule } from "@nestjs/mongoose"
import { SellerSchema, Seller } from "../sellers/schemas/seller.schema"

@Module({
  imports: [
    SharedModule,
    forwardRef(() => AuthModule),
    MailModule,
    MongooseModule.forFeature([{ name: Seller.name, schema: SellerSchema }]),
  ],
  controllers: [DealsController],
  providers: [DealsService, DealTrackingService],
  exports: [DealsService],
})
export class DealsModule { }