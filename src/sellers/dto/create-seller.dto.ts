import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from "class-validator";

const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/;

export class RegisterSellerDto {
  @ApiProperty({ example: "john@example.com", description: "Email address" })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: "John Doe", description: "Full name" })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: "StrongPassword123!", description: "Password must be at least 8 characters and include uppercase, lowercase, number, and special character" })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(STRONG_PASSWORD_REGEX, {
    message: "Password must include uppercase, lowercase, number, and special character",
  })
  password: string;

  @ApiProperty({ example: "Acme Inc", description: "Company name" })
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @ApiProperty({ example: "CEO", description: "Title of the seller" })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: "+1234567890", description: "Phone number of the seller" })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ example: "https://example.com", description: "Website of the seller/company" })
  @IsString()
  @IsNotEmpty()
  website: string;

  @ApiProperty({ example: "Retiring to divesting", description: "Management future preferences" })
  @IsString()
  @IsOptional()
  managementPreferences?: string;

  @ApiProperty({ example: "LinkedIn", description: "How the user heard about CIM Amplify" })
  @IsString()
  @IsOptional()
  referralSource?: string;

  @ApiProperty({ example: true, description: "Whether the seller opted in to receive SMS messages" })
  @IsBoolean()
  @IsOptional()
  signUpForSms?: boolean;
}

