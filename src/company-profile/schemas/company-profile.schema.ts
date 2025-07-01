import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose"
import { Document, Schema as MongooseSchema } from "mongoose"
import { ApiProperty } from "@nestjs/swagger"

export interface CompanyProfileDocument extends CompanyProfile, Document {
  toObject(): any
}

@Schema()
class Contact {
  @ApiProperty({ description: "Name of the contact person" })
  @Prop({ required: true })
  name: string

  @ApiProperty({ description: "Email of the contact person" })
  @Prop({ required: true })
  email: string

  @ApiProperty({ description: "Phone number of the contact person" })
  @Prop({ required: true })
  phone: string
}

@Schema()
class Preferences {
  @ApiProperty({ description: "Stop sending deals", default: false })
  @Prop({ default: false })
  stopSendingDeals: boolean

  @ApiProperty({ description: "Do not send deals that are currently marketed on other deal marketplaces", default: false })
  @Prop({ default: false })
  doNotSendMarketedDeals: boolean

  @ApiProperty({ description: "Allow buyer like deals", default: true })
  @Prop({ default: true })
  allowBuyerLikeDeals: boolean
}

@Schema()
class TargetCriteria {
  @ApiProperty({ description: "Target countries", type: [String] })
  @Prop({ type: [String], default: [] })
  countries: string[]

  @ApiProperty({ description: "Industry sectors", type: [String] })
  @Prop({ type: [String], default: [] })
  industrySectors: string[]

  @ApiProperty({ description: "Minimum revenue", nullable: true })
  @Prop({ required: false })
  revenueMin: number

  @ApiProperty({ description: "Maximum revenue", nullable: true })
  @Prop({ required: false })
  revenueMax: number

  @ApiProperty({ description: "Minimum EBITDA", nullable: true })
  @Prop({ required: false })
  ebitdaMin: number

  @ApiProperty({ description: "Maximum EBITDA", nullable: true })
  @Prop({ required: false })
  ebitdaMax: number

  @ApiProperty({ description: "Minimum transaction size", nullable: true })
  @Prop({ required: false })
  transactionSizeMin: number

  @ApiProperty({ description: "Maximum transaction size", nullable: true })
  @Prop({ required: false })
  transactionSizeMax: number

  @ApiProperty({ description: "Revenue growth percentage", nullable: true })
  @Prop({ required: false })
  revenueGrowth: number

  @ApiProperty({ description: "Minimum stake percentage", nullable: true })
  @Prop({ required: false })
  minStakePercent: number

  @ApiProperty({ description: "Minimum years in business", nullable: true })
  @Prop({ required: false })
  minYearsInBusiness: number

  @ApiProperty({ description: "Preferred business models", type: [String] })
  @Prop({ type: [String], default: [] })
  preferredBusinessModels: string[]

  @ApiProperty({ description: "Additional description", nullable: true })
  @Prop({ required: false })
  description: string
}

@Schema()
class Agreements {
  @ApiProperty({ description: "Terms and conditions accepted", default: false })
  @Prop({ default: false })
  termsAndConditionsAccepted: boolean

  @ApiProperty({ description: "NDA accepted", default: false })
  @Prop({ default: false })
  ndaAccepted: boolean

  @ApiProperty({ description: "Fee agreement accepted", default: false })
  @Prop({ default: false })
  feeAgreementAccepted: boolean
}

@Schema({ timestamps: true })
export class CompanyProfile {
  @ApiProperty({ description: "Company name" })
  @Prop({ required: true })
  companyName: string

  @ApiProperty({ description: "Company website" })
  @Prop({ required: true })
  website: string

  @ApiProperty({ description: "Selected currency", example: "USD" })
  @Prop({ required: true, default: "USD" })
  selectedCurrency: string

  @ApiProperty({ description: "Contact details", type: [Contact] })
  @Prop({ type: [Object], default: [] })
  contacts: Contact[]

  @ApiProperty({ description: "Company type" })
  @Prop({ required: true })
  companyType: string

  @ApiProperty({ description: "Capital entity" })
  @Prop({ required: true })
  capitalEntity: string

  @ApiProperty({ description: "Deals completed in last 5 years", nullable: true })
  @Prop({ required: false })
  dealsCompletedLast5Years: number

  @ApiProperty({ description: "Average deal size", nullable: true })
  @Prop({ required: false })
  averageDealSize: number

  @ApiProperty({ description: "Preferences" })
  @Prop({ type: Object, default: {} })
  preferences: Preferences

  @ApiProperty({ description: "Target criteria" })
  @Prop({ type: Object, default: {} })
  targetCriteria: TargetCriteria

  @ApiProperty({ description: "Agreements" })
  @Prop({ type: Object, default: {} })
  agreements: Agreements

  @ApiProperty({ description: "Reference to the buyer" })
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: "Buyer", required: true })
  buyer: string

  // Ensure Mongoose methods are properly typed
  toObject?(): any
}

export const CompanyProfileSchema = SchemaFactory.createForClass(CompanyProfile)
