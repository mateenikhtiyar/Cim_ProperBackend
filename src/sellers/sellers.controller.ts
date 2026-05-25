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
  Logger,
  HttpStatus,
  UnauthorizedException,
  ForbiddenException,
  Query,
  BadRequestException,
} from "@nestjs/common";
import { getEffectiveUserId } from "../common/team-utils";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../decorators/roles.decorator";
import { SellersService } from "./sellers.service";
import { RegisterSellerDto } from "./dto/create-seller.dto";
import { AuthService } from "../auth/auth.service";
import { DealsService } from "../deals/deals.service";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { UpdateSellerDto } from "./dto/update-seller.dto";
import { Throttle } from "@nestjs/throttler";

const SELLER_AUTH_ENDPOINT_LIMIT_PER_MINUTE = 10000

@ApiTags("sellers")
@Controller("sellers")
export class SellersController {
  private readonly logger = new Logger(SellersController.name);

  constructor(
    private readonly sellersService: SellersService,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly dealsService: DealsService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: SELLER_AUTH_ENDPOINT_LIMIT_PER_MINUTE, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new seller' })
  @ApiResponse({ status: 201, description: 'Seller successfully registered' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() createSellerDto: RegisterSellerDto) {
    try {
      const seller = await this.sellersService.create(createSellerDto);
      const result = seller.toObject ? seller.toObject() : { ...seller };
      delete result.password;

      // Generate token for immediate login after registration
      const loginResult = await this.authService.loginSeller(seller);

      return {
        ...result,
        token: loginResult.access_token,
        userId: result._id?.toString() || result.id?.toString(),
      };
    } catch (error) {
      this.logger.error(`Registration error: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get("public/:id")
  @ApiOperation({ summary: "Get a seller by ID (public endpoint - no authentication required)" })
  @ApiParam({ name: "id", type: String, description: "Seller ID" })
  @ApiResponse({ status: 200, description: "Return the seller (without sensitive information)" })
  @ApiResponse({ status: 404, description: "Seller not found" })
  async getSellerPublic(@Param('id') id: string) {
    try {
      const seller = await this.sellersService.findById(id);
      const publicSellerInfo = {
        id: (seller as any)._id || (seller as any).id,
        fullName: seller.fullName,
        companyName: seller.companyName,
        profilePicture: seller.profilePicture,
        email: seller.email,
        phone: seller.phoneNumber,
        phoneNumber: seller.phoneNumber,
        role: seller.role,
        website: seller.website, // <-- Add this line
      };
      return publicSellerInfo;
    } catch (error) {
      this.logger.error(`Error finding seller publicly: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post("bulk")
  @ApiOperation({ summary: "Get public seller info for multiple seller IDs" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        sellerIds: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["sellerIds"],
    },
  })
  @ApiResponse({ status: 200, description: "Return public seller info list" })
  async getSellersPublicBulk(@Body() body: { sellerIds: string[] }) {
    const sellerIds = Array.isArray(body?.sellerIds) ? body.sellerIds : [];
    return this.sellersService.getPublicSellersByIds(sellerIds);
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
      return await this.sellersService.findById(getEffectiveUserId(req.user));
    } catch (error) {
      this.logger.error(`Error getting profile: ${error.message}`, error.stack);
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all sellers with deal counts (admin only)" })
  @ApiResponse({ status: 200, description: "Return all sellers with active and off-market deal counts" })
  @ApiResponse({ status: 400, description: "Bad request - failed to retrieve sellers" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  async findAll() {
    try {
      return await this.sellersService.findAll();
    } catch (error) {
      this.logger.error(`Error finding all sellers: ${error.message}`, error.stack);
      throw error;
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
      if (req.user?.role === "seller" && getEffectiveUserId(req.user) !== id) {
        return { message: "You can only view your own profile", statusCode: HttpStatus.FORBIDDEN };
      }
      return await this.sellersService.findById(id);
    } catch (error) {
      this.logger.error(`Error finding seller: ${error.message}`, error.stack);
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Patch("me")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update seller's own profile" })
  @ApiResponse({ status: 200, description: "Seller profile updated successfully" })
  @ApiResponse({ status: 400, description: "Bad request - validation failed" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async updateMyProfile(@Body() updateSellerDto: UpdateSellerDto, @Request() req: any) {
    try {
      if (!getEffectiveUserId(req.user)) {
        throw new UnauthorizedException("User not authenticated");
      }
      const sellerId = getEffectiveUserId(req.user);
      return await this.sellersService.update(sellerId, updateSellerDto);
    } catch (error) {
      this.logger.error(`Error updating seller profile: ${error.message}`, error.stack);
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin", "seller")
  @Patch(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a seller (admin can update any, seller can update own)" })
  @ApiParam({ name: "id", type: String, description: "Seller ID" })
  @ApiResponse({ status: 200, description: "Seller updated successfully" })
  @ApiResponse({ status: 400, description: "Bad request - validation failed" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin or seller role" })
  @ApiResponse({ status: 404, description: "Seller not found" })
  async update(@Param('id') id: string, @Body() updateSellerDto: UpdateSellerDto, @Request() req: any) {
    try {
      if (req.user?.role === "seller" && getEffectiveUserId(req.user) !== id) {
        throw new ForbiddenException("You can only update your own profile");
      }
      return await this.sellersService.update(id, updateSellerDto);
    } catch (error) {
      this.logger.error(`Error updating seller: ${error.message}`, error.stack);
      throw error;
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
      if (!getEffectiveUserId(req.user)) {
        throw new UnauthorizedException("User not authenticated");
      }
      const sellerId = getEffectiveUserId(req.user);
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
      if (!getEffectiveUserId(req.user)) {
        throw new UnauthorizedException("User not authenticated");
      }
      const sellerId = getEffectiveUserId(req.user);
      const deal = await this.dealsService.findOne(dealId);
      if (deal.seller.toString() !== sellerId) {
        throw new ForbiddenException("You don't have permission to view interactions for this deal");
      }
      return await this.dealsService.getBuyerInteractionsForDeal(dealId);
    } catch (error) {
      this.logger.error(`Error getting deal buyer interactions: ${error.message}`, error.stack);
      throw error;
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
      if (!getEffectiveUserId(req.user)) {
        throw new UnauthorizedException("User not authenticated");
      }
      const sellerId = getEffectiveUserId(req.user);
      const deal = await this.dealsService.findOne(dealId);
      if (deal.seller.toString() !== sellerId) {
        throw new ForbiddenException("You don't have permission to view this deal's status");
      }
      return await this.dealsService.getDealWithBuyerStatusSummary(dealId);
    } catch (error) {
      this.logger.error(`Error getting deal status summary: ${error.message}`, error.stack);
      throw error;
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
      if (!getEffectiveUserId(req.user)) {
        throw new UnauthorizedException("User not authenticated");
      }
      const sellerId = getEffectiveUserId(req.user);
      const deal = await this.dealsService.findOne(dealId);
      if (deal.seller.toString() !== sellerId) {
        throw new ForbiddenException("You don't have permission to view this deal's activity");
      }
      return await this.dealsService.getDetailedBuyerActivity(dealId);
    } catch (error) {
      this.logger.error(`Error getting deal buyer activity: ${error.message}`, error.stack);
      throw error;
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
      if (!getEffectiveUserId(req.user)) {
        throw new UnauthorizedException("User not authenticated");
      }
      const sellerId = getEffectiveUserId(req.user);
      return await this.dealsService.getRecentBuyerActionsForSeller(sellerId, limit);
    } catch (error) {
      this.logger.error(`Error getting recent buyer actions: ${error.message}`, error.stack);
      throw error;
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
      if (!getEffectiveUserId(req.user)) {
        throw new UnauthorizedException("User not authenticated");
      }
      const sellerId = getEffectiveUserId(req.user);
      const deal = await this.dealsService.findOne(dealId);
      if (deal.seller.toString() !== sellerId) {
        throw new ForbiddenException("You don't have permission to view this deal's interested buyers");
      }
      return await this.dealsService.getInterestedBuyersDetails(dealId);
    } catch (error) {
      this.logger.error(`Error getting interested buyers: ${error.message}`, error.stack);
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "admin")
  @Post("deals/:dealId/interested-buyers/:buyerId/flag-inactive")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Flag a specific interested buyer as inactive for a deal" })
  @ApiParam({ name: "dealId", type: String, description: "Deal ID" })
  @ApiParam({ name: "buyerId", type: String, description: "Buyer ID" })
  @ApiResponse({ status: 200, description: "Buyer flagged as inactive" })
  async flagInterestedBuyerInactive(
    @Param('dealId') dealId: string,
    @Param('buyerId') buyerId: string,
    @Request() req: any,
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }

    const sellerId = getEffectiveUserId(req.user);
    const deal = await this.dealsService.findOne(dealId);
    if (req.user.role !== 'admin' && deal.seller.toString() !== sellerId) {
      throw new ForbiddenException("You don't have permission to modify this deal");
    }

    const updatedDeal = await this.dealsService.flagInterestedBuyerInactive(
      dealId,
      buyerId,
      req.user.role === 'admin' ? 'admin' : 'seller',
    );

    return {
      message: 'Buyer flagged as inactive successfully',
      deal: updatedDeal,
    };
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
      if (!getEffectiveUserId(req.user)) {
        throw new UnauthorizedException("User not authenticated");
      }
      const sellerId = getEffectiveUserId(req.user);
      return await this.dealsService.getBuyerEngagementDashboard(sellerId);
    } catch (error) {
      this.logger.error(`Error getting buyer engagement dashboard: ${error.message}`, error.stack);
      throw error;
    }
  }

  // Base64 profile picture upload endpoint
  @UseGuards(JwtAuthGuard)
  @Post("upload-profile-picture")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Upload profile picture as base64" })
  @ApiResponse({ status: 200, description: "Profile picture uploaded successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async uploadProfilePicture(
    @Request() req: any,
    @Body() body: { profilePicture: string }
  ) {
    const sellerId = getEffectiveUserId(req.user);
    if (!sellerId) {
      throw new UnauthorizedException('User not authenticated');
    }

    if (!body.profilePicture) {
      return { error: "No profile picture data provided" };
    }

    // Validate base64 image format
    if (!body.profilePicture.startsWith('data:image/')) {
      return { error: "Invalid image format. Please provide a valid base64 image." };
    }

    try {
      await this.sellersService.updateProfilePicture(sellerId, body.profilePicture);
      return {
        message: "Profile picture uploaded successfully",
        profilePicture: body.profilePicture
      };
    } catch (error) {
      this.logger.error(`Error updating profile picture: ${error.message}`, error.stack);
      return { error: "Failed to update profile picture" };
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
    @Body() body: { finalSalePrice?: number; notes?: string; winningBuyerId?: string; buyerFromCIM?: boolean } = {},
    @Request() req: any,
  ) {
    try {
      this.logger.debug(`Attempting to close deal ${dealId}`);
      if (!getEffectiveUserId(req.user)) {
        throw new UnauthorizedException("User not authenticated");
      }
      const sellerId = getEffectiveUserId(req.user);
      this.logger.debug(`Seller ID: ${sellerId}`);
      if (!dealId.match(/^[0-9a-fA-F]{24}$/)) {
        throw new BadRequestException("Invalid deal ID format");
      }
      this.logger.debug(`Calling dealsService.closeDealseller with params:`, {
        dealId,
        sellerId,
        finalSalePrice: body.finalSalePrice,
        notes: body.notes,
        winningBuyerId: body.winningBuyerId,
        buyerFromCIM: body.buyerFromCIM,
      });
      const closedDeal = await this.dealsService.closeDealseller(
        dealId,
        sellerId,
        body.finalSalePrice,
        body.notes,
        body.winningBuyerId,
        undefined,
        body.buyerFromCIM,
      );
      return {
        message: "Deal closed successfully",
        deal: closedDeal,
      };
    } catch (error) {
      this.logger.error(`Error closing deal: ${error.message}`, error.stack);
      throw error;
    }
  }
}
