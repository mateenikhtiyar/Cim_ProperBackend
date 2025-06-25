import { IsEmail, IsNotEmpty, IsOptional, MinLength, IsString } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"
import { Optional } from "@nestjs/common";

export class CreateBuyerDto {
  @ApiProperty({ example: "John Doe", description: "Full name of the buyer" })
  @IsNotEmpty()
  fullName: string

  @ApiProperty({ example: "john@example.com", description: "Email address of the buyer" })
  @IsEmail()
  email: string

  @IsOptional()
  @IsString()
  phone?: string;


  @ApiProperty({ example: "password123", description: "Password with minimum length of 6 characters" })
  @IsNotEmpty()
  @MinLength(6)
  password: string

  @ApiProperty({ example: "Acme Inc", description: "Company name of the buyer" })
  @IsOptional()
  companyName: string
}
