// file: src/buyers/buyers.module.ts
import { Module, forwardRef } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { BuyersController } from "./buyers.controller";
import { BuyersService } from "./buyers.service";
import { AuthModule } from "../auth/auth.module";
import { MongooseModule } from "@nestjs/mongoose";
import { Buyer, BuyerSchema } from "./schemas/buyer.schema";
import { CompanyProfile, CompanyProfileSchema } from "../company-profile/schemas/company-profile.schema";
import { MailModule } from "../mail/mail.module";
import { DealsModule } from "../deals/deals.module";

@Module({
  imports: [
    MulterModule.register({ dest: "./Uploads" }),
    forwardRef(() => AuthModule),
    MongooseModule.forFeature([
      { name: Buyer.name, schema: BuyerSchema },
      { name: CompanyProfile.name, schema: CompanyProfileSchema },
    ]),
    MailModule,
    forwardRef(() => DealsModule),
  ],
  controllers: [BuyersController],
  providers: [BuyersService],
  exports: [BuyersService],   // ✅ make BuyersService available to AdminModule
})
export class BuyersModule {}

