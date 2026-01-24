import { PartialType } from "@nestjs/swagger"
import { CreateBuyerDto } from "./create-buyer.dto"
import { IsOptional, IsString, IsEmail } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class UpdateBuyerDto extends PartialType(CreateBuyerDto) {
    @ApiProperty({ description: "Buyer ID (ignored in updates)", required: false })
    @IsOptional()
    @IsString()
    _id?: string

    @ApiProperty({ description: "Role (ignored in updates)", required: false })
    @IsOptional()
    @IsString()
    role?: string

    @ApiProperty({ example: "John Doe", description: "Full name of the buyer", required: false })
    @IsOptional()
    @IsString()
    fullName?: string

    @ApiProperty({ example: "john@example.com", description: "Email address of the buyer", required: false })
    @IsOptional()
    @IsEmail()
    email?: string

    @ApiProperty({ example: "Acme Inc", description: "Company name of the buyer", required: false })
    @IsOptional()
    @IsString()
    companyName?: string

    @ApiProperty({ example: "+44 7123 123456", description: "Phone number of the buyer", required: false })
    @IsOptional()
    @IsString()
    phone?: string

    @ApiProperty({ example: "+44 7123 123456", description: "Phone number of the buyer (alias for phone)", required: false })
    @IsOptional()
    @IsString()
    phoneNumber?: string

    @ApiProperty({ example: "https://acme.com", description: "Company website of the buyer", required: false })
    @IsOptional()
    @IsString()
    website?: string

    @ApiProperty({ example: "password123", description: "New password", required: false })
    @IsOptional()
    @IsString()
    password?: string

    @ApiProperty({
        example: "https://example.com/profile.jpg",
        description: "Profile picture URL or base64 encoded image",
        required: false
    })
    @IsOptional()
    @IsString()
    profilePicture?: string | null
}
