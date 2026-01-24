import {
  Controller,
  Post,
  UseGuards,
  Get,
  Request,
  UseInterceptors,
  UploadedFile,
  Res,
  Query,
  UnauthorizedException,
  Patch,
  Param,
  Delete,
  Body,
} from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { diskStorage } from "multer"
import { extname } from "path"
import { BuyersService } from "./buyers.service"
import { CreateBuyerDto } from "./dto/create-buyer.dto"
import { LocalAuthGuard } from "../auth/guards/local-auth.guard"
import { GoogleAuthGuard } from "../auth/guards/google-auth.guard"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { AuthService } from "../auth/auth.service"
import { LoginBuyerDto } from "./dto/login-buyer.dto"
import { GoogleLoginResult } from "../auth/interfaces/google-login-result.interface"
import { DealsService } from "../deals/deals.service"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiConsumes, ApiBody, ApiQuery, ApiParam } from "@nestjs/swagger"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { UpdateBuyerDto } from "./dto/update-buyer.dto"

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
  constructor(
    private readonly buyersService: BuyersService,
    private readonly authService: AuthService,
    private readonly dealsService: DealsService,
  ) { }

  @Post("register")
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
      console.error("Registration error:", error)
      throw error
    }
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiOperation({ summary: 'Login a buyer' })
  @ApiResponse({ status: 200, description: 'Buyer successfully logged in' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: LoginBuyerDto })
  async login(@Request() req: any) {
    return this.authService.login(req.user);
  }

  @Get("google")
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: "Initiate Google OAuth login" })
  @ApiResponse({ status: 302, description: "Redirects to Google OAuth" })
  googleAuth() {
    // This route initiates Google OAuth flow
  }

  @Get("google/callback")
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: "Google OAuth callback" })
  @ApiResponse({ status: 302, description: "Redirects to frontend with token" })
  async googleAuthCallback(@Request() req: any, @Res() res: any) {
    try {
      if (!req.user) {
        const frontendUrl = process.env.FRONTEND_URL
        return res.redirect(`${frontendUrl}/auth/error?message=Authentication failed`)
      }

      const loginResult = (await this.authService.loginWithGoogle(req.user)) as GoogleLoginResult

      const frontendUrl = process.env.FRONTEND_URL
      const redirectPath = loginResult.isNewUser ? "/buyer/acquireprofile" : "/deals"

      const userId = loginResult.user._id || (loginResult.user as any).id || "missing-id"

      const redirectUrl = `${frontendUrl}${redirectPath}?token=${loginResult.access_token}&userId=${userId}`

      return res.redirect(redirectUrl)
    } catch (error) {
      const frontendUrl = process.env.FRONTEND_URL
      return res.redirect(`${frontendUrl}/auth/error?message=${encodeURIComponent(error.message)}`)
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get buyer profile' })
  @ApiResponse({ status: 200, description: 'Buyer profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getProfile(@Request() req: any) {
    return this.buyersService.findById(req.user?.userId);
  }

  // UPLOAD ENDPOINTS DISABLED FOR VERCEL (read-only filesystem)
  // Use Cloudinary or AWS S3 for file uploads in production
  /*
  @UseGuards(JwtAuthGuard)
  @Post("upload-profile-picture")
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor("profilePicture", {
      storage: diskStorage({
        destination: "./uploads/profile-pictures",
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
          const ext = extname(file.originalname)
          cb(null, `profile-${uniqueSuffix}${ext}`)
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          cb(new Error("Only image files are allowed!"), false)
        } else {
          cb(null, true)
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    })
  )
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload profile picture" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        profilePicture: {
          type: "string",
          format: "binary",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Profile picture uploaded successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async uploadProfilePicture(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file) {
      return { error: "No file uploaded" }
    }
    const profilePicturePath = `uploads/profile-pictures/${file.filename}`
    await this.buyersService.updateProfilePicture(req.user.userId, profilePicturePath)
    return {
      message: "Profile picture uploaded successfully",
      profilePicture: profilePicturePath
    }
  }
  */

  // Temporary endpoint that returns error for file uploads on Vercel
  @UseGuards(JwtAuthGuard)
  @Post("upload-profile-picture")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Upload profile picture (disabled on Vercel)" })
  @ApiResponse({ status: 501, description: "File uploads not supported on Vercel" })
  async uploadProfilePicture(
    @Request() req: any
  ) {
    return {
      error: "File uploads are not supported on Vercel's read-only filesystem",
      message: "Please use Cloudinary or AWS S3 for file uploads",
      documentation: "See CLOUDINARY-SETUP.md in the repository"
    }
  }

  // UPLOAD ENDPOINTS DISABLED FOR VERCEL (read-only filesystem)
  // Use Cloudinary or AWS S3 for file uploads in production
  /*
  @UseGuards(JwtAuthGuard)
  @Post("profile/picture")
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor("profilePicture", {
      storage: diskStorage({
        destination: "./uploads/profile-pictures",
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
          const ext = extname(file.originalname)
          cb(null, `profile-${uniqueSuffix}${ext}`)
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          cb(new Error("Only image files are allowed!"), false)
        } else {
          cb(null, true)
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    })
  )
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload profile picture (alternative endpoint)" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        profilePicture: {
          type: "string",
          format: "binary",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Profile picture uploaded successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async uploadProfilePictureAlt(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (!file) {
      return { error: "No file uploaded" }
    }
    const profilePicturePath = `uploads/profile-pictures/${file.filename}`
    await this.buyersService.updateProfilePicture(req.user.userId, profilePicturePath)
    return {
      message: "Profile picture uploaded successfully",
      profilePicture: profilePicturePath
    }
  }
  */

  // Temporary endpoint that returns error for file uploads on Vercel
  @UseGuards(JwtAuthGuard)
  @Post("profile/picture")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Upload profile picture (disabled on Vercel)" })
  @ApiResponse({ status: 501, description: "File uploads not supported on Vercel" })
  async uploadProfilePictureAlt(
    @Request() req: any
  ) {
    return {
      error: "File uploads are not supported on Vercel's read-only filesystem",
      message: "Please use Cloudinary or AWS S3 for file uploads",
      documentation: "See CLOUDINARY-SETUP.md in the repository"
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.buyersService.findOne(req.user.userId);
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }

    try {
      return await this.dealsService.getBuyerDeals(req.user.userId)
    } catch (error) {
      console.error("Error getting buyer deals:", error)
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    try {
      return await this.dealsService.updateDealStatus(dealId, req.user.userId, body.status)
    } catch (error) {
      console.error("Error updating deal status:", error)
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    try {
      return await this.dealsService.updateDealStatusByBuyer(dealId, req.user.userId, body.status, body.notes)
    } catch (error) {
      console.error("Error updating deal status:", error)
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    return this.buyersService.update(req.user.userId, updateBuyerDto)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Patch("profile")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update buyer profile (alternative endpoint)" })
  @ApiResponse({ status: 200, description: "The buyer has been successfully updated." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  updateProfileAlt(@Request() req: RequestWithUser, @Body() updateBuyerDto: UpdateBuyerDto) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    // Convert phoneNumber to phone if provided (frontend uses phoneNumber, backend uses phone)
    if ((updateBuyerDto as any).phoneNumber !== undefined) {
      updateBuyerDto.phone = (updateBuyerDto as any).phoneNumber;
      delete (updateBuyerDto as any).phoneNumber;
    }
    return this.buyersService.update(req.user.userId, updateBuyerDto)
  }

  // Parameterized routes should come LAST to avoid conflicts
  @Get(":id")
  @ApiOperation({ summary: "Get a buyer by ID" })
  @ApiResponse({ status: 200, description: "Return the buyer." })
  findOne(@Param("id") id: string) {
    return this.buyersService.findOne(id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a buyer by ID" })
  @ApiResponse({ status: 200, description: "The buyer has been successfully deleted." })
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    try {
      return await this.dealsService.getBuyerDeals(req.user.userId, "active");
    } catch (error) {
      console.error("Error getting active buyer deals:", error);
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    try {
      return await this.dealsService.getBuyerDeals(req.user.userId, "pending");
    } catch (error) {
      console.error("Error getting pending buyer deals:", error);
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated");
    }

    try {
      return await this.dealsService.getBuyerDeals(req.user.userId, "rejected");
    } catch (error) {
      console.error("Error getting rejected buyer deals:", error);
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    try {
      return await this.dealsService.updateDealStatusByBuyer(dealId, req.user.userId, "active", body.notes)
    } catch (error) {
      console.error("Error activating deal:", error)
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    try {
      return await this.dealsService.updateDealStatusByBuyer(dealId, req.user.userId, "rejected", body.notes)
    } catch (error) {
      console.error("Error rejecting deal:", error)
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    try {
      return await this.dealsService.updateDealStatusByBuyer(dealId, req.user.userId, "pending", body.notes)
    } catch (error) {
      console.error("Error setting deal as pending:", error)
      throw new Error(`Failed to set deal as pending: ${error.message}`)
    }
  }
}