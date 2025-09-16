import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose"
import { Document, Types } from "mongoose"
import { ApiProperty } from "@nestjs/swagger"

export interface BuyerDocument extends Buyer, Document {
  _id: string
  createdAt: Date
  updatedAt: Date
  toObject(): any
}

@Schema({ timestamps: true })
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

  @ApiProperty({ description: "Role of the user", default: "buyer", enum: ["buyer"] })
  @Prop({ type: String, default: "buyer", enum: ["buyer"] })
  role: "buyer"

  @ApiProperty({ description: "Phone number of the buyer" })
  @Prop({ type: String, required: true })
  phone: string

  @ApiProperty({ description: "Company name of the buyer" })
  @Prop({ type: String, required: true })
  companyName: string

  @ApiProperty({ example: "https://acme.com", description: "Company website of the buyer" })
  @Prop({ required: false })
  website?: string

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

  @ApiProperty({ description: "Whether the email is verified", default: false })
  @Prop({ default: false })
  isEmailVerified: boolean

  @ApiProperty({ description: "Number of profile completion reminders sent", default: 0 })
  @Prop({ default: 0 })
  profileCompletionReminderCount: number;

  @ApiProperty({ description: "Timestamp of the last profile completion reminder sent", nullable: true })
  @Prop({ default: null })
  lastProfileCompletionReminderSentAt: Date;

  // Ensure Mongoose methods are properly typed
  toObject?(): any
}

export const BuyerSchema = SchemaFactory.createForClass(Buyer)
