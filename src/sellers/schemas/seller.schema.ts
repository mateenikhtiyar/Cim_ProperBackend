import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";
import { ApiProperty } from "@nestjs/swagger";

export interface SellerDocument extends Seller, Document {
  _id: string;
  toObject(): any;
}

@Schema({
  timestamps: true, // Add createdAt and updatedAt fields
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      if ('password' in ret) {
        delete ret.password;
      }
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: (doc, ret) => {
      if ('password' in ret) {
        delete ret.password;
      }
      return ret;
    }
  }
})
export class Seller {
  @ApiProperty({ description: "Full name of the seller" })
  @Prop({ required: true })
  fullName!: string;

  @ApiProperty({ description: "Email address of the seller" })
  @Prop({ required: true, unique: true })
  email!: string;

  @ApiProperty({ description: "Company website" })
  @Prop({ required: true })
  website: string

  @ApiProperty({ description: "Hashed password of the seller" })
  @Prop({ required: true })
  password!: string;

  @ApiProperty({ description: "Title of the seller" })
  @Prop({ required: true })
  title!: string;

  @ApiProperty({ description: "Company name of the seller" })
  @Prop({ required: true })
  companyName!: string;

  @ApiProperty({ description: "Role of the user", default: "seller", enum: ["seller"] })
  @Prop({ type: String, default: "seller", enum: ["seller"] })
  role: "seller"

  @ApiProperty({ description: "Profile picture path", nullable: true })
  @Prop({ default: null })
  profilePicture!: string;

  @ApiProperty({ description: "Phone number of the seller" })
  @Prop({ required: true })
  phoneNumber!: string;

  @ApiProperty({ description: "Whether the account was created using Google OAuth", default: false })
  @Prop({ default: false })
  isGoogleAccount!: boolean;

  @ApiProperty({ description: "Google ID for OAuth accounts", nullable: true })
  @Prop({ default: null })
  googleId!: string;

  @ApiProperty({ description: "Reset token for password recovery", nullable: true })
  @Prop({ default: null })
  resetPasswordToken: string

  @ApiProperty({ description: "Token expiry timestamp", nullable: true })
  @Prop({ default: null })
  resetPasswordExpires: Date

  @ApiProperty({ description: "Management future preferences" })
  @Prop({ required: false, default: "" })
  managementPreferences!: string;

  @ApiProperty({ description: "Whether the email is verified", default: false })
  @Prop({ default: false })
  isEmailVerified: boolean

  @ApiProperty({ description: "Whether to hide deal guidelines modal", default: false })
  @Prop({ default: false })
  hideGuidelines: boolean

  // Add any additional fields needed

  // Ensure Mongoose methods are properly typed
  toObject?(): any;
}

export const SellerSchema = SchemaFactory.createForClass(Seller);