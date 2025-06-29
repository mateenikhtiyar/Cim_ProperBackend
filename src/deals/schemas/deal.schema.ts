import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose"
import { Document, Schema as MongooseSchema } from "mongoose"
import { ApiProperty } from "@nestjs/swagger"

export type DealDocumentType = Deal & Document

export enum DealStatus {
  DRAFT = "draft",
  PENDING = "pending",
  ACTIVE = "active",
  COMPLETED = "completed",
  REJECTED = "rejected",
}

export enum DealType {
  ACQUISITION = "acquisition",
  MERGER = "merger",
  INVESTMENT = "investment",
  PARTNERSHIP = "partnership",
  OTHER = "other",
}

export enum DealVisibility {
  SEED = "seed",
  BLOOM = "bloom",
  FRUIT = "fruit",
}

export enum CapitalAvailability {
  READY = "Ready to deploy immediately",
  NEED = "Need to raise",
}

@Schema()
class FinancialDetails {
  @ApiProperty({ description: "Annual revenue currency", example: "USD($)" })
  @Prop({ required: false })
  trailingRevenueCurrency?: string

  @ApiProperty({ description: "Annual revenue amount", example: 1000000 })
  @Prop({ required: false })
  trailingRevenueAmount?: number

  @ApiProperty({ description: "EBITDA currency", example: "USD($)" })
  @Prop({ required: false })
  trailingEBITDACurrency?: string

  @ApiProperty({ description: "EBITDA amount", example: 250000 })
  @Prop({ required: false })
  trailingEBITDAAmount?: number

  @ApiProperty({ description: "T12 Free Cash Flow", example: 180000 })
  @Prop({ required: false })
  t12FreeCashFlow?: number

  @ApiProperty({ description: "T12 Net Income", example: 200000 })
  @Prop({ required: false })
  t12NetIncome?: number

  @ApiProperty({ description: "Average revenue growth in %", example: 42 })
  @Prop({ required: false })
  avgRevenueGrowth?: number

  @ApiProperty({ description: "Net profit", example: 200000 })
  @Prop({ required: false })
  netIncome?: number

  @ApiProperty({ description: "Asking price", example: 5000000 })
  @Prop({ required: false })
  askingPrice?: number

  @ApiProperty({ description: "Final sale price (for completed deals)", example: 4800000 })
  @Prop({ required: false })
  finalSalePrice?: number
}

@Schema()
class BusinessModel {
  @ApiProperty({ description: "Recurring Revenue" })
  @Prop({ default: false })
  recurringRevenue?: boolean

  @ApiProperty({ description: "Project-Based" })
  @Prop({ default: false })
  projectBased?: boolean

  @ApiProperty({ description: "Asset Light" })
  @Prop({ default: false })
  assetLight?: boolean

  @ApiProperty({ description: "Asset Heavy" })
  @Prop({ default: false })
  assetHeavy?: boolean
}

@Schema()
class ManagementPreferences {
  @ApiProperty({ description: "Retiring/Divesting" })
  @Prop({ default: false })
  retiringDivesting?: boolean

  @ApiProperty({ description: "Other Key Staff Will Stay" })
  @Prop({ default: false })
  staffStay?: boolean
}

@Schema()
class BuyerFit {
  @ApiProperty({ description: "Capital Availability", isArray: true, enum: CapitalAvailability })
  @Prop({ type: [String], enum: CapitalAvailability })
  capitalAvailability?: CapitalAvailability[]

  @ApiProperty({ description: "Minimum number of prior acquisitions" })
  @Prop({ required: false })
  minPriorAcquisitions?: number;

  @ApiProperty({ description: "Minimum transaction size ($)" })
  @Prop({ required: false })
  minTransactionSize?: number;
}


@Schema()
class DealTimeline {
  @ApiProperty({ description: "Date when the deal was created" })
  @Prop({ default: Date.now })
  createdAt?: Date

  @ApiProperty({ description: "Date when the deal was last updated" })
  @Prop()
  updatedAt?: Date

  @ApiProperty({ description: "Date when the deal was published to buyers" })
  @Prop({ required: false })
  publishedAt?: Date

  @ApiProperty({ description: "Date when the deal was completed" })
  @Prop({ required: false })
  completedAt?: Date
}

@Schema()
class DealDocument {
  @ApiProperty({ description: "File name on server" })
  @Prop({ required: true })
  filename: string

  @ApiProperty({ description: "Original file name" })
  @Prop({ required: true })
  originalName: string

  @ApiProperty({ description: "File path on server" })
  @Prop({ required: true })
  path: string

  @ApiProperty({ description: "File size in bytes" })
  @Prop({ required: true })
  size: number

  @ApiProperty({ description: "MIME type of the file" })
  @Prop({ required: true })
  mimetype: string

  @ApiProperty({ description: "Date when the document was uploaded" })
  @Prop({ default: Date.now })
  uploadedAt: Date
}

@Schema({ timestamps: true })
export class Deal {
  @ApiProperty({ description: "Title of the deal" })
  @Prop({ required: true })
  title!: string

  @ApiProperty({ description: "Description of the company" })
  @Prop({ required: true })
  companyDescription!: string

  @ApiProperty({ description: "Type of company", example: "SaaS Company" })
  @Prop({ type: [String], required: false })
companyType?: string[];


  @ApiProperty({ description: "Type of deal", enum: DealType })
  @Prop({ required: true, enum: DealType })
  dealType!: DealType

  @ApiProperty({ description: "Status of the deal", enum: DealStatus })
  @Prop({ required: true, enum: DealStatus, default: DealStatus.DRAFT })
  status!: DealStatus

  @ApiProperty({ description: "Deal visibility level", enum: DealVisibility })
  @Prop({ required: false, enum: DealVisibility })
  visibility?: DealVisibility

  @ApiProperty({ description: "Deal reward level", enum: ["Seed", "Bloom", "Fruit"] })
  @Prop({ required: true, enum: ["Seed", "Bloom", "Fruit"] })
  rewardLevel!: "Seed" | "Bloom" | "Fruit";

  @ApiProperty({ description: "Industry sector of the company" })
  @Prop({ required: true })
  industrySector!: string

  @ApiProperty({ description: "Geographic location/country of the company" })
  @Prop({ required: true })
  geographySelection!: string

  @ApiProperty({ description: "Years the company has been in business", example: 5 })
  @Prop({ required: true })
  yearsInBusiness!: number

  @ApiProperty({ description: "Number of employees", example: 50 })
  @Prop({ required: false })
  employeeCount?: number

  @ApiProperty({ description: "Reference to the seller" })
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "Seller", required: true })
  seller!: string

  @ApiProperty({ description: "Financial details of the deal" })
  @Prop({ type: Object, default: {} })
  financialDetails!: FinancialDetails

  @ApiProperty({ description: "Business model details" })
  @Prop({ type: Object, default: {} })
  businessModel!: BusinessModel

  @ApiProperty({ description: "Management preferences details" })
  @Prop({ type: Object, default: {} })
  managementPreferences!: ManagementPreferences

  @ApiProperty({ description: "Buyer fit details" })
  @Prop({ type: Object, default: {} })
  buyerFit!: BuyerFit

  @ApiProperty({ description: "Timeline details of the deal" })
  @Prop({ type: Object, default: {} })
  timeline!: DealTimeline

  @ApiProperty({ description: "Targeted buyer IDs", type: [String] })
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: "Buyer", default: [] })
  targetedBuyers!: string[]

  @ApiProperty({ description: "Interested buyer IDs", type: [String] })
  @Prop({ type: [MongooseSchema.Types.ObjectId], ref: "Buyer", default: [] })
  interestedBuyers!: string[]

  @ApiProperty({ description: "Tags for categorizing the deal", example: ["growth opportunity", "recurring revenue"] })
  @Prop({ type: [String], default: [] })
  tags!: string[]

  @ApiProperty({ description: "Deal visibility (true = public, false = private/targeted)" })
  @Prop({ default: false })
  isPublic!: boolean

  @ApiProperty({ description: "Flag indicating if the deal is featured" })
  @Prop({ default: false })
  isFeatured!: boolean

  @ApiProperty({ description: "Stake percentage being offered", example: 100 })
  @Prop({ required: false })
  stakePercentage?: number

  @ApiProperty({ description: "Documents uploaded for the deal", type: [DealDocument] })
  @Prop({ type: [Object], default: [] })
  documents!: DealDocument[]

  @ApiProperty({ description: "Deal slug for SEO-friendly URLs" })
  @Prop({ required: false })
  slug?: string

  @ApiProperty({ description: "Invitation status for targeted buyers" })
  @Prop({
    type: Map,
    of: {
      invitedAt: Date,
      respondedAt: Date,
      response: String,
      notes: String,
    },
    default: new Map(),
  })
  invitationStatus!: Map<
    string,
    {
      invitedAt: Date
      respondedAt?: Date
      response: "pending" | "accepted" | "rejected"
      notes?: string
    }
  >

  @ApiProperty({ description: "Deal priority level", enum: ["low", "medium", "high"] })
  @Prop({ enum: ["low", "medium", "high"], default: "medium" })
  priority!: string

  @ApiProperty({ description: "Deal expiration date" })
  @Prop({ required: false })
  expiresAt?: Date

  @ApiProperty({ description: "Deals completed in the last 5 years", example: 5 })
  @Prop({ required: false })
  dealsCompletedLast5Years?: number;
}

export const DealSchema = SchemaFactory.createForClass(Deal)

// Add index for better search performance
DealSchema.index({ title: "text", companyDescription: "text", tags: "text" })

// Add createdAt and updatedAt timestamps
DealSchema.pre("save", function (next) {
  if (this.isNew) {
    this.timeline = this.timeline || {}
    this.timeline.createdAt = new Date()
  }
  this.timeline.updatedAt = new Date()
  next()
})
