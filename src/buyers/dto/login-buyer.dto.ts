import { IsEmail, IsNotEmpty } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class LoginBuyerDto {
  @ApiProperty({ example: "john@example.com", description: "Email address of the buyer" })
  @IsEmail()
  email: string

  @ApiProperty({ example: "password123", description: "Password of the buyer" })
  @IsNotEmpty()
  password: string
}
