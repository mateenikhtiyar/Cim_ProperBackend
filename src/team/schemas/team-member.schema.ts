import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose"
import { Document, Types } from "mongoose"
import { ApiProperty } from "@nestjs/swagger"

export interface TeamMemberDocument extends TeamMember, Document {
  _id: string
  createdAt: Date
  updatedAt: Date
  toObject(): any
}

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      if ("password" in ret) {
        delete ret.password
      }
      return ret
    },
  },
  toObject: {
    virtuals: true,
    transform: (doc, ret) => {
      if ("password" in ret) {
        delete ret.password
      }
      return ret
    },
  },
})
export class TeamMember {
  @ApiProperty({ description: "Full name of the team member" })
  @Prop({ required: true })
  fullName: string

  @ApiProperty({ description: "Email address of the team member" })
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string

  @ApiProperty({ description: "Hashed password of the team member" })
  @Prop({ required: true })
  password: string

  @ApiProperty({ description: "Profile picture path", nullable: true })
  @Prop({ default: null })
  profilePicture: string

  @ApiProperty({ description: "Owner user ID (the main seller or buyer)" })
  @Prop({ type: Types.ObjectId, required: true })
  ownerId: Types.ObjectId

  @ApiProperty({ description: "Owner type", enum: ["seller", "buyer"] })
  @Prop({ type: String, required: true, enum: ["seller", "buyer"] })
  ownerType: "seller" | "buyer"

  @ApiProperty({ description: "Role of the team member" })
  @Prop({
    type: String,
    required: true,
    enum: ["seller-member", "buyer-member"],
  })
  role: "seller-member" | "buyer-member"

  @ApiProperty({
    description: "Page-level permissions",
    example: ["dashboard", "create-deal"],
  })
  @Prop({ type: [String], required: true, default: [] })
  permissions: string[]

  @ApiProperty({ description: "Whether the member still has a temporary password" })
  @Prop({ default: true })
  isTemporaryPassword: boolean

  @ApiProperty({ description: "Whether the member account is active" })
  @Prop({ default: true })
  isActive: boolean

  @ApiProperty({ description: "Who invited this member (owner or admin ID)" })
  @Prop({ type: Types.ObjectId, default: null })
  invitedBy: Types.ObjectId

  @ApiProperty({ description: "Reset token for password recovery", nullable: true })
  @Prop({ default: null })
  resetPasswordToken: string

  @ApiProperty({ description: "Token expiry timestamp", nullable: true })
  @Prop({ default: null })
  resetPasswordExpires: Date

  toObject?(): any
}

export const TeamMemberSchema = SchemaFactory.createForClass(TeamMember)

TeamMemberSchema.index({ ownerId: 1, ownerType: 1 })
TeamMemberSchema.index({ email: 1 }, { unique: true })
TeamMemberSchema.index({ isActive: 1 })

TeamMemberSchema.pre("save", function (next) {
  if (this.email) {
    this.email = this.email.toLowerCase().trim()
  }
  next()
})

TeamMemberSchema.pre(["updateOne", "findOneAndUpdate"], function (next) {
  const update = this.getUpdate() as Record<string, any> | undefined
  const normalize = (target: Record<string, any>) => {
    if (typeof target.email === "string") {
      target.email = target.email.toLowerCase().trim()
    }
  }

  if (update) {
    normalize(update)
    if (update.$set && typeof update.$set === "object") {
      normalize(update.$set)
    }
  }

  next()
})
