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
import { SharedModule } from "shared.module"
import { DealsService } from "deals/deals.service"

@Module({
  imports: [
    ConfigModule.forRoot(),
    MongooseModule.forRoot(process.env.MONGODB_URI || "mongodb://localhost/e-commerce"),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "..", "Uploads"),
      serveRoot: "/Uploads",
    }),
    SharedModule,
    BuyersModule,
    AuthModule,
    CompanyProfileModule,
    AdminModule,
    SellersModule,
    DealsModule,
    DealTrackingModule,
  ],
  providers: [
    // Make DealsService available globally
    {
      provide: "DealsService",
      useClass: DealsService,
    },
  ],
})
export class AppModule { }
