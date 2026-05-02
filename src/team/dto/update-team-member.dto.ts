import { ApiPropertyOptional } from "@nestjs/swagger"
import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
} from "class-validator"

export class UpdateTeamMemberDto {
  @ApiPropertyOptional({ description: "Full name of the team member" })
  @IsOptional()
  @IsString()
  fullName?: string

  @ApiPropertyOptional({ description: "Profile picture path" })
  @IsOptional()
  @IsString()
  profilePicture?: string

  @ApiPropertyOptional({
    description: "Page-level permissions",
    example: ["dashboard", "create-deal"],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[]

  @ApiPropertyOptional({ description: "Whether the member account is active" })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class UpdateMemberProfileDto {
  @ApiPropertyOptional({ description: "Full name" })
  @IsOptional()
  @IsString()
  fullName?: string

  @ApiPropertyOptional({ description: "Profile picture path" })
  @IsOptional()
  @IsString()
  profilePicture?: string
}

export class ChangeMemberPasswordDto {
  @ApiPropertyOptional({ description: "Current password (required unless changing from temporary)" })
  @IsOptional()
  @IsString()
  currentPassword?: string

  @IsString()
  newPassword: string
}
