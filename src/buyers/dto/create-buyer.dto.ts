import { IsEmail, IsNotEmpty, MinLength, IsString } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class CreateBuyerDto {
  @ApiProperty({ example: "John Doe", description: "Full name of the buyer" })
  @IsNotEmpty()
  fullName: string

  @ApiProperty({ example: "john@example.com", description: "Email address of the buyer" })
  @IsEmail()
  @IsNotEmpty()
  email: string

  @ApiProperty({ example: "+44 7123 123456", description: "Phone number of the buyer" })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty({ example: "password123", description: "Password with minimum length of 6 characters" })
  @IsNotEmpty()
  @MinLength(6)
  password: string

  @ApiProperty({ example: "Acme Inc", description: "Company name of the buyer" })
  @IsNotEmpty()
  companyName: string

  @ApiProperty({ example: "https://acme.com", description: "Company website of the buyer" })
  @IsNotEmpty()
  @IsString()
  website: string
}
