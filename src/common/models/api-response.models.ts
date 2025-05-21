// src/common/models/api-response.models.ts
import { ApiProperty } from "@nestjs/swagger"

export class UserResponseDto {
  @ApiProperty({ example: "60d21b4667d0d8992e610c85" })
  id: string

  @ApiProperty({ example: "john@example.com" })
  email: string

  @ApiProperty({ example: "John Doe" })
  fullName: string

  @ApiProperty({ example: "Acme Inc" })
  companyName: string

  @ApiProperty({ example: "/uploads/profile-pictures/60d21b4667d0d8992e610c85.jpg", nullable: true })
  profilePicture: string

  @ApiProperty({ example: "buyer" })
  role: string
}

export class LoginResponseDto {
  @ApiProperty({ example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." })
  access_token: string

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto
}
