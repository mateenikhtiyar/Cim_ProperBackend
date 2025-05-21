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
      delete ret.password;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: (doc, ret) => {
      delete ret.password;
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

  @ApiProperty({ description: "Hashed password of the seller" })
  @Prop({ required: true })
  password!: string;

  @ApiProperty({ description: "Company name of the seller" })
  @Prop({ required: true })
  companyName!: string;

  @ApiProperty({ description: "Role of the user", default: "seller" })
  @Prop({ default: "seller" })
  role!: string;

  @ApiProperty({ description: "Profile picture path", nullable: true })
  @Prop({ default: null })
  profilePicture!: string;

  @ApiProperty({ description: "Whether the account was created using Google OAuth", default: false })
  @Prop({ default: false })
  isGoogleAccount!: boolean;

  @ApiProperty({ description: "Google ID for OAuth accounts", nullable: true })
  @Prop({ default: null })
  googleId!: string;

  // Add any additional fields needed

  // Ensure Mongoose methods are properly typed
  toObject?(): any;
}

export const SellerSchema = SchemaFactory.createForClass(Seller);