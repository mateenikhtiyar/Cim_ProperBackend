import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class GoogleSellerDto {
  @ApiProperty({ example: "john@example.com", description: "Email address from Google" })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: "John Doe", description: "Full name from Google" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: "https://lh3.googleusercontent.com/...", description: "Profile picture URL from Google" })
  @IsString()
  @IsOptional()
  picture?: string;

  @ApiProperty({ example: "123456789", description: "Google user ID" })
  @IsString()
  @IsNotEmpty()
  sub: string;

  @ApiProperty({ example: "Acme Inc", description: "Company name (to be provided after OAuth)" })
  @IsString()
  @IsOptional()
  companyName?: string;
}

export class RegisterSellerDto {
  @ApiProperty({ example: "john@example.com", description: "Email address" })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: "John Doe", description: "Full name" })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: "StrongPassword123", description: "Password" })
  @IsString()
  @IsNotEmpty()
  password: string;

  @ApiProperty({ example: "Acme Inc", description: "Company name" })
  @IsString()
  @IsNotEmpty()
  companyName: string;
}