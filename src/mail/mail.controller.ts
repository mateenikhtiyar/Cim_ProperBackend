import { Controller, Post, Body, HttpCode, HttpStatus, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { MailService } from './mail.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { IsString, IsEmail, IsOptional, IsArray, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

class ReportEmailIssueDto {
  @IsEmail()
  email: string;

  @IsString()
  fullName: string;

  @IsIn(['buyer', 'seller'])
  role: 'buyer' | 'seller';

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  website?: string;
}

class RecipientDto {
  @IsEmail()
  email: string;

  @IsString()
  role: string;
}

class SendCustomEmailDto {
  @IsIn(['single', 'multiple', 'all', 'all-buyers', 'all-sellers', 'all-admins', 'all-members'])
  recipientType: 'single' | 'multiple' | 'all' | 'all-buyers' | 'all-sellers' | 'all-admins' | 'all-members';

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  recipientRole?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipientDto)
  multipleRecipients?: RecipientDto[];

  @IsString()
  subject: string;

  @IsString()
  body: string;
}

class SendTemplateEmailDto {
  @IsIn(['advisor-monthly', 'buyer-monthly', 'semiannual-buyer-reminder', 'introduction-followup'])
  templateType: 'advisor-monthly' | 'buyer-monthly' | 'semiannual-buyer-reminder' | 'introduction-followup';

  @IsIn(['all-buyers', 'all-sellers', 'single', 'all'])
  recipientType: 'all-buyers' | 'all-sellers' | 'single' | 'all';

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;
}

@ApiTags('mail')
@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('admin/logs')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get email logs for admin dashboard' })
  @ApiResponse({ status: 200, description: 'Email logs fetched successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String, enum: ['sent', 'failed'] })
  @ApiQuery({ name: 'recipientType', required: false, type: String, enum: ['buyer', 'seller', 'admin', 'other', 'user'] })
  async getAdminEmailLogs(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('search') search: string = '',
    @Query('status') status: string = '',
    @Query('recipientType') recipientType: string = '',
  ) {
    return this.mailService.getAdminEmailLogs(
      Number(page),
      Number(limit),
      search,
      status,
      recipientType,
    );
  }

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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('admin/send-custom-email')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send custom email to users' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        recipientType: { type: 'string', enum: ['single', 'multiple', 'all', 'all-buyers', 'all-sellers', 'all-admins', 'all-members'], description: 'Type of recipients' },
        recipientEmail: { type: 'string', description: 'Email address for single recipient' },
        recipientRole: { type: 'string', description: 'Role for single recipient (buyer, seller, admin, buyer-member, seller-member)' },
        multipleRecipients: { type: 'array', items: { type: 'object', properties: { email: { type: 'string' }, role: { type: 'string' } } }, description: 'Array of recipients with email and role' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body content (plain text or HTML)' },
      },
      required: ['recipientType', 'subject', 'body'],
    },
  })
  @ApiResponse({ status: 200, description: 'Email(s) sent successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  async sendCustomEmail(@Body() body: SendCustomEmailDto) {
    return this.mailService.sendCustomEmail(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('admin/send-template-email')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send template email (monthly reports)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        templateType: { type: 'string', enum: ['advisor-monthly', 'buyer-monthly', 'semiannual-buyer-reminder', 'introduction-followup'], description: 'Template type' },
        recipientType: { type: 'string', enum: ['all-buyers', 'all-sellers', 'single', 'all'], description: 'Recipient type' },
        recipientEmail: { type: 'string', description: 'Email for single recipient' },
      },
      required: ['templateType', 'recipientType'],
    },
  })
  @ApiResponse({ status: 200, description: 'Template email(s) sent successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  async sendTemplateEmail(@Body() body: SendTemplateEmailDto) {
    return this.mailService.sendTemplateEmail(body);
  }
}
