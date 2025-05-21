import { Module, forwardRef } from "@nestjs/common"
import { MulterModule } from "@nestjs/platform-express"
import { BuyersController } from "buyers/buyers.controller"
import { BuyersService } from "buyers/buyers.service"
import { AuthModule } from "../auth/auth.module"
import { SharedModule } from "shared.module"
// Add DealsService to the imports and providers
import { DealsService } from "../deals/deals.service"

@Module({
  imports: [SharedModule, MulterModule.register({ dest: "./Uploads" }), forwardRef(() => AuthModule)],
  controllers: [BuyersController],
  providers: [BuyersService, DealsService],
  exports: [BuyersService],
})
export class BuyersModule { }
