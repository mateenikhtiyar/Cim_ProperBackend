import { ApiProperty } from "@nestjs/swagger"
import { IsString, IsEnum, IsOptional } from "class-validator"
import { InteractionType } from "../schemas/deal-tracking.schema"

export class CreateDealTrackingDto {
  @ApiProperty({ description: "Deal ID", example: "60d21b4667d0d8992e610c85" })
  @IsString()
  dealId!: string

  @ApiProperty({ description: "Type of interaction", enum: InteractionType })
  @IsEnum(InteractionType)
  interactionType!: InteractionType

  @ApiProperty({ description: "Notes about the interaction", required: false })
  @IsString()
  @IsOptional()
  notes?: string

  @ApiProperty({ description: "Additional metadata", required: false })
  @IsOptional()
  metadata?: Record<string, any>
}
