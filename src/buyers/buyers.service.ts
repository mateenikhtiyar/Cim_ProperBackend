import { Injectable, ConflictException, NotFoundException } from "@nestjs/common"
import { Model } from "mongoose"
import * as bcrypt from "bcrypt"
import { Buyer, BuyerDocument } from "./schemas/buyer.schema"
import { CreateBuyerDto } from "./dto/create-buyer.dto"
import { UpdateBuyerDto } from "./dto/update-buyer.dto"
import { InjectModel } from "@nestjs/mongoose"

@Injectable()
export class BuyersService {
  // private buyerModel: Model<BuyerDocument>

  constructor(
    @InjectModel(Buyer.name) private buyerModel: Model<BuyerDocument>
  ) {}

  async create(createBuyerDto: CreateBuyerDto): Promise<Buyer> {
    const { email, password } = createBuyerDto

    const existingBuyer = await this.buyerModel.findOne({ email }).exec()
    if (existingBuyer) {
      throw new ConflictException("Email already exists")
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const newBuyer = new this.buyerModel({
      ...createBuyerDto,
      password: hashedPassword,
    })

    return newBuyer.save()
  }

  async findAll(): Promise<Buyer[]> {
    return this.buyerModel.find().exec()
  }

  async findOne(id: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findById(id).exec()
    if (!buyer) {
      throw new NotFoundException("Buyer not found")
    }
    return buyer
  }

  async findByEmail(email: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findOne({ email }).exec()
    if (!buyer) {
      throw new NotFoundException("Buyer not found")
    }
    return buyer
  }

  async findById(id: string): Promise<Buyer> {
    const buyer = await this.buyerModel.findById(id).exec()
    if (!buyer) {
      throw new NotFoundException("Buyer not found")
    }
    return buyer
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

      buyer = await newBuyer.save()
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
