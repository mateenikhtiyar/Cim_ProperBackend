import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RejectDealDto {
    @ApiPropertyOptional({
        description: 'Optional notes for the rejection',
        example: 'Not interested in this deal at this time',
        maxLength: 500
    })
    @IsOptional()
    @IsString()
    @MaxLength(500, { message: 'Notes cannot be longer than 500 characters' })
    notes?: string;
}