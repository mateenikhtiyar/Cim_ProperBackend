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
  Body, // Add this import
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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiConsumes, ApiBody, ApiQuery } from "@nestjs/swagger"
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
  @ApiBody({ type: CreateBuyerDto }) // Add this for better Swagger documentation
  async register(@Body() createBuyerDto: CreateBuyerDto) { // Add @Body() decorator
    try {
      const buyer = await this.buyersService.create(createBuyerDto)
      const result = buyer?.toObject ? buyer.toObject() : { ...buyer }
      delete result.password
      return result
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

      console.log("Login result:", JSON.stringify(loginResult, null, 2))
      console.log("User ID type:", typeof loginResult.user._id)
      console.log("User ID value:", loginResult.user._id)

      const frontendUrl = process.env.FRONTEND_URL
      const redirectPath = loginResult.isNewUser ? "/acquireprofile" : "/deals"

      const userId = loginResult.user._id || (loginResult.user as any).id || "missing-id"

      const redirectUrl = `${frontendUrl}${redirectPath}?token=${loginResult.access_token}&userId=${userId}`

      console.log("Redirect URL:", redirectUrl)
      return res.redirect(redirectUrl)
    } catch (error) {
      console.error("Google callback error:", error)
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

  @UseGuards(JwtAuthGuard)
  @Post("upload-profile-picture")
  @ApiBearerAuth()
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload profile picture" })
  @ApiResponse({ status: 200, description: "Profile picture uploaded successfully" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          format: "binary",
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor("file", {
      storage: diskStorage({
        destination: "./uploads/profile-pictures",
        filename: (req: any, file, cb) => {
          const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
          const ext = extname(file.originalname)
          const userId = req.user?.userId || "unknown"
          cb(null, `${userId}${uniqueSuffix}${ext}`)
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
          return cb(new Error("Only image files are allowed!"), false)
        }
        cb(null, true)
      },
      limits: {
        fileSize: 1024 * 1024 * 5, // 5MB limit
      },
    }),
  )
  async uploadProfilePicture(@Request() req: any, @UploadedFile() file: any) {
    const profilePicturePath = file.path
    const buyer = await this.buyersService.updateProfilePicture(req.user?.userId, profilePicturePath)
    return { message: "Profile picture uploaded successfully", profilePicture: profilePicturePath }
  }

  // IMPORTANT: Put specific routes BEFORE parameterized routes
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("all") // Changed from empty string to "all" to avoid conflicts
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
  @Get("deals") // This specific route must come BEFORE the parameterized route
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
      return await this.dealsService.getBuyerDeals(req.user.userId, status)
    } catch (error) {
      console.error("Error getting buyer deals:", error)
      throw new Error(`Failed to get buyer deals: ${error.message}`)
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Patch("me")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update buyer profile" })
  @ApiResponse({ status: 200, description: "The buyer has been successfully updated." })
  @ApiResponse({ status: 401, description: "Unauthorized." })
  update(@Request() req: RequestWithUser, @Body() updateBuyerDto: UpdateBuyerDto) { // Add @Body() decorator here too
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
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
}