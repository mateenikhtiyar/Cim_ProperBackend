import { IsEmail, IsNotEmpty, MinLength, IsString, Matches } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/

export class CreateAdminDto {
  @ApiProperty({ example: "Admin User", description: "Full name of the admin" })
  @IsNotEmpty()
  @IsString()
  fullName: string

  @ApiProperty({ example: "admin@example.com", description: "Email address of the admin" })
  @IsEmail()
  email: string

  @ApiProperty({ example: "StrongPass123!", description: "Password must be at least 8 characters and include uppercase, lowercase, number, and special character" })
  @IsNotEmpty()
  @MinLength(8)
  @Matches(STRONG_PASSWORD_REGEX, {
    message: "Password must include uppercase, lowercase, number, and special character",
  })
  password: string


}

