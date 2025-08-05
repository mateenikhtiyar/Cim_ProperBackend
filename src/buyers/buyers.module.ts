import { Module, forwardRef } from "@nestjs/common"
import { MulterModule } from "@nestjs/platform-express"
import { BuyersController } from "buyers/buyers.controller"
import { BuyersService } from "buyers/buyers.service"
import { AuthModule } from "../auth/auth.module"
import { SharedModule } from "shared.module"
// Add DealsService to the imports and providers
import { DealsService } from "../deals/deals.service"
import { MongooseModule } from "@nestjs/mongoose"
import { Buyer, BuyerSchema } from "./schemas/buyer.schema"
import { MailModule } from "mail/mail.module"

@Module({
  imports: [SharedModule, MulterModule.register({ dest: "./Uploads" }), forwardRef(() => AuthModule), MongooseModule.forFeature([{ name: Buyer.name, schema: BuyerSchema }]),MailModule],
  controllers: [BuyersController],
  providers: [BuyersService, DealsService],
  exports: [BuyersService],
})
export class BuyersModule { }
