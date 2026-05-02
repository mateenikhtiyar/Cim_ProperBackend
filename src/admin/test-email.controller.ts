import { Controller, Post, Get, UseGuards, Body, Logger, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CronService } from '../cron/cron.service';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { genericEmailTemplate } from '../mail/generic-email.template';
import { ILLUSTRATION_ATTACHMENT } from '../mail/mail.service';

@Controller('admin/test-email')
export class TestEmailController {
  private readonly logger = new Logger(TestEmailController.name);

  constructor(
    private cronService: CronService,
    private authService: AuthService,
    private mailService: MailService
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('profile-completion-reminder')
  async testProfileCompletionReminder() {
    await this.cronService.testProfileCompletionReminder();
    return { message: 'Profile completion reminder test triggered' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('simple-email')
  async testSimpleEmail(@Body() body: { email: string }) {
    try {
      const subject = 'Test Email from CIM Amplify';
      const emailContent = `
        <p>This is a test email to verify that the email system is working correctly.</p>
        <p>If you receive this email, the system is functioning properly.</p>
        <p>Timestamp: ${new Date().toISOString()}</p>
      `;

      const emailBody = genericEmailTemplate(subject, 'Test User', emailContent);

      await this.mailService.sendEmailWithLogging(
        body.email,
        'admin',
        subject,
        emailBody,
        [ILLUSTRATION_ATTACHMENT]
      );

      return { message: `Test email sent to ${body.email}` };
    } catch (error) {
      this.logger.error('Failed to send test email', error instanceof Error ? error.stack : String(error));
      throw new BadRequestException('Failed to send test email. Please try again.');
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('cron-status')
  async getCronStatus() {
    return {
      message: 'Cron service is available',
      timestamp: new Date().toISOString(),
      note: 'Check server logs for cron job execution details'
    };
  }
}