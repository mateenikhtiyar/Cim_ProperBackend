import { Module, forwardRef } from '@nestjs/common';
import { DealsController } from 'deals/deals.controller';
import { DealsService } from 'deals/deals.service';
import { AuthModule } from '../auth/auth.module';
import { SharedModule } from '../shared.module';

@Module({
  imports: [
    SharedModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule { }