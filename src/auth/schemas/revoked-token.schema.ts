import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type RevokedTokenDocument = RevokedToken & Document;

@Schema({ timestamps: true })
export class RevokedToken {
  @Prop({ required: true, unique: true, index: true })
  jti!: string;

  @Prop({ required: true, enum: ["access", "refresh"] })
  tokenType!: "access" | "refresh";

  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  expiresAt!: Date;
}

export const RevokedTokenSchema = SchemaFactory.createForClass(RevokedToken);
RevokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

