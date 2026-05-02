import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type EmailQueueDocument = EmailQueue & Document;

@Schema({ timestamps: true })
export class EmailQueue {
  @Prop({ required: true, lowercase: true, trim: true })
  recipientEmail!: string;

  @Prop({ required: true })
  recipientType!: string;

  @Prop({ required: true })
  subject!: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ type: Array, default: [] })
  attachments!: any[];

  @Prop()
  relatedDealId?: string;

  @Prop({ default: 0 })
  attempts!: number;

  @Prop({ default: 5 })
  maxAttempts!: number;

  @Prop({ type: Date, default: () => new Date() })
  nextRetryAt!: Date;

  @Prop({ type: String, default: null })
  lastError!: string | null;

  @Prop({ enum: ["pending", "sent", "dead"], default: "pending" })
  status!: "pending" | "sent" | "dead";
}

export const EmailQueueSchema = SchemaFactory.createForClass(EmailQueue);
EmailQueueSchema.index({ status: 1, nextRetryAt: 1 });

