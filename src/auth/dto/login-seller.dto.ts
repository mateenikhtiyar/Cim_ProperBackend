import { IsEmail, IsNotEmpty } from "class-validator"
import { ApiProperty } from "@nestjs/swagger"

export class LoginSellerDto {
  @ApiProperty({ example: "seller@example.com", description: "Email address of the seller" })
  @IsEmail()
  email: string

  @ApiProperty({ example: "password123", description: "Password of the seller" })
  @IsNotEmpty()
  password: string

  @ApiProperty({ example: "seller", description: "Type of user", default: "seller" })
  @IsNotEmpty()
  userType = "seller"
}
