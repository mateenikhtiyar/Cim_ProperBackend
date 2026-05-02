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
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
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

  @ApiProperty({ description: "Reset token for password recovery", nullable: true })
  @Prop({ default: null })
  resetPasswordToken: string

  @ApiProperty({ description: "Token expiry timestamp", nullable: true })
  @Prop({ default: null })
  resetPasswordExpires: Date

  @ApiProperty({ description: "Number of profile completion reminders sent", default: 0 })
  @Prop({ default: 0 })
  profileCompletionReminderCount: number;

  @ApiProperty({ description: "Timestamp of the last profile completion reminder sent", nullable: true })
  @Prop({ default: null })
  lastProfileCompletionReminderSentAt: Date;

  @ApiProperty({ description: "How the user heard about CIM Amplify" })
  @Prop({ required: false, default: "" })
  referralSource: string

  @ApiProperty({ description: "Whether the buyer opted in to receive SMS messages" })
  @Prop({ required: false })
  signUpForSms?: boolean

  @ApiProperty({
    description: "Buyer email preferences",
    default: {
      receiveDealEmails: true,
    },
  })
  @Prop({
    type: {
      receiveDealEmails: { type: Boolean, default: true },
    },
    default: {
      receiveDealEmails: true,
    },
  })
  preferences: {
    receiveDealEmails: boolean
  }

  // Denormalized deal counts for performance
  @ApiProperty({ description: "Number of active deals", default: 0 })
  @Prop({ default: 0 })
  activeDealsCount: number

  @ApiProperty({ description: "Number of pending deals", default: 0 })
  @Prop({ default: 0 })
  pendingDealsCount: number

  @ApiProperty({ description: "Number of rejected deals", default: 0 })
  @Prop({ default: 0 })
  rejectedDealsCount: number

  // Ensure Mongoose methods are properly typed
  toObject?(): any
}

export const BuyerSchema = SchemaFactory.createForClass(Buyer)

BuyerSchema.index({ companyName: 1 });
BuyerSchema.index({ fullName: 1 });
BuyerSchema.index({ phone: 1 });
BuyerSchema.index({ createdAt: -1 });

BuyerSchema.pre("save", function (next) {
  if (this.email) {
    this.email = this.email.toLowerCase().trim();
  }
  next();
});

BuyerSchema.pre(["updateOne", "findOneAndUpdate"], function (next) {
  const update = this.getUpdate() as Record<string, any> | undefined;
  const normalize = (target: Record<string, any>) => {
    if (typeof target.email === "string") {
      target.email = target.email.toLowerCase().trim();
    }
  };

  if (update) {
    normalize(update);
    if (update.$set && typeof update.$set === "object") {
      normalize(update.$set);
    }
  }

  next();
});
