import { Module, forwardRef } from "@nestjs/common"
import { MulterModule } from '@nestjs/platform-express';
import { SellersController } from "./sellers.controller"
import { SellersService } from "./sellers.service"
import { AuthModule } from "../auth/auth.module"
import { ConfigModule } from "@nestjs/config"
import { DealsService } from "../deals/deals.service"
import * as fs from 'fs';
import { MailModule } from "mail/mail.module";
import { MongooseModule } from "@nestjs/mongoose";
import { Seller, SellerSchema } from "./schemas/seller.schema";
import { DealsModule } from "../deals/deals.module";

// Ensure upload directory exists
const uploadDir = './uploads/profile-pictures';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

@Module({
  imports: [
    forwardRef(() => AuthModule),
    ConfigModule,
    MailModule,
    MongooseModule.forFeature([{ name: Seller.name, schema: SellerSchema }]),
    MulterModule.register({
      dest: './uploads/profile-pictures',
    }),
    forwardRef(() => DealsModule),
  ],
  controllers: [SellersController],
  providers: [SellersService],
  exports: [SellersService],
})
export class SellersModule { }