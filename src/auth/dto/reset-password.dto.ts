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

  @ApiProperty({ description: 'New password'})
  @IsString()
  newPassword: string

  @ApiProperty({ description: 'Confirm new password' })
  @IsString()
  @Validate(MatchPasswords)
  confirmPassword: string
}
