import {
  Controller,
  Post,
  UseGuards,
  Get,
  Request,
  Query,
  UnauthorizedException,
  ForbiddenException,
  Patch,
  Param,
  Delete,
  Body,
  Logger,
} from "@nestjs/common"
import { getEffectiveUserId } from "../common/team-utils"
import { BuyersService } from "./buyers.service"
import { CreateBuyerDto } from "./dto/create-buyer.dto"
import { LocalAuthGuard } from "../auth/guards/local-auth.guard"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { AuthService } from "../auth/auth.service"
import { LoginBuyerDto } from "./dto/login-buyer.dto"
import { DealsService } from "../deals/deals.service"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiBody, ApiQuery, ApiParam } from "@nestjs/swagger"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { UpdateBuyerDto } from "./dto/update-buyer.dto"
import { Throttle } from "@nestjs/throttler"

interface RequestWithUser extends Request {
  user?: {
    userId: string
    email: string
    role: string
  }
}

@ApiTags("buyers")
@Controller("buyers")
export class BuyersController {
  private readonly logger = new Logger(BuyersController.name);

  constructor(
    private readonly buyersService: BuyersService,
    private readonly authService: AuthService,
    private readonly dealsService: DealsService,
  ) { }

  @Post("register")
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  @ApiOperation({ summary: "Register a new buyer" })
  @ApiResponse({ status: 201, description: "Buyer successfully registered" })
  @ApiResponse({ status: 409, description: "Email already exists" })
  @ApiBody({ type: CreateBuyerDto })
  async register(@Body() createBuyerDto: CreateBuyerDto) {
    try {
      const buyer = await this.buyersService.create(createBuyerDto)
      const result = buyer?.toObject ? buyer.toObject() : { ...buyer }
      delete result.password

      // Generate token for immediate login after registration
      const loginResult = await this.authService.login(buyer)

      return {
        ...result,
        token: loginResult.access_token,
        userId: result._id?.toString() || result.id?.toString(),
      }
    } catch (error) {
      this.logger.error("Registration error:", error instanceof Error ? error.message : error)
      throw error
    }
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  @ApiOperation({ summary: 'Login a buyer' })
  @ApiResponse({ status: 200, description: 'Buyer successfully logged in' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: LoginBuyerDto })
  async login(@Request() req: any) {
    return this.authService.login(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get buyer profile' })
  @ApiResponse({ status: 200, description: 'Buyer profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getProfile(@Request() req: any) {
    return this.buyersService.findById(getEffectiveUserId(req.user));
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
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }

    if (!body.profilePicture) {
      return { error: "No profile picture data provided" };
    }

    // Validate base64 image format
    if (!body.profilePicture.startsWith('data:image/')) {
      return { error: "Invalid image format. Please provide a valid base64 image." };
    }

    try {
      await this.buyersService.updateProfilePicture(getEffectiveUserId(req.user), body.profilePicture);
      return {
        message: "Profile picture uploaded successfully",
        profilePicture: body.profilePicture
      };
    } catch (error) {
      this.logger.error("Error updating profile picture:", error instanceof Error ? error.message : error);
      return { error: "Failed to update profile picture" };
    }
  }

  // Alternative base64 profile picture upload endpoint
  @UseGuards(JwtAuthGuard)
  @Post("profile/picture")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Upload profile picture as base64 (alternative endpoint)" })
  @ApiResponse({ status: 200, description: "Profile picture uploaded successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async uploadProfilePictureAlt(
    @Request() req: any,
    @Body() body: { profilePicture: string }
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }

    if (!body.profilePicture) {
      return { error: "No profile picture data provided" };
    }

    // Validate base64 image format
    if (!body.profilePicture.startsWith('data:image/')) {
      return { error: "Invalid image format. Please provide a valid base64 image." };
    }

    try {
      await this.buyersService.updateProfilePicture(getEffectiveUserId(req.user), body.profilePicture);
      return {
        message: "Profile picture uploaded successfully",
        profilePicture: body.profilePicture
      };
    } catch (error) {
      this.logger.error("Error updating profile picture:", error instanceof Error ? error.message : error);
      return { error: "Failed to update profile picture" };
    }
  }

  // IMPORTANT: Put specific routes BEFORE parameterized routes
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("all")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all buyers (Admin only)" })
  @ApiResponse({ status: 200, description: "Return all buyers." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  findAll() {
    return this.buyersService.findAll()
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Get("me")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get buyer profile" })
  @ApiResponse({ status: 200, description: "Return buyer profile." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  getProfileOld(@Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.buyersService.findOne(getEffectiveUserId(req.user));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Get("deals")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all deals for the buyer" })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["pending", "active", "rejected"],
    description: "Filter deals by status",
  })
  @ApiQuery({
    name: "page",
    required: false,
    type: Number,
    description: "Page number for pagination",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Number of deals per page",
  })
  @ApiResponse({ status: 200, description: "Return deals for the buyer" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getBuyerDeals(@Request() req: RequestWithUser, @Query('status') status?: 'pending' | 'active' | 'rejected') {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }

    try {
      return await this.dealsService.getBuyerDeals(getEffectiveUserId(req.user))
    } catch (error) {
      this.logger.error("Error getting buyer deals:", error instanceof Error ? error.message : error)
      throw new Error(`Failed to get buyer deals: ${error.message}`)
    }
  }

  // NEW: Deal status update endpoints
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post("deals/:dealId/status")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update deal status (active/pending/rejected)" })
  @ApiParam({ name: "dealId", description: "Deal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "active", "rejected"],
          description: "New status for the deal",
        },
        notes: {
          type: "string",
          description: "Optional notes for the status change",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal status updated successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async updateDealStatus(
    @Request() req: RequestWithUser,
    @Param("dealId") dealId: string,
    @Body() body: { status: "pending" | "active" | "rejected"; notes?: string },
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }
    try {
      return await this.dealsService.updateDealStatus(dealId, getEffectiveUserId(req.user), body.status)
    } catch (error) {
      this.logger.error("Error updating deal status:", error instanceof Error ? error.message : error)
      throw new Error(`Failed to update deal status: ${error.message}`)
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post("deals/:dealId/update-status")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update deal status (active/pending/rejected) - Alternative endpoint" })
  @ApiParam({ name: "dealId", description: "Deal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "active", "rejected"],
          description: "New status for the deal",
        },
        notes: {
          type: "string",
          description: "Optional notes for the status change",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal status updated successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async updateDealStatusFromBuyer(
    @Request() req: RequestWithUser,
    @Param("dealId") dealId: string,
    @Body() body: { status: "pending" | "active" | "rejected"; notes?: string },
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }
    try {
      return await this.dealsService.updateDealStatusByBuyer(dealId, getEffectiveUserId(req.user), body.status, body.notes)
    } catch (error) {
      this.logger.error("Error updating deal status:", error instanceof Error ? error.message : error)
      throw new Error(`Failed to update deal status: ${error.message}`)
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Patch("me")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update buyer profile" })
  @ApiResponse({ status: 200, description: "The buyer has been successfully updated." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  update(@Request() req: RequestWithUser, @Body() updateBuyerDto: UpdateBuyerDto) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }
    return this.buyersService.update(getEffectiveUserId(req.user), updateBuyerDto)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Patch("profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update buyer profile (alternative endpoint)" })
  @ApiResponse({ status: 200, description: "The buyer has been successfully updated." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  updateProfileAlt(@Request() req: RequestWithUser, @Body() updateBuyerDto: UpdateBuyerDto) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }
    // Convert phoneNumber to phone if provided (frontend uses phoneNumber, backend uses phone)
    if ((updateBuyerDto as any).phoneNumber !== undefined) {
      updateBuyerDto.phone = (updateBuyerDto as any).phoneNumber;
      delete (updateBuyerDto as any).phoneNumber;
    }
    return this.buyersService.update(getEffectiveUserId(req.user), updateBuyerDto)
  }

  // Parameterized routes should come LAST to avoid conflicts
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin", "buyer", "seller")
  @Get(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a buyer by ID. Buyers can only fetch their own record; admins and sellers can fetch any." })
  @ApiResponse({ status: 200, description: "Return the buyer." })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden" })
  findOne(@Param("id") id: string, @Request() req: RequestWithUser) {
    if (!req.user) {
      throw new UnauthorizedException("User not authenticated");
    }
    if (req.user.role === "buyer" && getEffectiveUserId(req.user) !== id) {
      throw new ForbiddenException("You can only access your own buyer profile");
    }
    return this.buyersService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Delete(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a buyer by ID (admin only)" })
  @ApiResponse({ status: 200, description: "The buyer has been successfully deleted." })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 403, description: "Forbidden - admin only" })
  remove(@Param("id") id: string) {
    return this.buyersService.remove(id);
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Get("deals/active")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get active deals for the buyer" })
  @ApiResponse({ status: 200, description: "Return active deals for the buyer" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getActiveBuyerDeals(@Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }

    try {
      return await this.dealsService.getBuyerDeals(getEffectiveUserId(req.user), "active");
    } catch (error) {
      this.logger.error("Error getting active buyer deals:", error instanceof Error ? error.message : error);
      throw new Error(`Failed to get active buyer deals: ${error.message}`);
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Get("deals/pending")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get pending deals for the buyer" })
  @ApiResponse({ status: 200, description: "Return pending deals for the buyer" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getPendingBuyerDeals(@Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }

    try {
      return await this.dealsService.getBuyerDeals(getEffectiveUserId(req.user), "pending");
    } catch (error) {
      this.logger.error("Error getting pending buyer deals:", error instanceof Error ? error.message : error);
      throw new Error(`Failed to get pending buyer deals: ${error.message}`);
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Get("deals/rejected")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get rejected deals for the buyer" })
  @ApiResponse({ status: 200, description: "Return rejected deals for the buyer" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getRejectedBuyerDeals(@Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }

    try {
      return await this.dealsService.getBuyerDeals(getEffectiveUserId(req.user), "rejected");
    } catch (error) {
      this.logger.error("Error getting rejected buyer deals:", error instanceof Error ? error.message : error);
      throw new Error(`Failed to get rejected buyer deals: ${error.message}`);
    }
  }

  // 2. Quick action endpoints for deal status changes
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post("deals/:dealId/activate")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Activate a deal (show interest)" })
  @ApiParam({ name: "dealId", description: "Deal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        notes: {
          type: "string",
          description: "Optional notes for activation",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal activated successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async activateDeal(
    @Request() req: RequestWithUser,
    @Param("dealId") dealId: string,
    @Body() body: { notes?: string } = {},
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }
    try {
      return await this.dealsService.updateDealStatusByBuyer(dealId, getEffectiveUserId(req.user), "active", body.notes)
    } catch (error) {
      this.logger.error("Error activating deal:", error instanceof Error ? error.message : error)
      throw new Error(`Failed to activate deal: ${error.message}`)
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post("deals/:dealId/reject")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Reject a deal" })
  @ApiParam({ name: "dealId", description: "Deal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        notes: {
          type: "string",
          description: "Optional notes for rejection",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal rejected successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async rejectDeal(
    @Request() req: RequestWithUser,
    @Param("dealId") dealId: string,
    @Body() body: { notes?: string } = {},
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }
    try {
      return await this.dealsService.updateDealStatusByBuyer(dealId, getEffectiveUserId(req.user), "rejected", body.notes)
    } catch (error) {
      this.logger.error("Error rejecting deal:", error instanceof Error ? error.message : error)
      throw new Error(`Failed to reject deal: ${error.message}`)
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post("deals/:dealId/set-pending")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Set deal as pending (under review)" })
  @ApiParam({ name: "dealId", description: "Deal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        notes: {
          type: "string",
          description: "Optional notes for pending status",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal set as pending successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async setPendingDeal(
    @Request() req: RequestWithUser,
    @Param("dealId") dealId: string,
    @Body() body: { notes?: string } = {},
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }
    try {
      return await this.dealsService.updateDealStatusByBuyer(dealId, getEffectiveUserId(req.user), "pending", body.notes)
    } catch (error) {
      this.logger.error("Error setting deal as pending:", error instanceof Error ? error.message : error)
      throw new Error(`Failed to set deal as pending: ${error.message}`)
    }
  }
}
