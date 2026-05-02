import { Module, forwardRef } from "@nestjs/common"
import { SellersController } from "./sellers.controller"
import { SellersService } from "./sellers.service"
import { AuthModule } from "../auth/auth.module"
import { ConfigModule } from "@nestjs/config"
import { MailModule } from "mail/mail.module";
import { MongooseModule } from "@nestjs/mongoose";
import { Seller, SellerSchema } from "./schemas/seller.schema";
import { DealsModule } from "../deals/deals.module";

@Module({
  imports: [
    forwardRef(() => AuthModule),
    ConfigModule,
    MailModule,
    MongooseModule.forFeature([{ name: Seller.name, schema: SellerSchema }]),
    forwardRef(() => DealsModule),
  ],
  controllers: [SellersController],
  providers: [SellersService],
  exports: [SellersService],
})
export class SellersModule { }