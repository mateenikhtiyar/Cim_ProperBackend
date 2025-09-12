import { Module, forwardRef } from '@nestjs/common';
import { DealTrackingController } from 'deal-tracking/deal-tracking.controller';
import { DealTrackingService } from './deal-tracking.service';
import { AuthModule } from '../auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { DealTracking, DealTrackingSchema } from './schemas/deal-tracking.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    MongooseModule.forFeature([
      { name: DealTracking.name, schema: DealTrackingSchema },
      { name: Deal.name, schema: DealSchema },
    ]),
  ],
  controllers: [DealTrackingController],
  providers: [DealTrackingService],
  exports: [DealTrackingService],
})
export class DealTrackingModule { }
