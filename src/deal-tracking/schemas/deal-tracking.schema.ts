import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose"
import { type Document, Schema as MongooseSchema } from "mongoose"
import { ApiProperty } from "@nestjs/swagger"

export type DealTrackingDocument = DealTracking & Document

export enum InteractionType {
  VIEW = "view",
  INTEREST = "interest",
  CONTACT = "contact",
  MEETING = "meeting",
  OFFER = "offer",
  NEGOTIATION = "negotiation",
  DUE_DILIGENCE = "due_diligence",
  COMPLETED = "completed",
  REJECTED = "rejected",
}

@Schema({ timestamps: true })
export class DealTracking {
  @ApiProperty({ description: "Reference to the deal" })
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "Deal", required: true })
  deal!: string

  @ApiProperty({ description: "Reference to the buyer" })
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: "Buyer",
    required: function (this: any) {
      // Make buyer field optional for 'completed' interaction type
      return this.interactionType !== "completed"
    },
  })
  buyer!: string

  @ApiProperty({ description: "Type of interaction", enum: InteractionType })
  @Prop({ required: true, enum: InteractionType })
  interactionType!: InteractionType

  @ApiProperty({ description: "Notes about the interaction" })
  @Prop({ required: false })
  notes?: string

  @ApiProperty({ description: "Date of the interaction" })
  @Prop({ default: Date.now })
  timestamp!: Date

  @ApiProperty({ description: "Additional metadata about the interaction" })
  @Prop({ type: Object, default: {} })
  metadata!: Record<string, any>
}

export const DealTrackingSchema = SchemaFactory.createForClass(DealTracking)

// Add indexes for better query performance
DealTrackingSchema.index({ deal: 1, buyer: 1 })
DealTrackingSchema.index({ deal: 1, interactionType: 1 })
DealTrackingSchema.index({ buyer: 1, interactionType: 1 })
