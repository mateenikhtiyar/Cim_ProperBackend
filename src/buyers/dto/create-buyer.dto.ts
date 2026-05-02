import { IsEmail, IsNotEmpty, MinLength, IsString, IsOptional, Matches, IsBoolean } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/

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

  @ApiProperty({ example: "StrongPass123!", description: "Password must be at least 8 characters and include uppercase, lowercase, number, and special character" })
  @IsNotEmpty()
  @MinLength(8)
  @Matches(STRONG_PASSWORD_REGEX, {
    message: "Password must include uppercase, lowercase, number, and special character",
  })
  password: string

  @ApiProperty({ example: "Acme Inc", description: "Company name of the buyer" })
  @IsNotEmpty()
  companyName: string

  @ApiProperty({ example: "https://acme.com", description: "Company website of the buyer" })
  @IsNotEmpty()
  @IsString()
  website: string

  @ApiProperty({ example: "LinkedIn", description: "How the user heard about CIM Amplify" })
  @IsString()
  @IsOptional()
  referralSource?: string

  @ApiProperty({ example: true, description: "Whether the buyer opted in to receive SMS messages" })
  @IsBoolean()
  @IsOptional()
  signUpForSms?: boolean

  @ApiProperty({
    description: "Buyer email preferences",
    required: false,
    example: { receiveDealEmails: true },
  })
  @IsOptional()
  preferences?: {
    receiveDealEmails?: boolean
  }
}

