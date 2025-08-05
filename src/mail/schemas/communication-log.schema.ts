import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CommunicationLogDocument = CommunicationLog & Document;

@Schema({ timestamps: true })
export class CommunicationLog {
  @Prop({ required: true })
  recipientEmail: string;

  @Prop({ required: true })
  recipientType: 'buyer' | 'seller' | 'admin' | 'other';

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  body: string;

  @Prop({ default: new Date() })
  sentAt: Date;

  @Prop({ required: true, enum: ['email', 'sms'] })
  communicationType: 'email' | 'sms';

  @Prop({ required: true, enum: ['sent', 'failed'] })
  status: 'sent' | 'failed';

  @Prop()
  relatedDealId?: string; // Optional - deal reference
}

export const CommunicationLogSchema = SchemaFactory.createForClass(CommunicationLog);
