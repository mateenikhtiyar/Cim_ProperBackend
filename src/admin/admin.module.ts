import { Module, forwardRef } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { SharedModule } from '../shared.module';
import { CompanyProfileService } from '../company-profile/company-profile.service';

@Module({
  imports: [
    SharedModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [AdminController],
  providers: [AdminService, CompanyProfileService],
  exports: [AdminService],
})
export class AdminModule { }