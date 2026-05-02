import { Body, Controller, Post, UseGuards, Request, Get, Patch, BadRequestException, ValidationPipe, UsePipes, HttpStatus, HttpCode, Res, Query } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import { AuthService } from "./auth.service"
import { LocalAuthGuard } from "./guards/local-auth.guard"
import { JwtAuthGuard } from "./guards/jwt-auth.guard"
import { LoginBuyerDto } from "../buyers/dto/login-buyer.dto"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiBody } from "@nestjs/swagger"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { LoginAdminDto } from "./dto/login-admin.dto"
import { LoginSellerDto } from "./dto/login-seller.dto"
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { Response } from 'express';
import { getFrontendUrl } from '../common/frontend-url';



@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) { }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  @ApiOperation({ summary: 'Login a user' })
  @ApiBody({ type: LoginBuyerDto })
  @ApiResponse({ status: 200, description: 'User logged in successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async login(@Request() req: any) {
    return this.authService.login(req.user);
  }

  @UseGuards(LocalAuthGuard)
  @Post('admin/login')
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  @ApiOperation({ summary: 'Login an admin' })
  @ApiResponse({ status: 200, description: 'Admin logged in successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: LoginAdminDto })
  async loginAdmin(@Request() req: any) {
    return this.authService.loginAdmin(req.user);
  }

  @Post('seller/login')
  @UseGuards(LocalAuthGuard)
  @Throttle({ default: { limit: 1000, ttl: 60000 } })
  @ApiOperation({ summary: 'Login a seller' })
  @ApiResponse({ status: 200, description: 'Seller logged in successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: LoginSellerDto })
  async loginSeller(@Request() req: any) {
    return this.authService.loginSeller(req.user);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refresh_token: { type: 'string', description: 'The refresh token' },
      },
      required: ['refresh_token'],
    },
  })
  @ApiResponse({ status: 200, description: 'Tokens refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refreshToken(@Body('refresh_token') refreshToken: string) {
    if (!refreshToken) {
      throw new BadRequestException('Refresh token is required');
    }
    return this.authService.refreshToken(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revoke current access/refresh tokens" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        refresh_token: { type: "string", description: "Optional refresh token to revoke" },
      },
    },
  })
  async logout(@Request() req: any, @Body("refresh_token") refreshToken?: string) {
    const authHeader = req?.headers?.authorization as string | undefined;
    const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    return this.authService.logout(accessToken, refreshToken);
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

  @Post('buyer/forgot-password')
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  forgotPasswordBuyer(@Body() body: { email: string }) {
    return this.authService.forgotPasswordBuyer(body.email)
  }
  
  @Patch('buyer/reset-password')
  resetPasswordBuyer(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPasswordBuyer(dto)
  }
  
  @Post('seller/forgot-password')
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  forgotPasswordSeller(@Body() body: { email: string }) {
    return this.authService.forgotPasswordSeller(body.email)
  }
  
  @Patch('seller/reset-password')
  resetPasswordSeller(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPasswordSeller(dto)
  }

  }



