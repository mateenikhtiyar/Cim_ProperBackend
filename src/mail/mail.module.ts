// src/mail/mail.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommunicationLog, CommunicationLogSchema } from './schemas/communication-log.schema';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CommunicationLog.name, schema: CommunicationLogSchema }]),
  ],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],  // make sure to export MailService for other modules
})
export class MailModule {}
