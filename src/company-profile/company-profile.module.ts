import { Module, forwardRef } from '@nestjs/common';
import { CompanyProfileService } from './company-profile.service';
import { CompanyProfileController } from './company-profile.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { CompanyProfile, CompanyProfileSchema } from './schemas/company-profile.schema';
import { Buyer, BuyerSchema } from '../buyers/schemas/buyer.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CompanyProfile.name, schema: CompanyProfileSchema },
      { name: Buyer.name, schema: BuyerSchema },
    ]),
  ],
  controllers: [CompanyProfileController],
  providers: [CompanyProfileService],
  exports: [CompanyProfileService], 
})
export class CompanyProfileModule { }