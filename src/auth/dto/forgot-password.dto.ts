// src/buyer-auth/dto/forgot-password.dto.ts
import { IsEmail } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class ForgotPasswordDto {
  @ApiProperty({ description: "Registered email address of the buyer" })
  @IsEmail()
  email: string
}
