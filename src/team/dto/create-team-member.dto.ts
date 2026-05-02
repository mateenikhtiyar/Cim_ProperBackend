import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsEnum,
  IsArray,
  ArrayMinSize,
  IsOptional,
} from "class-validator"

export const SELLER_PERMISSIONS = [
  "dashboard",
  "create-deal",
  "edit-deal",
  "deal-history",
  "loi-deals",
  "view-profile",
  "emails",
] as const

export const BUYER_PERMISSIONS = [
  "dashboard",
  "marketplace",
  "deals",
  "company-profile",
  "emails",
] as const

export type SellerPermission = (typeof SELLER_PERMISSIONS)[number]
export type BuyerPermission = (typeof BUYER_PERMISSIONS)[number]

export class CreateTeamMemberDto {
  @ApiProperty({ description: "Full name of the team member" })
  @IsString()
  @IsNotEmpty()
  fullName: string

  @ApiProperty({ description: "Email address of the team member" })
  @IsEmail()
  @IsNotEmpty()
  email: string

  @ApiPropertyOptional({ description: "Profile picture (file upload)" })
  @IsOptional()
  @IsString()
  profilePicture?: string

  @ApiProperty({
    description: "Owner type",
    enum: ["seller", "buyer"],
  })
  @IsEnum(["seller", "buyer"])
  @IsNotEmpty()
  ownerType: "seller" | "buyer"

  @ApiProperty({
    description: "Page-level permissions to grant",
    example: ["dashboard", "create-deal"],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  permissions: string[]

  @ApiPropertyOptional({ description: "Owner ID (required for admin-created members)" })
  @IsOptional()
  @IsString()
  ownerId?: string
}
