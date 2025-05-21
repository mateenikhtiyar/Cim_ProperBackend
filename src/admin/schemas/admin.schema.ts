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
  @Prop({ required: true, unique: true })
  email: string

  @ApiProperty({ description: "Hashed password of the admin" })
  @Prop({ required: true })
  password: string

  @ApiProperty({ description: "Role of the user", default: "admin" })
  @Prop({ default: "admin" })
  role: string

  // Ensure Mongoose methods are properly typed
  toObject?(): any
}

export const AdminSchema = SchemaFactory.createForClass(Admin)
