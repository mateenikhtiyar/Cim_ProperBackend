import { ApiProperty } from "@nestjs/swagger"
import { IsString, IsArray, IsNumber, IsBoolean, IsOptional, ValidateNested, IsEmail, IsUrl } from "class-validator"
import { Type } from "class-transformer"

export class ContactDto {
  @ApiProperty({ example: "John Doe", description: "Name of the contact person" })
  @IsString()
  name: string

  @ApiProperty({ example: "john@example.com", description: "Email of the contact person" })
  @IsEmail()
  email: string

  @ApiProperty({ example: "+1234567890", description: "Phone number of the contact person" })
  @IsString()
  phone: string
}

export class PreferencesDto {
  @ApiProperty({ example: false, description: "Stop sending deals" })
  @IsBoolean()
  @IsOptional()
  stopSendingDeals?: boolean

  @ApiProperty({ example: false, description: "Don't show my deals" })
  @IsBoolean()
  @IsOptional()
  dontShowMyDeals?: boolean

  @ApiProperty({ example: false, description: "Don't send deals to my competitors" })
  @IsBoolean()
  @IsOptional()
  dontSendDealsToMyCompetitors?: boolean

  @ApiProperty({ example: true, description: "Allow buyer like deals" })
  @IsBoolean()
  @IsOptional()
  allowBuyerLikeDeals?: boolean
}

export class TargetCriteriaDto {
  @ApiProperty({ example: ["United States", "Nigeria"], description: "Target countries" })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  countries?: string[]

  @ApiProperty({ example: ["Coal", "Oil & Gas"], description: "Industry sectors" })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  industrySectors?: string[]

  @ApiProperty({ example: 5000000, description: "Revenue", nullable: true })
  @IsNumber()
  @IsOptional()
  revenue?: number

  @ApiProperty({ example: 200000, description: "Minimum EBITDA", nullable: true })
  @IsNumber()
  @IsOptional()
  ebitdaMin?: number

  @ApiProperty({ example: 2000000, description: "Maximum EBITDA", nullable: true })
  @IsNumber()
  @IsOptional()
  ebitdaMax?: number

  @ApiProperty({ example: 500000, description: "Minimum transaction size", nullable: true })
  @IsNumber()
  @IsOptional()
  transactionSizeMin?: number

  @ApiProperty({ example: 5000000, description: "Maximum transaction size", nullable: true })
  @IsNumber()
  @IsOptional()
  transactionSizeMax?: number

  @ApiProperty({ example: 51, description: "Minimum stake percentage", nullable: true })
  @IsNumber()
  @IsOptional()
  minStakePercent?: number

  @ApiProperty({ example: 3, description: "Minimum years in business", nullable: true })
  @IsNumber()
  @IsOptional()
  minYearsInBusiness?: number

  @ApiProperty({ example: ["Recurring Revenue", "Asset Light"], description: "Preferred business models" })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  preferredBusinessModels?: string[]

  @ApiProperty({ example: ["Owner(s) Departing", "Willing to Stay"], description: "Management team preference" })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  managementTeamPreference?: string[]

  @ApiProperty({
    example: "Looking for established businesses with stable cash flow",
    description: "Additional description",
    nullable: true,
  })
  @IsString()
  @IsOptional()
  description?: string
}

export class AgreementsDto {
  @ApiProperty({ example: true, description: "Terms and conditions accepted" })
  @IsBoolean()
  @IsOptional()
  termsAndConditionsAccepted?: boolean

  @ApiProperty({ example: true, description: "NDA accepted" })
  @IsBoolean()
  @IsOptional()
  ndaAccepted?: boolean

  @ApiProperty({ example: true, description: "Fee agreement accepted" })
  @IsBoolean()
  @IsOptional()
  feeAgreementAccepted?: boolean
}

export class CreateCompanyProfileDto {
  @ApiProperty({ example: "Acme Inc", description: "Company name" })
  @IsString()
  companyName: string

  @ApiProperty({ example: "https://acme.com", description: "Company website" })
  @IsUrl()
  website: string

  @ApiProperty({ type: [ContactDto], description: "Contact details" })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts: ContactDto[]

  @ApiProperty({ example: "Private Equity", description: "Company type" })
  @IsString()
  companyType: string

  @ApiProperty({ example: "Fund", description: "Capital entity" })
  @IsString()
  capitalEntity: string

  @ApiProperty({ example: 5, description: "Deals completed in last 5 years", nullable: true })
  @IsNumber()
  @IsOptional()
  dealsCompletedLast5Years?: number

  @ApiProperty({ example: 2000000, description: "Average deal size", nullable: true })
  @IsNumber()
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
}
