import { Module, forwardRef } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Admin, AdminSchema } from './schemas/admin.schema';
import { CompanyProfile, CompanyProfileSchema } from '../company-profile/schemas/company-profile.schema';
import { Buyer, BuyerSchema } from '../buyers/schemas/buyer.schema';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { BuyersModule } from '../buyers/buyers.module';
import { SellersModule } from '../sellers/sellers.module';
import { CompanyProfileModule } from '../company-profile/company-profile.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Admin.name, schema: AdminSchema },
      { name: CompanyProfile.name, schema: CompanyProfileSchema },
      { name: Buyer.name, schema: BuyerSchema },
      { name: Seller.name, schema: SellerSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => BuyersModule),
    forwardRef(() => SellersModule),
    forwardRef(() => CompanyProfileModule),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule { }