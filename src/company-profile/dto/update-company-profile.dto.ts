import { ApiProperty } from "@nestjs/swagger"
import { IsString, IsArray, IsOptional, ValidateNested, IsUrl } from "class-validator"
import { Type } from "class-transformer"
import { ContactDto, PreferencesDto, TargetCriteriaDto, AgreementsDto } from "./create-company-profile.dto"

export class UpdateCompanyProfileDto {
  @ApiProperty({ example: "Acme Inc", description: "Company name" })
  @IsString()
  @IsOptional()
  companyName?: string

  @ApiProperty({ example: "https://acme.com", description: "Company website" })
  @IsUrl()
  @IsOptional()
  website?: string

  @ApiProperty({ type: [ContactDto], description: "Contact details" })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  @IsOptional()
  contacts?: ContactDto[]

  @ApiProperty({ example: "Private Equity", description: "Company type" })
  @IsString()
  @IsOptional()
  companyType?: string

  @ApiProperty({ example: "Fund", description: "Capital entity" })
  @IsString()
  @IsOptional()
  capitalEntity?: string

  @ApiProperty({ example: 5, description: "Deals completed in last 5 years", nullable: true })
  @IsOptional()
  dealsCompletedLast5Years?: number

  @ApiProperty({ example: 2000000, description: "Average deal size", nullable: true })
  @IsOptional()
  averageDealSize?: number

  @ApiProperty({ type: PreferencesDto, description: "Preferences" })
  @ValidateNested()
  @Type(() => PreferencesDto)
  @IsOptional()
  preferences?: PreferencesDto

  @ApiProperty({ type: TargetCriteriaDto, description: "Target criteria" })
  @ValidateNested()
  @Type(() => TargetCriteriaDto)
  @IsOptional()
  targetCriteria?: TargetCriteriaDto

  @ApiProperty({ type: AgreementsDto, description: "Agreements" })
  @ValidateNested()
  @Type(() => AgreementsDto)
  @IsOptional()
  agreements?: AgreementsDto

  @ApiProperty({ example: "USD", description: "Selected currency" })
  @IsString()
  @IsOptional()
  selectedCurrency?: string

  @ApiProperty({ example: "ready_to_deploy", description: "Capital availability" })
  @IsString()
  @IsOptional()
  capitalAvailability?: string
}
