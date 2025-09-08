import { Injectable, ConflictException, NotFoundException, Inject, forwardRef } from "@nestjs/common"
import { Model } from "mongoose"
import * as bcrypt from "bcrypt"
import { Buyer, BuyerDocument } from "./schemas/buyer.schema"
import { CreateBuyerDto } from "./dto/create-buyer.dto"
import { UpdateBuyerDto } from "./dto/update-buyer.dto"
import { InjectModel } from "@nestjs/mongoose"
import { AuthService } from "../auth/auth.service"
import { MailService } from "../mail/mail.service"
import { genericEmailTemplate } from "../mail/generic-email.template"
import { CompanyProfile } from "../company-profile/schemas/company-profile.schema"
import { ILLUSTRATION_ATTACHMENT } from "../mail/mail.service"

@Injectable()
export class BuyersService {
  // private buyerModel: Model<BuyerDocument>

  constructor(
    @InjectModel(Buyer.name) private buyerModel: Model<BuyerDocument>,
    @InjectModel(CompanyProfile.name) private companyProfileModel: Model<CompanyProfile>,
    @Inject(forwardRef(() => AuthService)) private authService: AuthService,
    private mailService: MailService
  ) { }

  private isProfileComplete(profile: CompanyProfile): boolean {
    return !!(
      profile.companyName &&
      profile.companyName !== "Set your company name" &&
      profile.website &&
      profile.companyType &&
      profile.companyType !== "Other" &&
      profile.capitalEntity &&
      profile.dealsCompletedLast5Years !== undefined &&
      profile.averageDealSize !== undefined &&
      profile.targetCriteria?.countries?.length > 0 &&
      profile.targetCriteria?.industrySectors?.length > 0 &&
      profile.targetCriteria?.revenueMin !== undefined &&
      profile.targetCriteria?.revenueMax !== undefined &&
      profile.targetCriteria?.ebitdaMin !== undefined &&
      profile.targetCriteria?.ebitdaMax !== undefined &&
      profile.targetCriteria?.transactionSizeMin !== undefined &&
      profile.targetCriteria?.transactionSizeMax !== undefined &&
      profile.targetCriteria?.revenueGrowth !== undefined &&
      profile.targetCriteria?.minStakePercent !== undefined &&
      profile.targetCriteria?.minYearsInBusiness !== undefined &&
      profile.targetCriteria?.preferredBusinessModels?.length > 0 &&
      profile.targetCriteria?.description &&
      profile.agreements?.feeAgreementAccepted
    );
  }

  async sendProfileCompletionReminder(buyerId: string): Promise<void> {
    const buyer = await this.buyerModel.findById(buyerId).populate('companyProfileId').exec();
    if (!buyer || !buyer.companyProfileId) {
      throw new NotFoundException("Buyer or profile not found");
    }

    const profile = buyer.companyProfileId as any;
    
    if (!this.isProfileComplete(profile)) {
      const subject = 'Complete Your Company Profile to Get the Best Matching Deals';
      const emailContent = `
        <p>We noticed you haven't completed your company profile yet. To ensure you receive the most relevant acquisition opportunities, please take a few minutes to complete your profile.</p>
        <p>A complete profile helps us match you with deals that fit your specific criteria, including:</p>
        <ul>
          <li>Target industries and geographic regions</li>
          <li>Revenue and EBITDA ranges</li>
          <li>Transaction size preferences</li>
          <li>Business model preferences</li>
        </ul>
        <p><a href="${process.env.FRONTEND_URL}/buyer/login" style="background-color: #3aafa9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Complete Your Profile Now</a></p>
        <p>Don't miss out on great opportunities - complete your profile today!</p>
      `;

      const emailBody = genericEmailTemplate(subject, buyer.fullName.split(' ')[0], emailContent);

      await this.mailService.sendEmailWithLogging(
        buyer.email,
        'buyer',
        subject,
        emailBody,
        [ILLUSTRATION_ATTACHMENT]
      );
    }
  }

  async create(createBuyerDto: CreateBuyerDto): Promise<Buyer> {
    const { email, password, companyName, website } = createBuyerDto

    const existingBuyer = await this.buyerModel.findOne({ email }).exec()
    if (existingBuyer) {
      throw new ConflictException("Email already exists")
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const newBuyer = new this.buyerModel({
      ...createBuyerDto,
      password: hashedPassword,
    })

    let savedBuyer = await newBuyer.save()

    const companyProfile = new this.companyProfileModel({
      companyName,
      website,
      companyType: "Other", // Default value
      buyer: savedBuyer._id,
    });
    const savedCompanyProfile = await companyProfile.save();

    savedBuyer.companyProfileId = savedCompanyProfile._id;
    savedBuyer = await savedBuyer.save();

    await this.authService.sendVerificationEmail(savedBuyer);

    // Send email to project owner
    const ownerSubject = `New Buyer ${savedBuyer.companyName}`;
    const ownerHtmlBody = genericEmailTemplate(ownerSubject, 'John', `
      <p><b>Company Name</b>: ${savedBuyer.companyName}</p>
      <p><b>Website</b>: ${website}</p>
      <p><b>Main Contact</b>: ${savedBuyer.fullName}</p>
      <p><b>Main Contact Email</b>: ${savedBuyer.email}</p>
      <p><b>Main Contact Phone</b>: ${savedBuyer.phone}</p>
    `);
    await this.mailService.sendEmailWithLogging(
      'johnm@cimamplify.com',
      'admin',
      ownerSubject,
      ownerHtmlBody,
      [ILLUSTRATION_ATTACHMENT],
      undefined,
    );

    return savedBuyer
  }

  async findAll(): Promise<Buyer[]> {
    const buyers = await this.buyerModel.find().populate('companyProfileId').lean().exec();
    // Map companyProfileId to companyProfile for frontend compatibility
    return buyers.map((buyer: any) => ({
      ...buyer,
      companyProfile: buyer.companyProfileId,
    }));
  }

  async findOne(id: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findById(id).populate('companyProfileId').exec();
    if (!buyer) {
      throw new NotFoundException("Buyer not found")
    }
    return buyer;
  }

  async findByEmail(email: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findOne({ email }).exec()
    if (!buyer) {
      throw new NotFoundException("Buyer not found")
    }
    return buyer
  }

  async findById(id: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findById(id).populate('companyProfileId').exec();
    if (!buyer) {
      throw new NotFoundException("Buyer not found")
    }
    return buyer;
  }

  async update(id: string, updateBuyerDto: UpdateBuyerDto): Promise<Buyer> {
    const buyer = await this.buyerModel.findById(id).exec()
    if (!buyer) {
      throw new NotFoundException("Buyer not found")
    }

    // If password is being updated, hash it
    if (updateBuyerDto.password) {
      updateBuyerDto.password = await bcrypt.hash(updateBuyerDto.password, 10)
    }

    Object.assign(buyer, updateBuyerDto)
    return buyer.save()
  }

  async remove(id: string): Promise<void> {
    const result = await this.buyerModel.findByIdAndDelete(id).exec()
    if (!result) {
      throw new NotFoundException("Buyer not found")
    }
  }

  async createFromGoogle(profile: any): Promise<{ buyer: Buyer; isNewUser: boolean }> {
    const { email, name, sub } = profile

    // Check if user already exists
    let buyer = await this.buyerModel.findOne({ email }).exec()
    let isNewUser = false

    if (buyer) {
      // Update Google ID if not already set
      if (!buyer.googleId) {
        buyer.googleId = sub
        buyer.isGoogleAccount = true
        buyer = await buyer.save()
      }
    } else {
      // Create new buyer from Google data
      isNewUser = true
      const newBuyer = new this.buyerModel({
        email,
        fullName: name,
        companyName: "Set your company name", // Default value, user can update later
        password: await bcrypt.hash(Math.random().toString(36), 10), // Random password
        googleId: sub,
        isGoogleAccount: true,
      })

      let savedBuyer = await newBuyer.save()

      const companyProfile = new this.companyProfileModel({
        companyName: "Set your company name",
        website: "",
        companyType: "Other", // Default value
        buyer: savedBuyer._id,
      });
      const savedCompanyProfile = await companyProfile.save();

      savedBuyer.companyProfileId = savedCompanyProfile._id;
      buyer = await savedBuyer.save();

      // Send email to project owner
      const ownerSubject = `New Buyer ${buyer.companyName}`;
      const ownerHtmlBody = genericEmailTemplate(ownerSubject, 'John', `
        <p><b>Company Name</b>: ${buyer.companyName}</p>
        <p><b>Website</b>: </p>
        <p><b>Main Contact</b>: ${buyer.fullName}</p>
        <p><b>Main Contact Email</b>: ${buyer.email}</p>
        <p><b>Main Contact Phone</b>: ${buyer.phone}</p>
      `);
      await this.mailService.sendEmailWithLogging(
        'johnm@cimamplify.com',
        'admin',
        ownerSubject,
        ownerHtmlBody,
        [ILLUSTRATION_ATTACHMENT],
        undefined,
      );
    }

    return { buyer, isNewUser }
  }

  async updateProfilePicture(id: string, profilePicturePath: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findById(id).exec()
    if (!buyer) {
      throw new NotFoundException("Buyer not found")
    }

    buyer.profilePicture = profilePicturePath
    return buyer.save()
  }
}
