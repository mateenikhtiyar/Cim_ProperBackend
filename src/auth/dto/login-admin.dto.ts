import { IsEmail, IsNotEmpty } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class LoginAdminDto {
  @ApiProperty({ example: "admin@example.com", description: "Email address of the admin" })
  @IsEmail()
  email: string

  @ApiProperty({ example: "password123", description: "Password of the admin" })
  @IsNotEmpty()
  password: string

  @ApiProperty({ example: "admin", description: "Type of user", default: "admin" })
  @IsNotEmpty()
  userType = "admin"
}
