import * as nodemailer from 'nodemailer'
import { Injectable } from '@nestjs/common'

@Injectable()
export class MailService {
  private transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // your gmail
      pass: process.env.EMAIL_PASS  // app password
    }
  })

  async sendResetPasswordEmail(to: string, resetLink: string): Promise<void> {
    await this.transporter.sendMail({
      from: `"CIM Amplify" <${process.env.EMAIL_USER}>`,
      to,
      subject: 'Reset your password',
      html: `
        <p>Click below to reset your password:</p>
        <a href="${resetLink}" target="_blank">Reset Password</a>
        <p>This link will expire in 15 minutes.</p>
      `
    })
  }
}
