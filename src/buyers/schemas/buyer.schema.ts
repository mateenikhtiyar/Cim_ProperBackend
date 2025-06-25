import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose"
import { Document, Types } from "mongoose"
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

  @ApiProperty({ description: "Role of the user", default: "buyer" })
  @Prop({ default: "buyer" })
  role: string


  @ApiProperty({ description: "Phone number of the buyer", nullable: true })
  @Prop({ type: String, required: false, default: null })
  phone: string

  @ApiProperty({ description: "Phone number of the buyer", nullable: true })
  @Prop({ type: String, required: false, default: null })
  companyName: string

  @ApiProperty({ description: "Reference to the company profile", nullable: true })
  @Prop({ type: Types.ObjectId, ref: "CompanyProfile", default: null })
  companyProfileId: Types.ObjectId

  @ApiProperty({ description: "Profile picture path", nullable: true })
  @Prop({ default: null })
  profilePicture: string

  @ApiProperty({ description: "Whether the account was created using Google OAuth", default: false })
  @Prop({ default: false })
  isGoogleAccount: boolean

  @ApiProperty({ description: "Google ID for OAuth accounts", nullable: true })
  @Prop({ default: null })
  googleId: string

  @ApiProperty({ description: "Reset token for password recovery", nullable: true })
  @Prop({ default: null })
  resetPasswordToken: string

  @ApiProperty({ description: "Token expiry timestamp", nullable: true })
  @Prop({ default: null })
  resetPasswordExpires: Date

  // Ensure Mongoose methods are properly typed
  toObject?(): any
}

export const BuyerSchema = SchemaFactory.createForClass(Buyer)
