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
import { genericEmailTemplate, emailButton } from "../mail/generic-email.template";

@Injectable()
export class BuyersService {
  constructor(
    @InjectModel(Buyer.name) private readonly buyerModel: Model<BuyerDocument>,
    @InjectModel(CompanyProfile.name) private readonly companyProfileModel: Model<CompanyProfileDocument>,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
    private readonly mailService: MailService,
  ) { }

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
      const subject = 'CIM Amplify can not send you deals until you complete your company profile';
      const emailContent = `
        <p>If you have run into any issues please reply to this email with what is happening and we will help to solve the problem.</p>
        <p>If you did not receive a validation email from us please use this link to request a new one: </p>

        ${emailButton('Resend Verification Email', `${process.env.FRONTEND_URL}/resend-verification`)}

        <p>Then check your inbox or spam for an email from deals@amp-ven.com</p>

        <p style="color: red;"><b>If you don't plan to complete your profile please reply delete to this email and we will remove your registration.</b></p>

        <p>If you have questions check out our FAQ section at https://cimamplify.com/#FAQs or reply to this email.</p>
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
      throw new ConflictException("An account with this email already exists. Please try logging in instead.");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newBuyer = new this.buyerModel({
      ...createBuyerDto,
      password: hashedPassword,
      isEmailVerified: true, // Auto-verify since we removed email verification
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

    // Send welcome email instead of verification email
    await this.authService.sendWelcomeEmail(savedBuyer, 'buyer');

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
      "canotifications@amp-ven.com",
      "admin",
      ownerSubject,
      ownerHtmlBody,
      [ILLUSTRATION_ATTACHMENT],
    );

    return savedBuyer;
  }

  async findAll(page: number = 1, limit: number = 10, search: string = '', sortBy: string = '', dealStatus: string = ''): Promise<any> {
    const skip = (page - 1) * limit;
    
    // Build search query
    const searchQuery: any = search ? {
      $or: [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ]
    } : {};
    
    // Add deal status filter if provided
    if (dealStatus && (dealStatus === 'active' || dealStatus === 'pending' || dealStatus === 'rejected')) {
      const responseKey = dealStatus === 'active' ? 'accepted' : dealStatus;
      // Use aggregation to filter by deal status and include per-buyer invitationStatus counts
      const pipeline = [
        { $match: searchQuery },
        { $addFields: { buyerIdStr: { $toString: '$_id' } } },
        {
          $lookup: {
            from: 'deals',
            localField: '_id',
            foreignField: 'targetedBuyers',
            as: 'deals'
          }
        },
        {
          $addFields: {
            activeDealsCount: {
              $size: {
                $filter: {
                  input: '$deals',
                  cond: {
                    $and: [
                      { $ne: ['$$this.status', 'completed'] },
                      {
                        $gt: [
                          {
                            $size: {
                              $filter: {
                                input: { $objectToArray: '$$this.invitationStatus' },
                                as: 'inv',
                                cond: {
                                  $and: [
                                    { $eq: ['$$inv.k', '$buyerIdStr'] },
                                    { $eq: ['$$inv.v.response', 'accepted'] }
                                  ]
                                }
                              }
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                }
              }
            },
            pendingDealsCount: {
              $size: {
                $filter: {
                  input: '$deals',
                  cond: {
                    $and: [
                      { $ne: ['$$this.status', 'completed'] },
                      {
                        $gt: [
                          {
                            $size: {
                              $filter: {
                                input: { $objectToArray: '$$this.invitationStatus' },
                                as: 'inv',
                                cond: {
                                  $and: [
                                    { $eq: ['$$inv.k', '$buyerIdStr'] },
                                    { $eq: ['$$inv.v.response', 'pending'] }
                                  ]
                                }
                              }
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                }
              }
            },
            rejectedDealsCount: {
              $size: {
                $filter: {
                  input: '$deals',
                  cond: {
                    $and: [
                      { $ne: ['$$this.status', 'completed'] },
                      {
                        $gt: [
                          {
                            $size: {
                              $filter: {
                                input: { $objectToArray: '$$this.invitationStatus' },
                                as: 'inv',
                                cond: {
                                  $and: [
                                    { $eq: ['$$inv.k', '$buyerIdStr'] },
                                    { $eq: ['$$inv.v.response', 'rejected'] }
                                  ]
                                }
                              }
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                }
              }
            },
            filteredDealsCount: {
              $size: {
                $filter: {
                  input: '$deals',
                  cond: {
                    $and: [
                      { $ne: ['$$this.status', 'completed'] },
                      {
                        $gt: [
                          {
                            $size: {
                              $filter: {
                                input: { $objectToArray: '$$this.invitationStatus' },
                                as: 'inv',
                                cond: {
                                  $and: [
                                    { $eq: ['$$inv.k', '$buyerIdStr'] },
                                    { $eq: ['$$inv.v.response', responseKey] }
                                  ]
                                }
                              }
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        { $match: { filteredDealsCount: { $gt: 0 } } },
        { $sort: { _id: 1 as const } },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: 'companyprofiles',
            localField: 'companyProfileId',
            foreignField: '_id',
            as: 'companyProfileId'
          }
        },
        { $addFields: { companyProfileId: { $arrayElemAt: ['$companyProfileId', 0] } } }
      ];
      
      const buyers = await this.buyerModel.aggregate(pipeline).exec();
      const totalBuyersPipeline = [
        { $match: searchQuery },
        { $addFields: { buyerIdStr: { $toString: '$_id' } } },
        {
          $lookup: {
            from: 'deals',
            localField: '_id',
            foreignField: 'targetedBuyers',
            as: 'deals'
          }
        },
        {
          $addFields: {
            filteredDealsCount: {
              $size: {
                $filter: {
                  input: '$deals',
                  cond: {
                    $and: [
                      { $ne: ['$$this.status', 'completed'] },
                      {
                        $gt: [
                          {
                            $size: {
                              $filter: {
                                input: { $objectToArray: '$$this.invitationStatus' },
                                as: 'inv',
                                cond: {
                                  $and: [
                                    { $eq: ['$$inv.k', '$buyerIdStr'] },
                                    { $eq: ['$$inv.v.response', responseKey] }
                                  ]
                                }
                              }
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        { $match: { filteredDealsCount: { $gt: 0 } } }
      ];
      const totalBuyers = await this.buyerModel.aggregate(totalBuyersPipeline).count('count').exec();
      const totalCount = totalBuyers.length > 0 ? totalBuyers[0].count : 0;
      
      return {
        data: buyers.map((buyer: any) => ({
          ...buyer,
          companyProfile: buyer.companyProfileId,
          activeDealsCount: buyer.activeDealsCount,
          pendingDealsCount: buyer.pendingDealsCount,
          rejectedDealsCount: buyer.rejectedDealsCount
        })),
        total: totalCount,
        page,
        lastPage: Math.ceil(totalCount / limit),
      };
    }
    
    // Check if sorting by deal counts
    const isDealSort = sortBy && (sortBy.includes('activeDeals') || sortBy.includes('pendingDeals') || sortBy.includes('rejectedDeals'));
    
    if (isDealSort) {
      // Use aggregation for deal sorting
      const [field, order] = sortBy.split(':');
      const dealStatus = field === 'activeDeals' ? 'active' : field === 'pendingDeals' ? 'pending' : 'rejected';
      const sortOrder: 1 | -1 = order === 'desc' ? -1 : 1;
      const sortObj: Record<string, 1 | -1> = { dealCount: sortOrder, _id: 1 };
      
      const pipeline = [
        { $match: searchQuery },
        {
          $lookup: {
            from: 'deals',
            localField: '_id',
            foreignField: 'targetedBuyers',
            as: 'deals'
          }
        },
        {
          $addFields: {
            dealCount: {
              $size: {
                $filter: {
                  input: '$deals',
                  cond: {
                    $eq: ['$$this.status', dealStatus]
                  }
                }
              }
            }
          }
        },
        { $sort: sortObj },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: 'companyprofiles',
            localField: 'companyProfileId',
            foreignField: '_id',
            as: 'companyProfileId'
          }
        },
        {
          $addFields: {
            companyProfileId: { $arrayElemAt: ['$companyProfileId', 0] }
          }
        }
      ];
      
      const buyers = await this.buyerModel.aggregate(pipeline).exec();
      const totalBuyers = await this.buyerModel.countDocuments(searchQuery).exec();
      
      return {
        data: buyers.map((buyer: any) => ({
          ...buyer,
          companyProfile: buyer.companyProfileId,
        })),
        total: totalBuyers,
        page,
        lastPage: Math.ceil(totalBuyers / limit),
      };
    } else {
      // Regular sorting for other fields
      let sortQuery: any = { _id: 1 }; // Default stable sort
      if (sortBy && sortBy.includes(':')) {
        const [field, order] = sortBy.split(':');
        if (field && order) {
          sortQuery = { [field]: order === 'desc' ? -1 : 1, _id: 1 };
        }
      }

      const buyers = await this.buyerModel
        .find(searchQuery)
        .populate("companyProfileId")
        .sort(sortQuery)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec();

      const totalBuyers = await this.buyerModel.countDocuments(searchQuery).exec();

      return {
        data: buyers.map((buyer: any) => ({
          ...buyer,
          companyProfile: buyer.companyProfileId,
        })),
        total: totalBuyers,
        page,
        lastPage: Math.ceil(totalBuyers / limit),
      };
    }
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

    // Create a clean update object, removing fields that shouldn't be updated directly
    const updateData: any = { ...updateBuyerDto };

    // Remove read-only fields
    delete updateData._id;
    delete updateData.role;

    // Handle phoneNumber -> phone mapping (frontend uses phoneNumber, schema uses phone)
    if (updateData.phoneNumber !== undefined) {
      updateData.phone = updateData.phoneNumber;
      delete updateData.phoneNumber;
    }

    // Hash password if being updated, otherwise remove it to prevent overwriting
    if (updateData.password && updateData.password.trim() !== '') {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    } else {
      delete updateData.password;
    }

    // Remove undefined/null values to prevent overwriting existing data
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // Only update fields that are actually provided
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        buyer[key] = updateData[key];
      }
    });

    await buyer.save();

    // Sync to company profile if exists
    if (buyer.companyProfileId) {
      const companyProfile = await this.companyProfileModel.findById(buyer.companyProfileId).exec();
      if (companyProfile) {
        let profileUpdated = false;

        // Update company-level fields
        if (updateData.companyName) {
          companyProfile.companyName = updateData.companyName;
          profileUpdated = true;
        }
        if (updateData.website) {
          companyProfile.website = updateData.website;
          profileUpdated = true;
        }

        // Update first contact with buyer info
        if (updateData.fullName || updateData.email || updateData.phone) {
          if (!companyProfile.contacts || companyProfile.contacts.length === 0) {
            companyProfile.contacts = [{
              name: updateData.fullName || buyer.fullName || '',
              email: updateData.email || buyer.email || '',
              phone: updateData.phone || buyer.phone || ''
            }];
          } else {
            // Update first contact
            if (updateData.fullName) companyProfile.contacts[0].name = updateData.fullName;
            if (updateData.email) companyProfile.contacts[0].email = updateData.email;
            if (updateData.phone) companyProfile.contacts[0].phone = updateData.phone;
          }
          profileUpdated = true;
        }

        if (profileUpdated) {
          await companyProfile.save();
        }
      }
    }

    return buyer;
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
        "canotifications@amp-ven.com",
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
