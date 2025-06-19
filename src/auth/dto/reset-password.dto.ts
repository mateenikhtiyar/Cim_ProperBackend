import {
  IsString,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

@ValidatorConstraint({ name: 'MatchPasswords', async: false })
export class MatchPasswords implements ValidatorConstraintInterface {
  validate(confirmPassword: string, args: ValidationArguments) {
    const dto = args.object as any
    return dto.newPassword === confirmPassword
  }

  defaultMessage(args: ValidationArguments) {
    return 'Confirm password must match new password'
  }
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Reset token received via email' })
  @IsString()
  token: string

  @ApiProperty({ description: 'New password', minLength: 8 })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  newPassword: string

  @ApiProperty({ description: 'Confirm new password', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Confirm password must also be at least 8 characters' })
  @Validate(MatchPasswords)
  confirmPassword: string
}
