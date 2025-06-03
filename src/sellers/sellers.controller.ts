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
  Res,
  Logger,
  HttpStatus,
  UnauthorizedException,
  ForbiddenException,
  Query,
  BadRequestException,
} from "@nestjs/common"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { SellersService } from "./sellers.service"
import { RegisterSellerDto } from "./dto/create-seller.dto"
import { SellerGoogleAuthGuard } from "../auth/guards/seller-google-auth.guard"
import { AuthService } from "../auth/auth.service"
import { DealsService } from "../deals/deals.service"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery } from "@nestjs/swagger"
import { GoogleSellerLoginResult } from "../auth/interfaces/google-seller-login-result.interface"
import { Response } from "express"
import { ConfigService } from "@nestjs/config"

interface UpdateSellerDto {
  fullName?: string
  email?: string
  companyName?: string
  password?: string
}

@ApiTags("sellers")
@Controller("sellers")
export class SellersController {
  private readonly logger = new Logger(SellersController.name)

  constructor(
    private readonly sellersService: SellersService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly dealsService: DealsService, // Make sure this is properly injected
  ) { }

  @Post('register')
  @ApiOperation({ summary: 'Register a new seller' })
  @ApiResponse({ status: 201, description: 'Seller successfully registered' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() createSellerDto: RegisterSellerDto): Promise<Omit<RegisterSellerDto, 'password'>> {
    try {
      const seller = await this.sellersService.create(createSellerDto);
      // Convert to object and remove password
      const result = seller.toObject ? seller.toObject() : { ...seller };
      delete result.password;
      return result;
    } catch (error) {
      this.logger.error(`Registration error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get("google")
  @UseGuards(SellerGoogleAuthGuard)
  @ApiOperation({ summary: "Initiate Google OAuth login for sellers" })
  @ApiResponse({ status: 302, description: "Redirects to Google OAuth" })
  googleAuth() {
    // This route initiates Google OAuth flow
    // The guard handles the redirect to Google
  }

  @Get("google/callback")
  @UseGuards(SellerGoogleAuthGuard)
  @ApiOperation({ summary: "Google OAuth callback for sellers" })
  @ApiResponse({ status: 302, description: "Redirects to frontend with token" })
  async googleAuthCallback(@Request() req, @Res() res: Response) {
    try {
      if (!req.user) {
        this.logger.warn("No user found in request after Google authentication")
        const frontendUrl = this.configService.get<string>("FRONTEND_URL")
        return res.redirect(`${frontendUrl}/auth/error?message=Authentication failed`)
      }

      // Log the user data received from Google
      this.logger.debug(`Google auth data: ${JSON.stringify(req.user)}`)

      // Process the login with Google data
      const loginResult = (await this.authService.loginSellerWithGoogle(req.user)) as GoogleSellerLoginResult

      // Get the frontend URL from environment variables
      const frontendUrl = this.configService.get<string>("FRONTEND_URL")

      // Determine the redirect path based on whether this is a new user
      const redirectPath = loginResult.isNewUser ? "seller/login" : "/seller/login"

      // Use a fallback if _id is undefined
      const userId = loginResult.user._id || (loginResult.user as any).id || "missing-id"

      // Construct the redirect URL with query parameters
      const redirectUrl = `${frontendUrl}${redirectPath}?token=${loginResult.access_token}&userId=${userId}&role=seller`

      this.logger.debug(`Redirecting to: ${redirectUrl}`)
      return res.redirect(redirectUrl)
    } catch (error) {
      this.logger.error(`Google callback error: ${error.message}`, error.stack)
      const frontendUrl = this.configService.get<string>("FRONTEND_URL")
      return res.redirect(
        `${frontendUrl}/auth/error?message=${encodeURIComponent(error.message || "Authentication failed")}`,
      )
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get seller profile' })
  @ApiResponse({ status: 200, description: 'Seller profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@Request() req: any) {
    try {
      return await this.sellersService.findById(req.user?.userId || req.user?.sub);
    } catch (error) {
      this.logger.error(`Error getting profile: ${error.message}`, error.stack);
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all sellers (admin only)" })
  @ApiResponse({ status: 200, description: "Return all sellers" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  async findAll() {
    try {
      return await this.sellersService.findAll()
    } catch (error) {
      this.logger.error(`Error finding all sellers: ${error.message}`, error.stack)
      throw error
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin", "seller")
  @Get(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a seller by ID" })
  @ApiParam({ name: "id", type: String, description: "Seller ID" })
  @ApiResponse({ status: 200, description: "Return the seller" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin or seller role" })
  @ApiResponse({ status: 404, description: "Seller not found" })
  async findOne(@Param('id') id: string, @Request() req: any) {
    try {
      // If seller, can only view own profile
      if (req.user?.role === "seller" && req.user?.userId !== id && req.user?.sub !== id) {
        return { message: "You can only view your own profile", statusCode: HttpStatus.FORBIDDEN }
      }
      return await this.sellersService.findById(id)
    } catch (error) {
      this.logger.error(`Error finding seller: ${error.message}`, error.stack)
      throw error
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin", "seller")
  @Patch(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a seller" })
  @ApiParam({ name: "id", type: String, description: "Seller ID" })
  @ApiResponse({ status: 200, description: "Seller updated successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin or seller role" })
  @ApiResponse({ status: 404, description: "Seller not found" })
  async update(@Param('id') id: string, @Body() updateSellerDto: UpdateSellerDto, @Request() req: any) {
    try {
      // If seller, can only update own profile
      if (req.user?.role === "seller" && req.user?.userId !== id && req.user?.sub !== id) {
        return { message: "You can only update your own profile", statusCode: HttpStatus.FORBIDDEN }
      }
      return await this.sellersService.update(id, updateSellerDto)
    } catch (error) {
      this.logger.error(`Error updating seller: ${error.message}`, error.stack)
      throw error
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a seller (admin only)' })
  @ApiParam({ name: 'id', type: String, description: 'Seller ID' })
  @ApiResponse({ status: 200, description: 'Seller deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  @ApiResponse({ status: 404, description: 'Seller not found' })
  async remove(@Param('id') id: string) {
    try {
      await this.sellersService.remove(id);
      return { message: "Seller deleted successfully" };
    } catch (error) {
      this.logger.error(`Error removing seller: ${error.message}`, error.stack);
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Get('deals/history')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get deal history for the seller' })
  @ApiResponse({ status: 200, description: 'Return deal history' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getDealHistory(@Request() req: any) {
    try {
      if (!req.user?.userId && !req.user?.sub) {
        throw new UnauthorizedException("User not authenticated");
      }

      // Get the seller ID from the JWT token
      const sellerId = req.user?.userId || req.user?.sub;

      // Use the injected DealsService directly
      return await this.dealsService.getDealHistory(sellerId);
    } catch (error) {
      this.logger.error(`Error getting deal history: ${error.message}`, error.stack);
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("deals/:dealId/buyer-interactions")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get buyer interactions for a specific deal" })
  @ApiParam({ name: "dealId", type: String, description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return buyer interactions for the deal" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - not your deal" })
  async getDealBuyerInteractions(@Param('dealId') dealId: string, @Request() req: any) {
    try {
      if (!req.user?.userId && !req.user?.sub) {
        throw new UnauthorizedException("User not authenticated")
      }

      const sellerId = req.user?.userId || req.user?.sub

      // First verify the seller owns this deal
      const deal = await this.dealsService.findOne(dealId)
      if (deal.seller.toString() !== sellerId) {
        throw new ForbiddenException("You don't have permission to view interactions for this deal")
      }

      return await this.dealsService.getBuyerInteractions(dealId)
    } catch (error) {
      this.logger.error(`Error getting deal buyer interactions: ${error.message}`, error.stack)
      throw error
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("deals/:dealId/status-summary")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get deal status summary with buyer breakdown" })
  @ApiParam({ name: "dealId", type: String, description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return deal status summary" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - not your deal" })
  async getDealStatusSummary(@Param('dealId') dealId: string, @Request() req: any) {
    try {
      if (!req.user?.userId && !req.user?.sub) {
        throw new UnauthorizedException("User not authenticated")
      }

      const sellerId = req.user?.userId || req.user?.sub

      // First verify the seller owns this deal
      const deal = await this.dealsService.findOne(dealId)
      if (deal.seller.toString() !== sellerId) {
        throw new ForbiddenException("You don't have permission to view this deal's status")
      }

      return await this.dealsService.getDealWithBuyerStatus(dealId)
    } catch (error) {
      this.logger.error(`Error getting deal status summary: ${error.message}`, error.stack)
      throw error
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("deals/:dealId/buyer-activity")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get detailed buyer activity for a specific deal" })
  @ApiParam({ name: "dealId", type: String, description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return detailed buyer activity" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - not your deal" })
  async getDealBuyerActivity(@Param('dealId') dealId: string, @Request() req: any) {
    try {
      if (!req.user?.userId && !req.user?.sub) {
        throw new UnauthorizedException("User not authenticated")
      }

      const sellerId = req.user?.userId || req.user?.sub

      // First verify the seller owns this deal
      const deal = await this.dealsService.findOne(dealId)
      if (deal.seller.toString() !== sellerId) {
        throw new ForbiddenException("You don't have permission to view this deal's activity")
      }

      return await this.dealsService.getDetailedBuyerActivity(dealId)
    } catch (error) {
      this.logger.error(`Error getting deal buyer activity: ${error.message}`, error.stack)
      throw error
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("deals/recent-buyer-actions")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get recent buyer actions across all seller's deals" })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Number of recent actions to return (default: 20)",
  })
  @ApiResponse({ status: 200, description: "Return recent buyer actions" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getRecentBuyerActions(@Request() req: any, @Query('limit') limit: number = 20) {
    try {
      if (!req.user?.userId && !req.user?.sub) {
        throw new UnauthorizedException("User not authenticated")
      }

      const sellerId = req.user?.userId || req.user?.sub
      return await this.dealsService.getRecentBuyerActionsForSeller(sellerId, limit)
    } catch (error) {
      this.logger.error(`Error getting recent buyer actions: ${error.message}`, error.stack)
      throw error
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("deals/:dealId/interested-buyers")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get list of buyers who showed interest in a deal" })
  @ApiParam({ name: "dealId", type: String, description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return interested buyers" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - not your deal" })
  async getInterestedBuyers(@Param('dealId') dealId: string, @Request() req: any) {
    try {
      if (!req.user?.userId && !req.user?.sub) {
        throw new UnauthorizedException("User not authenticated")
      }

      const sellerId = req.user?.userId || req.user?.sub

      // First verify the seller owns this deal
      const deal = await this.dealsService.findOne(dealId)
      if (deal.seller.toString() !== sellerId) {
        throw new ForbiddenException("You don't have permission to view this deal's interested buyers")
      }

      return await this.dealsService.getInterestedBuyersDetails(dealId)
    } catch (error) {
      this.logger.error(`Error getting interested buyers: ${error.message}`, error.stack)
      throw error
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("dashboard/buyer-engagement")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get buyer engagement dashboard for seller" })
  @ApiResponse({ status: 200, description: "Return buyer engagement metrics" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getBuyerEngagementDashboard(@Request() req: any) {
    try {
      if (!req.user?.userId && !req.user?.sub) {
        throw new UnauthorizedException("User not authenticated")
      }

      const sellerId = req.user?.userId || req.user?.sub
      return await this.dealsService.getBuyerEngagementDashboard(sellerId)
    } catch (error) {
      this.logger.error(`Error getting buyer engagement dashboard: ${error.message}`, error.stack)
      throw error
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Post("deals/:dealId/close")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Close a deal" })
  @ApiParam({ name: "dealId", type: String, description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Deal closed successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - not your deal" })
  @ApiResponse({ status: 404, description: "Deal not found" })
  async closeDeal(
    @Param('dealId') dealId: string,
    @Body() body: { finalSalePrice?: number; notes?: string; winningBuyerId?: string } = {},
    @Request() req: any,
  ) {
    try {
      this.logger.debug(`Attempting to close deal ${dealId}`)

      if (!req.user?.userId && !req.user?.sub) {
        throw new UnauthorizedException("User not authenticated")
      }

      const sellerId = req.user?.userId || req.user?.sub
      this.logger.debug(`Seller ID: ${sellerId}`)

      // Validate dealId format
      if (!dealId.match(/^[0-9a-fA-F]{24}$/)) {
        throw new BadRequestException("Invalid deal ID format")
      }

      this.logger.debug(`Calling dealsService.closeDealseller with params:`, {
        dealId,
        sellerId,
        finalSalePrice: body.finalSalePrice,
        notes: body.notes,
        winningBuyerId: body.winningBuyerId,
      })

      const closedDeal = await this.dealsService.closeDealseller(
        dealId,
        sellerId,
        body.finalSalePrice,
        body.notes,
        body.winningBuyerId,
      )

      return {
        message: "Deal closed successfully",
        deal: closedDeal,
      }
    } catch (error) {
      this.logger.error(`Error closing deal: ${error.message}`, error.stack)
      throw error
    }
  }
}