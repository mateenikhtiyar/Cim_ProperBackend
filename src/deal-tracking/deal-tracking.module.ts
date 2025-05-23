import { Module, forwardRef } from '@nestjs/common';
import { DealTrackingController } from 'deal-tracking/deal-tracking.controller';
import { DealTrackingService } from './deal-tracking.service';
import { AuthModule } from '../auth/auth.module';
import { SharedModule } from '../shared.module';

@Module({
  imports: [
    SharedModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [DealTrackingController],
  providers: [DealTrackingService],
  exports: [DealTrackingService],
})
export class DealTrackingModule { }
