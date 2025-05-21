import { IsEmail, IsNotEmpty, MinLength, IsString } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class CreateAdminDto {
  @ApiProperty({ example: "Admin User", description: "Full name of the admin" })
  @IsNotEmpty()
  @IsString()
  fullName: string

  @ApiProperty({ example: "admin@example.com", description: "Email address of the admin" })
  @IsEmail()
  email: string

  @ApiProperty({ example: "password123", description: "Password with minimum length of 6 characters" })
  @IsNotEmpty()
  @MinLength(6)
  password: string
}
