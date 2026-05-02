import {
  IsString,
  MinLength,
  Matches,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).+$/

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

  @ApiProperty({ description: 'New password (min 8 chars, upper/lower/number/special)' })
  @IsString()
  @MinLength(8)
  @Matches(STRONG_PASSWORD_REGEX, {
    message: 'Password must include uppercase, lowercase, number, and special character',
  })
  newPassword: string

  @ApiProperty({ description: 'Confirm new password' })
  @IsString()
  @MinLength(8)
  @Matches(STRONG_PASSWORD_REGEX, {
    message: 'Password must include uppercase, lowercase, number, and special character',
  })
  @Validate(MatchPasswords)
  confirmPassword: string
}

