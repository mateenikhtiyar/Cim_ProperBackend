// src/mail/mail.service.ts
// src/mail/mail.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CommunicationLog, CommunicationLogDocument } from './schemas/communication-log.schema';
import { join } from 'path';
import * as nodemailer from 'nodemailer';
import { genericEmailTemplate, emailButton } from './generic-email.template';

export const ILLUSTRATION_ATTACHMENT = {
  filename: 'illustration.png',
  path: join(process.cwd(), 'assets', 'illustration.png'),
  cid: 'illustration',
};


@Injectable()
export class MailService {
  constructor(
    @InjectModel(CommunicationLog.name)
    private communicationLogModel: Model<CommunicationLogDocument>,
  ) {}

  private transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  async sendEmail(to: string, subject: string, htmlBody: string, attachments: any[] = []) {
    try {
      return await this.transporter.sendMail({
        from: `"Deal Flow" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html: htmlBody,
        attachments,
      });
    } catch (error) {
      console.error("Error sending email:", error);
      throw error;
    }
  }

  async sendEmailWithLogging(
    recipientEmail: string,
    recipientType: string,
    subject: string,
    body: string,
    attachments: any[] = [],
    relatedDealId?: string,
  ): Promise<void> {
    try {
      await this.sendEmail(recipientEmail, subject, body, attachments);

      await this.communicationLogModel.create({
        recipientEmail,
        recipientType,
        subject,
        body,
        sentAt: new Date(),
        communicationType: 'email',
        status: 'sent',
        relatedDealId,
      });
    } catch (err) {
      await this.communicationLogModel.create({
        recipientEmail,
        recipientType,
        subject,
        body,
        sentAt: new Date(),
        communicationType: 'email',
        status: 'failed',
        relatedDealId,
      });
      throw err;
    }
  }
  async sendResetPasswordEmail(to: string, name: string, resetLink: string): Promise<void> {
    const subject = 'Reset your password';
    const emailContent = `
      <p>Click the button below to reset your password:</p>
      ${emailButton('Reset Password', resetLink)}
      <p>This link will expire in 15 minutes.</p>
    `;

    const emailBody = genericEmailTemplate(subject, name, emailContent);

    await this.sendEmailWithLogging(to, 'user', subject, emailBody, [ILLUSTRATION_ATTACHMENT]);
  }

  async sendEmailDeliveryIssueNotification(
    userEmail: string,
    userName: string,
    userRole: 'buyer' | 'seller',
    contactInfo: {
      companyName?: string;
      phone?: string;
      website?: string;
    },
  ): Promise<void> {
    const subject = `Email Delivery Issue Report - ${userRole.charAt(0).toUpperCase() + userRole.slice(1)} Registration`;
    const emailContent = `
      <p style="font-size: 16px; margin-bottom: 20px;">A new user has reported that they did not receive their welcome email after registration.</p>

      <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="color: #1a1a1a; font-size: 18px; font-weight: 700; margin: 0 0 16px 0; border-bottom: 2px solid #3aafa9; padding-bottom: 8px;">User Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; width: 120px; font-size: 14px;">Name:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;">${userName || 'Not provided'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Email:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;"><a href="mailto:${userEmail}" style="color: #3aafa9; text-decoration: none;">${userEmail}</a></td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Phone:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;">${contactInfo.phone ? `<a href="tel:${contactInfo.phone}" style="color: #3aafa9; text-decoration: none;">${contactInfo.phone}</a>` : 'Not provided'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Company:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;">${contactInfo.companyName || 'Not provided'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Website:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;">${contactInfo.website ? `<a href="${contactInfo.website}" target="_blank" style="color: #3aafa9; text-decoration: none;">${contactInfo.website}</a>` : 'Not provided'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Role:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;"><span style="background-color: ${userRole === 'buyer' ? '#dbeafe' : '#dcfce7'}; color: ${userRole === 'buyer' ? '#1d4ed8' : '#16a34a'}; padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 700;">${userRole.charAt(0).toUpperCase() + userRole.slice(1)}</span></td>
          </tr>
          <tr>
            <td style="padding: 12px 8px; font-weight: 700; color: #374151; font-size: 14px;">Reported At:</td>
            <td style="padding: 12px 8px; font-weight: 600; color: #1a1a1a; font-size: 15px;">${new Date().toLocaleString()}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin-top: 20px; border-radius: 0 8px 8px 0;">
        <p style="margin: 0; font-weight: 700; color: #92400e; font-size: 15px;">Action Required</p>
        <p style="margin: 8px 0 0 0; color: #78350f; font-size: 14px;">Please contact this user to assist with their email delivery issue and ensure they can access the platform.</p>
      </div>
    `;

    const emailBody = genericEmailTemplate(subject, 'Support Team', emailContent);

    await this.sendEmailWithLogging(
      'canotifications@amp-ven.com',
      'admin',
      subject,
      emailBody,
      [ILLUSTRATION_ATTACHMENT],
    );
  }
}
