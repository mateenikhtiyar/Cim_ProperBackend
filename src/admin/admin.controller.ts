import { Controller, Get, Post, Body, UseGuards, Request, Param, Delete, Patch, Query } from "@nestjs/common"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { AdminService } from "./admin.service"
import { CreateAdminDto } from "./dto/create-admin.dto"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery } from "@nestjs/swagger"
import { CompanyProfileService } from "../company-profile/company-profile.service"
import { BuyersService } from "../buyers/buyers.service"
import { UpdateCompanyProfileDto } from "../company-profile/dto/update-company-profile.dto"
import { UnauthorizedException } from "@nestjs/common"
import { SellersService } from "../sellers/sellers.service"

interface RequestWithUser extends Request {
  user: {
    userId: string
    email: string
    role: string
  }
}

@ApiTags("admin")
@Controller("admin")
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly companyProfileService: CompanyProfileService,
    private readonly buyersService: BuyersService,
    private readonly sellersService: SellersService,
  ) { }

  @Post('register')
  @ApiOperation({ summary: 'Register a new admin (protected operation)' })
  @ApiResponse({ status: 201, description: 'Admin successfully registered' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() createAdminDto: CreateAdminDto) {
    const admin = await this.adminService.create(createAdminDto);
    const result = admin.toObject ? admin.toObject() : { ...admin };
    delete result.password;
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get admin profile' })
  @ApiResponse({ status: 200, description: 'Admin profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getProfile(@Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.adminService.findById(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update admin profile' })
  @ApiResponse({ status: 200, description: 'Admin profile updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateProfile(@Request() req: RequestWithUser, @Body() update: any) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    const updated = await this.adminService.updateProfile(req.user.userId, update);
    const result = updated.toObject ? updated.toObject() : { ...updated };
    delete result.password;
    return result;
  }

  // Company Profile Management for Admins
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("company-profiles")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all company profiles (admin only)" })
  @ApiResponse({ status: 200, description: "Return all company profiles" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  async getAllCompanyProfiles() {
    return this.adminService.getAllCompanyProfiles()
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('company-profiles/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a company profile by ID (admin only)' })
  @ApiParam({ name: 'id', type: String, description: 'Company profile ID' })
  @ApiResponse({ status: 200, description: 'Return the company profile' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  @ApiResponse({ status: 404, description: 'Company profile not found' })
  async getCompanyProfile(@Param('id') id: string) {
    return this.companyProfileService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Patch("company-profiles/:id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a company profile (admin only)" })
  @ApiParam({ name: "id", type: String, description: "Company profile ID" })
  @ApiResponse({ status: 200, description: "Company profile updated successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  @ApiResponse({ status: 404, description: "Company profile not found" })
  async updateCompanyProfile(@Param('id') id: string, @Body() updateCompanyProfileDto: UpdateCompanyProfileDto) {
    return this.adminService.updateCompanyProfile(id, updateCompanyProfileDto)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete('company-profiles/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a company profile (admin only)' })
  @ApiParam({ name: 'id', type: String, description: 'Company profile ID' })
  @ApiResponse({ status: 200, description: 'Company profile deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  @ApiResponse({ status: 404, description: 'Company profile not found' })
  async deleteCompanyProfile(@Param('id') id: string) {
    await this.adminService.deleteCompanyProfile(id);
    return { message: 'Company profile deleted successfully' };
  }

  // Buyer Management for Admins
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("buyers")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all buyers (admin only)" })
  @ApiResponse({ status: 200, description: "Return all buyers" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number for pagination' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of items per page' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search term' })
  @ApiQuery({ name: 'sortBy', required: false, type: String, description: 'Sort by field:order (e.g., companyName:asc)' })
  @ApiQuery({ name: 'dealStatus', required: false, type: String, description: 'Filter by deal status (active, pending, rejected)' })
  async getAllBuyers(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search: string = '',
    @Query('sortBy') sortBy: string = '',
    @Query('dealStatus') dealStatus: string = '',
  ) {
    return this.adminService.getAllBuyers(page, limit, search, sortBy, dealStatus)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("buyers/incomplete-profiles")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get buyers with incomplete profiles (admin only)" })
  @ApiResponse({ status: 200, description: "Return buyers with incomplete profiles" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number for pagination' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of items per page' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search term' })
  async getBuyersWithIncompleteProfiles(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search: string = '',
  ) {
    return this.adminService.getBuyersWithIncompleteProfiles(page, limit, search)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('buyers/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a buyer by ID (admin only)' })
  @ApiParam({ name: 'id', type: String, description: 'Buyer ID' })
  @ApiResponse({ status: 200, description: 'Return the buyer' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  @ApiResponse({ status: 404, description: 'Buyer not found' })
  async getBuyer(@Param('id') id: string) {
    return this.buyersService.findById(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete('buyers/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a buyer (admin only)' })
  @ApiParam({ name: 'id', type: String, description: 'Buyer ID' })
  @ApiResponse({ status: 200, description: 'Buyer deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  @ApiResponse({ status: 404, description: 'Buyer not found' })
  async deleteBuyer(@Param('id') id: string) {
    await this.adminService.deleteBuyer(id);
    return { message: 'Buyer deleted successfully' };
  }

  // Seller Management for Admins
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("sellers")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all sellers (admin only)" })
  @ApiResponse({ status: 200, description: "Return all sellers" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number for pagination' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of items per page' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search term' })
  @ApiQuery({ name: 'sortBy', required: false, type: String, description: 'Sort by field:order (e.g., companyName:asc)' })
  async getAllSellers(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search: string = '',
    @Query('sortBy') sortBy: string = '',
    @Query('activeOnly') activeOnly: string = '',
  ) {
    return this.adminService.getAllSellers(page, limit, search, sortBy, activeOnly)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('sellers/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a seller by ID (admin only)' })
  @ApiParam({ name: 'id', type: String, description: 'Seller ID' })
  @ApiResponse({ status: 200, description: 'Return the seller' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  @ApiResponse({ status: 404, description: 'Seller not found' })
  async getSeller(@Param('id') id: string) {
    return this.sellersService.findById(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete('sellers/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a seller (admin only)' })
  @ApiParam({ name: 'id', type: String, description: 'Seller ID' })
  @ApiResponse({ status: 200, description: 'Seller deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  @ApiResponse({ status: 404, description: 'Seller not found' })
  async deleteSeller(@Param('id') id: string) {
    await this.adminService.deleteSeller(id);
    return { message: 'Seller deleted successfully' };
  }


}
