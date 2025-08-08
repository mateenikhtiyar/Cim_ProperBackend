// src/mail/mail.service.ts
// src/mail/mail.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CommunicationLog, CommunicationLogDocument } from './schemas/communication-log.schema';
import { join } from 'path';
import * as nodemailer from 'nodemailer';
import { genericEmailTemplate } from './generic-email.template';

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
      <p>Click the link below to reset your password:</p>
      <a href="${resetLink}" target="_blank">Reset Password</a>
      <p>This link will expire in 15 minutes.</p>
    `;

    const emailBody = genericEmailTemplate(subject, name, emailContent);

    await this.sendEmailWithLogging(to, 'user', subject, emailBody, [ILLUSTRATION_ATTACHMENT]);
  }
  
  
}
