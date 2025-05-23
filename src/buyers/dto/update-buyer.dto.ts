import { PartialType } from "@nestjs/swagger"
import { CreateBuyerDto } from "./create-buyer.dto"
import { IsOptional, IsString } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class UpdateBuyerDto extends PartialType(CreateBuyerDto) {
    @ApiProperty({ example: "John Doe", description: "Full name of the buyer", required: false })
    @IsOptional()
    @IsString()
    fullName?: string

    @ApiProperty({ example: "Acme Inc", description: "Company name of the buyer", required: false })
    @IsOptional()
    @IsString()
    companyName?: string

    @ApiProperty({ example: "password123", description: "New password", required: false })
    @IsOptional()
    @IsString()
    password?: string
}
