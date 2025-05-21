import { Module, forwardRef } from "@nestjs/common"
import { SellersController } from "./sellers.controller"
import { SellersService } from "./sellers.service"
import { AuthModule } from "../auth/auth.module"
import { ConfigModule } from "@nestjs/config"
import { SharedModule } from "../shared.module"
// Add DealsService to the imports and providers
import { DealsService } from "../deals/deals.service"

@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => SharedModule),
    ConfigModule, // Added ConfigModule here to make ConfigService available
  ],
  controllers: [SellersController],
  providers: [SellersService, DealsService],
  exports: [SellersService],
})
export class SellersModule { }
