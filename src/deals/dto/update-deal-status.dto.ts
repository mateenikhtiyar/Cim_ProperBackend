import { ApiProperty } from "@nestjs/swagger"
import { IsEnum, IsOptional } from "class-validator"

export enum DealStatusFilter {
    PENDING = "pending",
    ACTIVE = "active",
    REJECTED = "rejected",
    COMPLETED = "completed",
}

export class DealStatusFilterDto {
    @ApiProperty({
        description: "Filter deals by status",
        enum: DealStatusFilter,
        required: false,
    })
    @IsEnum(DealStatusFilter)
    @IsOptional()
    status?: DealStatusFilter
}
