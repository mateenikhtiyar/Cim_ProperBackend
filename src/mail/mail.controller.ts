import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { MailService } from './mail.service';

class ReportEmailIssueDto {
  email: string;
  fullName: string;
  role: 'buyer' | 'seller';
  companyName?: string;
  phone?: string;
  website?: string;
}

@ApiTags('mail')
@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('report-email-issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report email delivery issue to support team' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'User email address' },
        fullName: { type: 'string', description: 'User full name' },
        role: { type: 'string', enum: ['buyer', 'seller'], description: 'User role' },
        companyName: { type: 'string', description: 'Company name' },
        phone: { type: 'string', description: 'Phone number' },
        website: { type: 'string', description: 'Website URL' },
      },
      required: ['email', 'role'],
    },
  })
  @ApiResponse({ status: 200, description: 'Issue reported successfully' })
  @ApiResponse({ status: 500, description: 'Failed to send notification' })
  async reportEmailIssue(@Body() body: ReportEmailIssueDto) {
    await this.mailService.sendEmailDeliveryIssueNotification(
      body.email,
      body.fullName,
      body.role,
      {
        companyName: body.companyName,
        phone: body.phone,
        website: body.website,
      },
    );

    return {
      success: true,
      message: 'Email delivery issue reported. Our team will contact you soon.',
    };
  }
}
