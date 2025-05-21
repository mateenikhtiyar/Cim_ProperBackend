import { Module, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BuyersService } from 'buyers/buyers.service';
import { AdminService } from 'admin/admin.service';
import { SellersService } from 'sellers/sellers.service';
import { Buyer, BuyerSchema } from 'buyers/schemas/buyer.schema';
import { Admin, AdminSchema } from 'admin/schemas/admin.schema';
import { Seller, SellerSchema } from 'sellers/schemas/seller.schema';
import { CompanyProfile, CompanyProfileSchema } from 'company-profile/schemas/company-profile.schema';
import { Deal, DealSchema } from 'deals/schemas/deal.schema';
import { DealTracking, DealTrackingSchema } from 'deal-tracking/schemas/deal-tracking.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Buyer.name, schema: BuyerSchema },
      { name: Admin.name, schema: AdminSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: CompanyProfile.name, schema: CompanyProfileSchema },
      { name: Deal.name, schema: DealSchema },
      { name: DealTracking.name, schema: DealTrackingSchema },
    ]),
  ],
  providers: [
    BuyersService,
    AdminService,
    SellersService,
  ].map((provider, index) => {
    Logger.log(`SharedModule provider at index[${ index }]: ${ provider.name } `, 'SharedModule');
    return provider;
  }),
  exports: [
    BuyersService,
    AdminService,
    SellersService,
    MongooseModule.forFeature([
      { name: Buyer.name, schema: BuyerSchema },
      { name: Admin.name, schema: AdminSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: CompanyProfile.name, schema: CompanyProfileSchema },
      { name: Deal.name, schema: DealSchema },
      { name: DealTracking.name, schema: DealTrackingSchema },
    ]),
  ],
})
export class SharedModule {}
