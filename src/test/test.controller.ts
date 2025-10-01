import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CronService } from '../cron/cron.service';

@Controller('test')
export class TestController {
  constructor(private readonly cronService: CronService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('profile-completion-reminder')
  async testProfileCompletionReminder() {
    await this.cronService.testProfileCompletionReminder();
    return { message: 'Profile completion reminder test triggered' };
  }
}