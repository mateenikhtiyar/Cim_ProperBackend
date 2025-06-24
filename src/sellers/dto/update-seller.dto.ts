import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, IsUrl, MinLength } from "class-validator";

export class UpdateSellerDto {
  @ApiPropertyOptional({
    example: "John Doe",
    description: "Full name of the seller"
  })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({
    example: "john@example.com",
    description: "Email address of the seller"
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: "Acme Inc",
    description: "Company name of the seller"
  })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({
    example: "+1234567890",
    description: "Phone number of the seller"
  })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @ApiPropertyOptional({
    example: "newPassword123",
    description: "New password (minimum 6 characters)",
    minLength: 6
  })
  @IsOptional()
  @IsString()
  @MinLength(6, { message: "Password must be at least 6 characters long" })
  password?: string;
  
  @ApiPropertyOptional({
    example: "CEO",
    description: "Title of the seller"
  })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({
    example: "https://www.acmeinc.com",
    description: "Company website URL"
  })
  @IsOptional()
  @IsUrl({}, { message: "Website must be a valid URL" })
  website?: string;

}