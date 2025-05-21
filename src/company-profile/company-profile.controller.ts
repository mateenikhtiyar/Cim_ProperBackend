import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  NotFoundException,
  UnauthorizedException,
  Query,
} from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery } from "@nestjs/swagger"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { CompanyProfileService } from "./company-profile.service"
import { CreateCompanyProfileDto } from "./dto/create-company-profile.dto"
import { UpdateCompanyProfileDto } from "./dto/update-company-profile.dto"

interface RequestWithUser extends Request {
  user: {
    userId: string
    email: string
    role: string
  }
}

@ApiTags("company-profiles")
@Controller("company-profiles")
export class CompanyProfileController {
  constructor(private readonly companyProfileService: CompanyProfileService) { }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new company profile" })
  @ApiResponse({ status: 201, description: "Company profile created successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires buyer role" })
  async create(@Request() req: RequestWithUser, @Body() createCompanyProfileDto: CreateCompanyProfileDto) {
    return this.companyProfileService.create(req.user.userId, createCompanyProfileDto)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer", "admin")
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all company profiles (admin) or filtered by buyer ID" })
  @ApiQuery({ name: "buyerId", required: false, description: "Filter by buyer ID" })
  @ApiResponse({ status: 200, description: "Return company profiles" })
  @ApiResponse({ status: 403, description: "Forbidden - requires buyer or admin role" })
  async findAll(@Request() req: RequestWithUser, @Query('buyerId') buyerId?: string) {
    if (req.user.role === "admin") {
      if (buyerId) {
        return this.companyProfileService.findByBuyerId(buyerId)
      }
      return this.companyProfileService.findAll()
    }
    return this.companyProfileService.findByBuyerId(req.user.userId)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('buyer')
  @Get('my-profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current buyer\'s company profile' })
  @ApiResponse({ status: 200, description: 'Return the company profile' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires buyer role' })
  @ApiResponse({ status: 404, description: 'Company profile not found' })
  async findMyProfile(@Request() req: RequestWithUser) {
    try {
      return await this.companyProfileService.findByBuyerId(req.user.userId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { exists: false, message: 'Company profile not created yet' };
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer", "admin")
  @Get(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a company profile by ID" })
  @ApiParam({ name: "id", type: String, description: "Company profile ID" })
  @ApiResponse({ status: 200, description: "Return the company profile" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin or buyer role" })
  @ApiResponse({ status: 404, description: "Company profile not found" })
  async findOne(@Param('id') id: string, @Request() req: RequestWithUser) {
    const profile = await this.companyProfileService.findOne(id)
    if (req.user.role === "admin") {
      return profile
    }
    if (profile.buyer.toString() !== req.user.userId) {
      throw new UnauthorizedException("You do not have permission to view this profile")
    }
    return profile
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer", "admin")
  @Patch(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a company profile" })
  @ApiParam({ name: "id", type: String, description: "Company profile ID" })
  @ApiResponse({ status: 200, description: "Company profile updated successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires buyer role or profile ownership" })
  @ApiResponse({ status: 404, description: "Company profile not found" })
  async update(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
    @Body() updateCompanyProfileDto: UpdateCompanyProfileDto,
  ) {
    if (req.user.role === "admin") {
      return this.companyProfileService.updateByAdmin(id, updateCompanyProfileDto)
    }
    return this.companyProfileService.update(id, req.user.userId, updateCompanyProfileDto)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer", "admin")
  @Delete(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a company profile" })
  @ApiParam({ name: "id", type: String, description: "Company profile ID" })
  @ApiResponse({ status: 200, description: "Company profile deleted successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role or profile ownership" })
  @ApiResponse({ status: 404, description: "Company profile not found" })
  async remove(@Param('id') id: string, @Request() req: RequestWithUser) {
    if (req.user.role === "admin") {
      await this.companyProfileService.removeByAdmin(id)
    } else {
      await this.companyProfileService.remove(id, req.user.userId)
    }
    return { message: "Company profile deleted successfully" }
  }
}