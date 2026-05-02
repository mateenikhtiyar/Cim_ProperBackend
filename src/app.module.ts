import { Module } from "@nestjs/common"
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core"
import { CacheControlInterceptor } from "./common/cache-control.interceptor"
import { MongooseModule } from "@nestjs/mongoose"
import { ConfigModule } from "@nestjs/config"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { join } from "path"
import { BuyersModule } from "buyers/buyers.module"
import { AuthModule } from "auth/auth.module"
import { CompanyProfileModule } from "company-profile/company-profile.module"
import { AdminModule } from "admin/admin.module"
import { SellersModule } from "sellers/sellers.module"
import { DealsModule } from "deals/deals.module"
import { DealTrackingModule } from "deal-tracking/deal-tracking.module"
import { MailModule } from './mail/mail.module';
import { ClassificationModule } from './classification/classification.module';
import { TeamModule } from './team/team.module';
import { validateEnvironment } from "./config/env.validation";
import { CronModule } from './cron/cron.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '..', '.env'),
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      { name: "default", ttl: 60000, limit: 30000 },
      { name: "short", ttl: 1000, limit: 500 },
      { name: "long", ttl: 3600000, limit: 200000 },
    ]),
    MongooseModule.forRoot(process.env.MONGODB_URI as string, {
      maxPoolSize: 100,
      minPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4,
    }),
    ScheduleModule.forRoot(),
    BuyersModule,
    AuthModule,
    CompanyProfileModule,
    AdminModule,
    SellersModule,
    DealsModule,
    DealTrackingModule,
    MailModule,
    // CronModule must run on exactly one backend instance. Do not scale this
    // backend to >1 pm2 instance or cluster mode without first gating cron jobs
    // by NODE_APP_INSTANCE === '0', otherwise emails will fire N times.
    CronModule,
    ClassificationModule,
    TeamModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheControlInterceptor,
    },
  ],
  controllers: [],
})
export class AppModule { }
