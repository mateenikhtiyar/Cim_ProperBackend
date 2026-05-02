import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type ActivityLogDocument = ActivityLog & Document;

@Schema({ timestamps: true })
export class ActivityLog {
  @Prop({ required: true })
  event!: string;

  @Prop({ required: false })
  userId?: string;

  @Prop({ required: false })
  email?: string;

  @Prop({ required: false })
  role?: string;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;
}

export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);
ActivityLogSchema.index({ event: 1, createdAt: -1 });
ActivityLogSchema.index({ userId: 1, createdAt: -1 });

