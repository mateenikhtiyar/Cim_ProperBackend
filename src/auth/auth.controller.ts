import { Body, Controller, Post, UseGuards, Request, Get, Patch, BadRequestException, ValidationPipe, UsePipes, HttpStatus, HttpCode } from "@nestjs/common"
import { AuthService } from "./auth.service"
import { LocalAuthGuard } from "./guards/local-auth.guard"
import { JwtAuthGuard } from "./guards/jwt-auth.guard"
import { GoogleAuthGuard } from "./guards/google-auth.guard"
import { LoginBuyerDto } from "../buyers/dto/login-buyer.dto"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiBody } from "@nestjs/swagger"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { LoginAdminDto } from "./dto/login-admin.dto"
import { LoginSellerDto } from "./dto/login-seller.dto"
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) { }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiOperation({ summary: 'Login a user' })
  @ApiBody({ type: LoginBuyerDto })
  @ApiResponse({ status: 200, description: 'User logged in successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async login(@Request() req: any) {
    return this.authService.login(req.user);
  }

  @UseGuards(LocalAuthGuard)
  @Post('admin/login')
  @ApiOperation({ summary: 'Login an admin' })
  @ApiResponse({ status: 200, description: 'Admin logged in successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: LoginAdminDto })
  async loginAdmin(@Request() req: any) {
    return this.authService.loginAdmin(req.user);
  }

  @Post('seller/login')
  @UseGuards(LocalAuthGuard)
  @ApiOperation({ summary: 'Login a seller' })
  @ApiResponse({ status: 200, description: 'Seller logged in successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: LoginSellerDto })
  async loginSeller(@Request() req: any) {
    return this.authService.loginSeller(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user profile' })
  @ApiResponse({ status: 200, description: 'User profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getProfile(@Request() req: any) {
    return req.user;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('admin/profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get admin profile' })
  @ApiResponse({ status: 200, description: 'Admin profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role' })
  getAdminProfile(@Request() req: any) {
    return req.user;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @Get('seller/profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get seller profile' })
  @ApiResponse({ status: 200, description: 'Seller profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires seller role' })
  getSellerProfile(@Request() req: any) {
    return req.user;
  }

  @Get("google")
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: "Initiate Google OAuth login" })
  @ApiResponse({ status: 302, description: "Redirects to Google OAuth" })
  googleAuth() {
    // Google authentication is handled by Passport
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  @ApiResponse({ status: 200, description: 'Successfully authenticated with Google' })
  googleAuthRedirect(@Request() req: any) {
    return this.authService.loginWithGoogle(req.user);
  }

  @Post('buyer/forgot-password')
  forgotPasswordBuyer(@Body() body: { email: string }) {
    return this.authService.forgotPasswordBuyer(body.email)
  }
  
  @Patch('buyer/reset-password')
  resetPasswordBuyer(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPasswordBuyer(dto)
  }
  
  @Post('seller/forgot-password')
  forgotPasswordSeller(@Body() body: { email: string }) {
    return this.authService.forgotPasswordSeller(body.email)
  }
  
  @Patch('seller/reset-password')
  resetPasswordSeller(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPasswordSeller(dto)
  }
  



}
