import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose"
import { Document } from "mongoose"
import { ApiProperty } from "@nestjs/swagger"

export interface BuyerDocument extends Buyer, Document {
  _id: string
  toObject(): any
}

@Schema()
export class Buyer {
  @ApiProperty({ description: "Full name of the buyer" })
  @Prop({ required: true })
  fullName: string

  @ApiProperty({ description: "Email address of the buyer" })
  @Prop({ required: true, unique: true })
  email: string

  @ApiProperty({ description: "Hashed password of the buyer" })
  @Prop({ required: true })
  password: string

  @ApiProperty({ description: "Company name of the buyer" })
  @Prop({ required: true })
  companyName: string

  @ApiProperty({ description: "Role of the user", default: "buyer" })
  @Prop({ default: "buyer" })
  role: string

  @ApiProperty({ description: "Profile picture path", nullable: true })
  @Prop({ default: null })
  profilePicture: string

  @ApiProperty({ description: "Whether the account was created using Google OAuth", default: false })
  @Prop({ default: false })
  isGoogleAccount: boolean

  @ApiProperty({ description: "Google ID for OAuth accounts", nullable: true })
  @Prop({ default: null })
  googleId: string

  // Ensure Mongoose methods are properly typed
  toObject?(): any
}

export const BuyerSchema = SchemaFactory.createForClass(Buyer)
