import { ApiProperty } from "@nestjs/swagger"
import { IsString, IsEnum, IsArray, IsBoolean, IsOptional, IsNumber, ValidateNested, Min, Max, IsDate } from "class-validator"
import { Type } from "class-transformer"
import { DealStatus, DealType, DealVisibility, CapitalAvailability } from "../schemas/deal.schema"

export class FinancialDetailsDto {
  @ApiProperty({ description: "Annual revenue currency", example: "USD($)", required: false })
  @IsString()
  @IsOptional()
  trailingRevenueCurrency?: string

  @ApiProperty({ description: "Annual revenue amount", example: 1000000, required: false })
  @IsNumber()
  @IsOptional()
  trailingRevenueAmount?: number

  @ApiProperty({ description: "EBITDA currency", example: "USD($)", required: false })
  @IsString()
  @IsOptional()
  trailingEBITDACurrency?: string

  @ApiProperty({ description: "EBITDA amount", example: 250000, required: false })
  @IsNumber()
  @IsOptional()
  trailingEBITDAAmount?: number

  @ApiProperty({ description: "T12 Free Cash Flow", example: 180000, required: false })
  @IsNumber()
  @IsOptional()
  t12FreeCashFlow?: number

  @ApiProperty({ description: "T12 Net Income", example: 200000, required: false })
  @IsNumber()
  @IsOptional()
  t12NetIncome?: number

  @ApiProperty({ description: "Average revenue growth in %", example: 42, required: false })
  @IsNumber()
  @IsOptional()
  avgRevenueGrowth?: number

  @ApiProperty({ description: "Net profit", example: 200000, required: false })
  @IsNumber()
  @IsOptional()
  netIncome?: number

  @ApiProperty({ description: "Asking price", example: 5000000, required: false })
  @IsNumber()
  @IsOptional()
  askingPrice?: number

  @ApiProperty({ description: "Final sale price (for completed deals)", example: 4800000, required: false })
  @IsNumber()
  @IsOptional()
  finalSalePrice?: number
}

export class BusinessModelDto {
  @ApiProperty({ description: "Recurring Revenue", required: false })
  @IsBoolean()
  @IsOptional()
  recurringRevenue?: boolean

  @ApiProperty({ description: "Project-Based", required: false })
  @IsBoolean()
  @IsOptional()
  projectBased?: boolean

  @ApiProperty({ description: "Asset Light", required: false })
  @IsBoolean()
  @IsOptional()
  assetLight?: boolean

  @ApiProperty({ description: "Asset Heavy", required: false })
  @IsBoolean()
  @IsOptional()
  assetHeavy?: boolean
}

export class ManagementPreferencesDto {
  @ApiProperty({ description: "Description of why client is selling and continuation plan", required: false })
  @IsString()
  @IsOptional()
  description?: string
  @ApiProperty({ description: "Retiring/Divesting", required: false })
  @IsBoolean()
  @IsOptional()
  retiringDivesting?: boolean
  @ApiProperty({ description: "Other Key Staff Will Stay", required: false })
  @IsBoolean()
  @IsOptional()
  staffStay?: boolean
}
export class BuyerFitDto {
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

export class CreateDealWithFilesDto {
  @ApiProperty({ description: "Deal data as JSON string" })
  @IsString()
  dealData: string

  @ApiProperty({
    type: "array",
    items: { type: "string", format: "binary" },
    description: "Optional files to upload",
    required: false,
  })
  files?: any[]
}

export interface DocumentInfo {
  filename: string;
  originalName: string;
  path: string;
  size: number;
  mimetype: string;
  uploadedAt: Date;
}

export class CreateDealDto {
  @ApiProperty({ description: "Title of the deal", example: "SaaS Company Acquisition Opportunity" })
  @IsString()
  title: string

  @ApiProperty({
    description: "Description of the company",
    example: "Established SaaS company with recurring revenue seeking acquisition.",
  })
  @IsString()
  companyDescription: string

  @ApiProperty({ description: "Type of company", example: "SaaS Company", required: false })
  @IsString()
  @IsOptional()
  companyType?: string

  @ApiProperty({ description: "Type of deal", enum: DealType, example: DealType.ACQUISITION })
  @IsEnum(DealType)
  dealType: DealType

  @ApiProperty({ description: "Status of the deal", enum: DealStatus, default: DealStatus.DRAFT, required: false })
  @IsEnum(DealStatus)
  @IsOptional()
  status?: DealStatus = DealStatus.DRAFT

  @ApiProperty({ description: "Deal visibility level", enum: DealVisibility, required: false })
  @IsEnum(DealVisibility)
  @IsOptional()
  visibility?: DealVisibility

  @ApiProperty({ description: "Industry sector of the company", example: "Technology" })
  @IsString()
  industrySector: string

  @ApiProperty({ description: "Geographic location/country of the company", example: "United States" })
  @IsString()
  geographySelection: string

  @ApiProperty({ description: "Years the company has been in business", example: 5 })
  @IsNumber()
  yearsInBusiness: number

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

  @ApiProperty({ description: "Management preferences details", type: ManagementPreferencesDto, required: false })
  @ValidateNested()
  @Type(() => ManagementPreferencesDto)
  @IsOptional()
  managementPreferences?: ManagementPreferencesDto

  @ApiProperty({ description: "Buyer fit details", type: BuyerFitDto, required: false })
  @ValidateNested()
  @Type(() => BuyerFitDto)
  @IsOptional()
  buyerFit?: BuyerFitDto

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

  @ApiProperty({
    description: "Deal visibility (true = public, false = private/targeted)",
    default: false,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean = false

  @ApiProperty({ description: "Flag indicating if the deal is featured", default: false, required: false })
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean = false

  @ApiProperty({ description: "Stake percentage being offered", example: 100, required: false })
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  stakePercentage?: number

  @ApiProperty({ description: "Documents uploaded for the deal", type: [Object], required: false })
  @IsArray()
  @IsOptional()
  documents?: DocumentInfo[];

  // Add seller field - this will be populated by the controller
  @ApiProperty({ description: "Seller ID", required: false })
  @IsString()
  @IsOptional()
  seller?: string
}
