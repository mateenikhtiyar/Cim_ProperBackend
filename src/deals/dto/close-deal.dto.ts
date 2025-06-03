import { ApiProperty } from "@nestjs/swagger"
import { IsNumber, IsOptional, IsString, IsMongoId, ValidateIf } from "class-validator"

export class CloseDealDto {
    @ApiProperty({
        description: "Final sale price of the deal",
        example: 4800000,
        required: false,
    })
    @IsNumber()
    @IsOptional()
    finalSalePrice?: number

    @ApiProperty({
        description: "Notes about the deal closure",
        example: "Deal completed successfully with buyer XYZ",
        required: false,
    })
    @IsString()
    @IsOptional()
    notes?: string

    @ApiProperty({
        description: "ID of the buyer who won the deal (must be a valid MongoDB ObjectId)",
        example: "60d21b4667d0d8992e610c85",
        required: false,
    })
    @ValidateIf((o) => o.winningBuyerId !== undefined && o.winningBuyerId !== null && o.winningBuyerId !== "")
    @IsMongoId({ message: "If provided, winningBuyerId must be a valid MongoDB ObjectId" })
    @IsOptional()
    winningBuyerId?: string
}
