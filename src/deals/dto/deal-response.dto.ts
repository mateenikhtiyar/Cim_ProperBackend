import { ApiProperty } from "@nestjs/swagger"
import { DealStatus, DealType, DealVisibility, CapitalAvailability } from "../schemas/deal.schema"

export class DealResponseDto {
  @ApiProperty({ example: "60d21b4667d0d8992e610c85" })
  id: string

  @ApiProperty({ example: "SaaS Company Acquisition Opportunity" })
  title: string

  @ApiProperty({ example: "Established SaaS company with recurring revenue seeking acquisition." })
  companyDescription: string

  @ApiProperty({ example: "SaaS Company" })
  companyType?: string

  @ApiProperty({ enum: DealType, example: DealType.ACQUISITION })
  dealType: DealType

  @ApiProperty({ enum: DealStatus, example: DealStatus.ACTIVE })
  status: DealStatus

  @ApiProperty({ enum: DealVisibility, example: DealVisibility.BLOOM })
  visibility?: DealVisibility

  @ApiProperty({ example: "Technology" })
  industrySector: string

  @ApiProperty({ example: "United States" })
  geographySelection: string

  @ApiProperty({ example: 5 })
  yearsInBusiness: number

  @ApiProperty({ example: 50 })
  employeeCount?: number

  @ApiProperty({ example: "60d21b4667d0d8992e610c85" })
  seller: string

  @ApiProperty({
    example: {
      trailingRevenueCurrency: "USD($)",
      trailingRevenueAmount: 1000000,
      trailingEBITDACurrency: "USD($)",
      trailingEBITDAAmount: 250000,
      t12FreeCashFlow: 180000,
      t12NetIncome: 200000,
      avgRevenueGrowth: 42,
      netIncome: 200000,
      askingPrice: 5000000,
      finalSalePrice: null,
    },
  })
  financialDetails?: {
    trailingRevenueCurrency?: string
    trailingRevenueAmount?: number
    trailingEBITDACurrency?: string
    trailingEBITDAAmount?: number
    t12FreeCashFlow?: number
    t12NetIncome?: number
    avgRevenueGrowth?: number
    netIncome?: number
    askingPrice?: number
    finalSalePrice?: number | null
  }

  @ApiProperty({
    example: {
      recurringRevenue: true,
      projectBased: false,
      assetLight: true,
      assetHeavy: false,
    },
  })
  businessModel?: {
    recurringRevenue?: boolean
    projectBased?: boolean
    assetLight?: boolean
    assetHeavy?: boolean
  }

  @ApiProperty({
    example: {
      retiringDivesting: true,
      staffStay: false,
    },
  })
  managementPreferences?: {
    retiringDivesting?: boolean
    staffStay?: boolean
  }

  @ApiProperty({
    example: {
      capitalAvailability: CapitalAvailability.READY,
      minPriorAcquisitions: 2,
      minTransactionSize: 1000000,
    },
  })
  buyerFit?: {
    capitalAvailability?: CapitalAvailability
    minPriorAcquisitions?: number
    minTransactionSize?: number
  }

  @ApiProperty({
    example: {
      createdAt: "2023-06-20T10:00:00.000Z",
      updatedAt: "2023-06-21T11:30:00.000Z",
      publishedAt: "2023-06-22T09:00:00.000Z",
      completedAt: null,
    },
  })
  timeline: {
    createdAt: Date
    updatedAt: Date
    publishedAt?: Date | null
    completedAt?: Date | null
  }

  @ApiProperty({ example: ["60d21b4667d0d8992e610c86", "60d21b4667d0d8992e610c87"] })
  targetedBuyers: string[]

  @ApiProperty({ example: ["60d21b4667d0d8992e610c88"] })
  interestedBuyers: string[]

  @ApiProperty({ example: ["growth opportunity", "recurring revenue"] })
  tags: string[]

  @ApiProperty({ example: false })
  isPublic: boolean

  @ApiProperty({ example: false })
  isFeatured: boolean

  @ApiProperty({ example: 100 })
  stakePercentage?: number

  @ApiProperty({ example: ["document1.pdf", "document2.pdf"] })
  documents?: string[]
}
