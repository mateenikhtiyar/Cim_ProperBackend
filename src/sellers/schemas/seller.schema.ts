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
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
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

  @ApiProperty({ description: "Reset token for password recovery", nullable: true })
  @Prop({ default: null })
  resetPasswordToken: string

  @ApiProperty({ description: "Token expiry timestamp", nullable: true })
  @Prop({ default: null })
  resetPasswordExpires: Date

  @ApiProperty({ description: "Management future preferences" })
  @Prop({ required: false, default: "" })
  managementPreferences!: string;

  @ApiProperty({ description: "Whether to hide deal guidelines modal", default: false })
  @Prop({ default: false })
  hideGuidelines: boolean

  @ApiProperty({ description: "How the user heard about CIM Amplify" })
  @Prop({ required: false, default: "" })
  referralSource: string

  @ApiProperty({ description: "Whether the seller opted in to receive SMS messages" })
  @Prop({ required: false })
  signUpForSms?: boolean

  @ApiProperty({
    description: "Seller email preferences",
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

  // Add any additional fields needed

  // Ensure Mongoose methods are properly typed
  toObject?(): any;
}

export const SellerSchema = SchemaFactory.createForClass(Seller);

SellerSchema.index({ companyName: 1 });
SellerSchema.index({ fullName: 1 });
SellerSchema.index({ phoneNumber: 1 });
SellerSchema.index({ createdAt: -1 });

SellerSchema.pre("save", function (next) {
  if (this.email) {
    this.email = this.email.toLowerCase().trim();
  }
  next();
});

SellerSchema.pre(["updateOne", "findOneAndUpdate"], function (next) {
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
