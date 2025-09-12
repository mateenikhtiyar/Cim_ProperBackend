// src/buyers/buyers.service.ts
import { Injectable, ConflictException, NotFoundException, Inject, forwardRef } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import * as bcrypt from "bcrypt";

import { Buyer, BuyerDocument } from "./schemas/buyer.schema";
import { CreateBuyerDto } from "./dto/create-buyer.dto";
import { UpdateBuyerDto } from "./dto/update-buyer.dto";
import { CompanyProfile, CompanyProfileDocument } from "../company-profile/schemas/company-profile.schema";

import { AuthService } from "../auth/auth.service";
import { MailService, ILLUSTRATION_ATTACHMENT } from "../mail/mail.service";
import { genericEmailTemplate } from "../mail/generic-email.template";

@Injectable()
export class BuyersService {
  constructor(
    @InjectModel(Buyer.name) private readonly buyerModel: Model<BuyerDocument>,
    @InjectModel(CompanyProfile.name) private readonly companyProfileModel: Model<CompanyProfileDocument>,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
    private readonly mailService: MailService,
  ) {}

  private isProfileComplete(profile: CompanyProfile): boolean {
    return !!(
      profile &&
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
    const buyer = await this.buyerModel.findById(buyerId).populate("companyProfileId").exec();
    if (!buyer || !buyer.companyProfileId) {
      throw new NotFoundException("Buyer or profile not found");
    }

    const profile = buyer.companyProfileId as unknown as CompanyProfileDocument;
    if (!this.isProfileComplete(profile)) {
      const subject = "Complete Your Company Profile to Get the Best Matching Deals";
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

      const emailBody = genericEmailTemplate(subject, (buyer.fullName || "").split(" ")[0] || "there", emailContent);

      await this.mailService.sendEmailWithLogging(
        buyer.email,
        "buyer",
        subject,
        emailBody,
        [ILLUSTRATION_ATTACHMENT],
      );
    }
  }

  async create(createBuyerDto: CreateBuyerDto): Promise<Buyer> {
    const { email, password, companyName, website } = createBuyerDto;

    const existingBuyer = await this.buyerModel.findOne({ email }).exec();
    if (existingBuyer) {
      throw new ConflictException("Email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newBuyer = new this.buyerModel({
      ...createBuyerDto,
      password: hashedPassword,
    });

    let savedBuyer = await newBuyer.save();

    const companyProfile = new this.companyProfileModel({
      companyName,
      website,
      companyType: "Other", // Default value
      buyer: savedBuyer._id,
    });
    const savedCompanyProfile = await companyProfile.save();

    savedBuyer.companyProfileId = savedCompanyProfile._id as Types.ObjectId;
    savedBuyer = await savedBuyer.save();

    await this.authService.sendVerificationEmail(savedBuyer);

    // Notify project owner
    const ownerSubject = `New Buyer ${savedBuyer.companyName}`;
    const ownerHtmlBody = genericEmailTemplate(ownerSubject, "John", `
      <p><b>Company Name</b>: ${savedBuyer.companyName}</p>
      <p><b>Website</b>: ${website}</p>
      <p><b>Main Contact</b>: ${savedBuyer.fullName}</p>
      <p><b>Main Contact Email</b>: ${savedBuyer.email}</p>
      <p><b>Main Contact Phone</b>: ${savedBuyer.phone}</p>
    `);

    await this.mailService.sendEmailWithLogging(
      "johnm@cimamplify.com",
      "admin",
      ownerSubject,
      ownerHtmlBody,
      [ILLUSTRATION_ATTACHMENT],
    );

    return savedBuyer;
  }

  async findAll(page = 1, limit = 10): Promise<any> {
    const skip = (page - 1) * limit;
    const buyers = await this.buyerModel
      .find()
      .populate("companyProfileId")
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    const totalBuyers = await this.buyerModel.countDocuments().exec();

    const mappedBuyers = buyers.map((buyer: any) => ({
      ...buyer,
      companyProfile: buyer.companyProfileId,
    }));

    return {
      data: mappedBuyers,
      total: totalBuyers,
      page,
      lastPage: Math.ceil(totalBuyers / limit),
    };
  }

  async findOne(id: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findById(id).populate("companyProfileId").exec();
    if (!buyer) {
      throw new NotFoundException("Buyer not found");
    }
    return buyer;
  }

  async findByEmail(email: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findOne({ email }).exec();
    if (!buyer) {
      throw new NotFoundException("Buyer not found");
    }
    return buyer;
  }

  async findById(id: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findById(id).populate("companyProfileId").exec();
    if (!buyer) {
      throw new NotFoundException("Buyer not found");
    }
    return buyer;
  }

  async update(id: string, updateBuyerDto: UpdateBuyerDto): Promise<Buyer> {
    const buyer = await this.buyerModel.findById(id).exec();
    if (!buyer) {
      throw new NotFoundException("Buyer not found");
    }

    if (updateBuyerDto.password) {
      updateBuyerDto.password = await bcrypt.hash(updateBuyerDto.password, 10);
    }

    Object.assign(buyer, updateBuyerDto);
    return buyer.save();
  }

  async remove(id: string): Promise<void> {
    const result = await this.buyerModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException("Buyer not found");
    }
  }

  async createFromGoogle(profile: any): Promise<{ buyer: Buyer; isNewUser: boolean }> {
    const { email, name, sub } = profile;

    let buyer = await this.buyerModel.findOne({ email }).exec();
    let isNewUser = false;

    if (buyer) {
      if (!buyer.googleId) {
        buyer.googleId = sub;
        buyer.isGoogleAccount = true;
        buyer = await buyer.save();
      }
    } else {
      isNewUser = true;
      const newBuyer = new this.buyerModel({
        email,
        fullName: name,
        companyName: "Set your company name",
        password: await bcrypt.hash(Math.random().toString(36), 10),
        googleId: sub,
        isGoogleAccount: true,
      });

      let savedBuyer = await newBuyer.save();

      const companyProfile = new this.companyProfileModel({
        companyName: "Set your company name",
        website: "",
        companyType: "Other",
        buyer: savedBuyer._id,
      });
      const savedCompanyProfile = await companyProfile.save();

      savedBuyer.companyProfileId = savedCompanyProfile._id as Types.ObjectId;
      buyer = await savedBuyer.save();

      const ownerSubject = `New Buyer ${buyer.companyName}`;
      const ownerHtmlBody = genericEmailTemplate(ownerSubject, "John", `
        <p><b>Company Name</b>: ${buyer.companyName}</p>
        <p><b>Website</b>: </p>
        <p><b>Main Contact</b>: ${buyer.fullName}</p>
        <p><b>Main Contact Email</b>: ${buyer.email}</p>
        <p><b>Main Contact Phone</b>: ${buyer.phone}</p>
      `);

      await this.mailService.sendEmailWithLogging(
        "johnm@cimamplify.com",
        "admin",
        ownerSubject,
        ownerHtmlBody,
        [ILLUSTRATION_ATTACHMENT],
      );
    }

    return { buyer, isNewUser };
  }

  async updateProfilePicture(id: string, profilePicturePath: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findById(id).exec();
    if (!buyer) {
      throw new NotFoundException("Buyer not found");
    }

    buyer.profilePicture = profilePicturePath;
    return buyer.save();
  }
}
