import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose"
import { Document } from "mongoose"

export type DealActionTokenDocument = DealActionToken & Document

@Schema({ timestamps: true })
export class DealActionToken {
  @Prop({ required: true, unique: true, index: true })
  token: string

  /** HMAC-SHA256 signature of the token using JWT_SECRET, for tamper verification */
  @Prop({ required: true })
  signature: string

  @Prop({ required: true, index: true })
  dealId: string

  @Prop({ type: String, default: null, index: true })
  buyerId: string | null

  @Prop({ type: String, default: null, index: true })
  sellerId: string | null

  @Prop({ type: String, default: 'buyer' })
  recipientRole: 'buyer' | 'seller'

  @Prop({ default: false })
  used: boolean

  @Prop({ type: String, default: null })
  actionTaken: 'active' | 'rejected' | 'loi' | 'completed' | 'flag-inactive' | null

  @Prop({ type: Date, default: null })
  usedAt: Date | null

  @Prop({ type: String, default: null })
  usedFromIp: string | null

  @Prop({ type: String, default: null })
  usedUserAgent: string | null

  @Prop({
    required: true,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    index: { expireAfterSeconds: 0 },
  })
  expiresAt: Date
}

export const DealActionTokenSchema = SchemaFactory.createForClass(DealActionToken)
