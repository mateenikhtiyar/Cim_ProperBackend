import { Module } from "@nestjs/common"
import { MongooseModule } from "@nestjs/mongoose"
import { ConfigModule } from "@nestjs/config"
import { ServeStaticModule } from "@nestjs/serve-static"
import { join } from "path"
import { BuyersModule } from "buyers/buyers.module"
import { AuthModule } from "auth/auth.module"
import { CompanyProfileModule } from "company-profile/company-profile.module"
import { AdminModule } from "admin/admin.module"
import { SellersModule } from "sellers/sellers.module"
import { DealsModule } from "deals/deals.module"
import { DealTrackingModule } from "deal-tracking/deal-tracking.module"
import { DealsService } from "deals/deals.service"
import { MailModule } from './mail/mail.module';
import { ClassificationModule } from './classification/classification.module';


import { CronModule } from './cron/cron.module';
// import { TestModule } from './test/test.module'; // Disabled for Vercel
import { ScheduleModule } from '@nestjs/schedule';
import * as path from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '..', '.env'), // Point to CIM-new/backend/.env
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI || "mongodb://localhost/e-commerce"),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "..", "Uploads"),
      serveRoot: "/Uploads",
    }),
    // ScheduleModule.forRoot(), // Disabled for Vercel (10s timeout)
    BuyersModule,
    AuthModule,
    CompanyProfileModule,
    AdminModule,
    SellersModule,
    DealsModule,
    DealTrackingModule,
    MailModule,
    // CronModule, // Disabled for Vercel
    // TestModule, // Disabled for Vercel
    ClassificationModule,
  ],
  providers: [],
  controllers: [],
})
export class AppModule { }
