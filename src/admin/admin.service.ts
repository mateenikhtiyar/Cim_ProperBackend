import { Injectable, ConflictException, NotFoundException } from "@nestjs/common"
import { InjectModel } from "@nestjs/mongoose"
import { Model } from "mongoose"
import * as bcrypt from "bcrypt"
import { Admin, type AdminDocument } from "./schemas/admin.schema"
import { CreateAdminDto } from "./dto/create-admin.dto"
import { CompanyProfile, type CompanyProfileDocument } from "../company-profile/schemas/company-profile.schema"
import { Buyer, type BuyerDocument } from "../buyers/schemas/buyer.schema"
import { UpdateCompanyProfileDto } from "../company-profile/dto/update-company-profile.dto"

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
    @InjectModel(CompanyProfile.name) private companyProfileModel: Model<CompanyProfileDocument>,
    @InjectModel(Buyer.name) private buyerModel: Model<BuyerDocument>,
  ) { }

  async create(createAdminDto: CreateAdminDto): Promise<Admin> {
    const { email, password } = createAdminDto

    const existingAdmin = await this.adminModel.findOne({ email }).exec()
    if (existingAdmin) {
      throw new ConflictException("Email already exists")
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const newAdmin = new this.adminModel({
      ...createAdminDto,
      password: hashedPassword,
      role: "admin",
    })

    return newAdmin.save()
  }

  async findByEmail(email: string): Promise<Admin> {
    const admin = await this.adminModel.findOne({ email }).exec()
    if (!admin) {
      throw new NotFoundException("Admin not found")
    }
    return admin
  }

  async findById(id: string): Promise<Admin> {
    const admin = await this.adminModel.findById(id).exec()
    if (!admin) {
      throw new NotFoundException("Admin not found")
    }
    return admin
  }

  // Company Profile Management
  async getAllCompanyProfiles(): Promise<CompanyProfile[]> {
    return this.companyProfileModel.find().exec()
  }

  async updateCompanyProfile(id: string, updateCompanyProfileDto: UpdateCompanyProfileDto): Promise<CompanyProfile> {
    const companyProfile = await this.companyProfileModel.findById(id).exec()
    if (!companyProfile) {
      throw new NotFoundException("Company profile not found")
    }

    Object.assign(companyProfile, updateCompanyProfileDto)
    return companyProfile.save()
  }

  async deleteCompanyProfile(id: string): Promise<void> {
    const result = await this.companyProfileModel.findByIdAndDelete(id).exec()
    if (!result) {
      throw new NotFoundException("Company profile not found")
    }
  }

  // Buyer Management
  async getAllBuyers(): Promise<Buyer[]> {
    return this.buyerModel.find().exec()
  }

  async deleteBuyer(id: string): Promise<void> {
    const result = await this.buyerModel.findByIdAndDelete(id).exec()
    if (!result) {
      throw new NotFoundException("Buyer not found")
    }

    // Also delete associated company profile
    await this.companyProfileModel.deleteMany({ buyer: id }).exec()
  }
}
