import { ApiProperty } from "@nestjs/swagger"
import { IsString, IsEnum, IsArray, IsBoolean, IsOptional, IsNumber, ValidateNested, Min, Max } from "class-validator"
import { Type } from "class-transformer"
import { DealStatus, DealType, DealVisibility, CapitalAvailability } from "../schemas/deal.schema"
import { FinancialDetailsDto, BusinessModelDto, ManagementPreferencesDto, BuyerFitDto } from "./create-deal.dto"

export class UpdateBuyerFitDto {
  @ApiProperty({
    description: "Capital Availability options",
    enum: CapitalAvailability,
    isArray: true,
    example: ["Ready to deploy immediately", "Need to raise"],
    required: false,
  })
  @IsArray()
  @IsEnum(CapitalAvailability, { each: true })
  @IsOptional()
  capitalAvailability?: CapitalAvailability[]

  @ApiProperty({ description: "Minimum number of prior acquisitions", required: false })
  @IsNumber()
  @IsOptional()
  minPriorAcquisitions?: number

  @ApiProperty({ description: "Minimum transaction size ($)", required: false })
  @IsNumber()
  @IsOptional()
  minTransactionSize?: number
}

export class UpdateDealDto {
  @ApiProperty({ description: "Title of the deal", example: "SaaS Company Acquisition Opportunity", required: false })
  @IsString()
  @IsOptional()
  title?: string

  @ApiProperty({
    description: "Description of the company",
    example: "Established SaaS company with recurring revenue seeking acquisition.",
    required: false,
  })
  @IsString()
  @IsOptional()
  companyDescription?: string

  @ApiProperty({ description: "Type of company", example: "SaaS Company", required: false })
  @IsString()
  @IsOptional()
  companyType?: string

  @ApiProperty({ description: "Type of deal", enum: DealType, example: DealType.ACQUISITION, required: false })
  @IsEnum(DealType)
  @IsOptional()
  dealType?: DealType

  @ApiProperty({ description: "Status of the deal", enum: DealStatus, required: false })
  @IsEnum(DealStatus)
  @IsOptional()
  status?: DealStatus

  @ApiProperty({ description: "Deal visibility level", enum: DealVisibility, required: false })
  @IsEnum(DealVisibility)
  @IsOptional()
  visibility?: DealVisibility

  @ApiProperty({ description: "Industry sector of the company", example: "Technology", required: false })
  @IsString()
  @IsOptional()
  industrySector?: string

  @ApiProperty({ description: "Geographic location/country of the company", example: "United States", required: false })
  @IsString()
  @IsOptional()
  geographySelection?: string

  @ApiProperty({ description: "Years the company has been in business", example: 5, required: false })
  @IsNumber()
  @IsOptional()
  yearsInBusiness?: number

  @ApiProperty({ description: "Number of employees", example: 50, required: false })
  @IsNumber()
  @IsOptional()
  employeeCount?: number

  @ApiProperty({ description: "Financial details of the deal", type: FinancialDetailsDto, required: false })
  @ValidateNested()
  @Type(() => FinancialDetailsDto)
  @IsOptional()
  financialDetails?: FinancialDetailsDto

  @ApiProperty({ description: "Business model details", type: BusinessModelDto, required: false })
  @ValidateNested()
  @Type(() => BusinessModelDto)
  @IsOptional()
  businessModel?: BusinessModelDto

  @ApiProperty({ description: "Management preferences description", required: false })
  @IsString()
  @IsOptional()
  managementPreferences?: string

  @ApiProperty({ description: "Buyer fit details", type: UpdateBuyerFitDto, required: false })
  @ValidateNested()
  @Type(() => UpdateBuyerFitDto)
  @IsOptional()
  buyerFit?: UpdateBuyerFitDto

  @ApiProperty({ description: "Targeted buyer IDs", type: [String], required: false })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetedBuyers?: string[]

  @ApiProperty({
    description: "Tags for categorizing the deal",
    example: ["growth opportunity", "recurring revenue"],
    required: false,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[]

  @ApiProperty({ description: "Deal visibility (true = public, false = private/targeted)", required: false })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean

  @ApiProperty({ description: "Flag indicating if the deal is featured", required: false })
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean

  @ApiProperty({ description: "Stake percentage being offered", example: 100, required: false })
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  stakePercentage?: number

  @ApiProperty({
    description:
      "Documents for the deal - if provided, replaces existing documents; if omitted, preserves existing documents",
    type: [String],
    required: false,
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  documents?: string[]

  @ApiProperty({ description: "Final sale price (for completed deals)", example: 4800000, required: false })
  @IsNumber()
  @IsOptional()
  finalSalePrice?: number
}