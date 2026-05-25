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
import { getClientThrottleTracker } from "./common/throttle-tracker";

const ONE_SECOND_MS = 1000
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS

const GLOBAL_THROTTLE_LIMIT_PER_SECOND = 5000
const GLOBAL_THROTTLE_LIMIT_PER_MINUTE = 100000
const GLOBAL_THROTTLE_LIMIT_PER_HOUR = 1000000

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '..', '.env'),
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      { name: "default", ttl: ONE_MINUTE_MS, limit: GLOBAL_THROTTLE_LIMIT_PER_MINUTE, getTracker: getClientThrottleTracker },
      { name: "short", ttl: ONE_SECOND_MS, limit: GLOBAL_THROTTLE_LIMIT_PER_SECOND, getTracker: getClientThrottleTracker },
      { name: "long", ttl: ONE_HOUR_MS, limit: GLOBAL_THROTTLE_LIMIT_PER_HOUR, getTracker: getClientThrottleTracker },
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
