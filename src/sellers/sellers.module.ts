import { Module, forwardRef } from "@nestjs/common"
import { MulterModule } from '@nestjs/platform-express';
import { SellersController } from "./sellers.controller"
import { SellersService } from "./sellers.service"
import { AuthModule } from "../auth/auth.module"
import { ConfigModule } from "@nestjs/config"
import { SharedModule } from "../shared.module"
import { DealsService } from "../deals/deals.service"
import * as fs from 'fs';

// Ensure upload directory exists
const uploadDir = './uploads/profile-pictures';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => SharedModule),
    ConfigModule,
    MulterModule.register({
      dest: './uploads/profile-pictures',
    }),
  ],
  controllers: [SellersController],
  providers: [SellersService, DealsService],
  exports: [SellersService],
})
export class SellersModule { }