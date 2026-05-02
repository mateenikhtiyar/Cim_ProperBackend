import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose"
import { Document } from "mongoose"
import { ApiProperty } from "@nestjs/swagger"

export interface AdminDocument extends Admin, Document {
  _id: string
  toObject(): any
}

@Schema()
export class Admin {
  @ApiProperty({ description: "Full name of the admin" })
  @Prop({ required: true })
  fullName: string

  @ApiProperty({ description: "Email address of the admin" })
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string

  @ApiProperty({ description: "Hashed password of the admin" })
  @Prop({ required: true })
  password: string

  @ApiProperty({ description: "Role of the user", default: "admin" })
  @Prop({ default: "admin" })
  role: string

  @ApiProperty({ description: "Profile picture URL or path", required: false })
  @Prop({ required: false })
  profilePicture?: string;

  

  // Ensure Mongoose methods are properly typed
  toObject?(): any
}

export const AdminSchema = SchemaFactory.createForClass(Admin)

AdminSchema.pre("save", function (next) {
  if (this.email) {
    this.email = this.email.toLowerCase().trim();
  }
  next();
});

AdminSchema.pre(["updateOne", "findOneAndUpdate"], function (next) {
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
