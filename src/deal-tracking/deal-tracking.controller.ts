import { Controller, Get, Post, Body, Param, UseGuards, Request, Query, UnauthorizedException } from "@nestjs/common"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { DealTrackingService } from "./deal-tracking.service"
import { CreateDealTrackingDto } from "./dto/create-deal-tracking.dto"
import { RejectDealDto } from "./dto/reject-deal.dto"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiQuery, ApiBody } from "@nestjs/swagger"
import { Request as ExpressRequest } from "express"

interface RequestWithUser extends ExpressRequest {
  user: { userId: string; email: string; role: string }
  app: any
}

@ApiTags("deal-tracking")
@Controller("deal-tracking")
export class DealTrackingController {
  constructor(private readonly dealTrackingService: DealTrackingService) { }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new deal tracking record" })
  @ApiResponse({ status: 201, description: "Record created successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires buyer role" })
  async create(@Body() createDealTrackingDto: CreateDealTrackingDto, @Request() req: RequestWithUser): Promise<any> {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    return this.dealTrackingService.create(req.user.userId, createDealTrackingDto)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all deal tracking records (admin only)" })
  @ApiResponse({ status: 200, description: "Return all records" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  async findAll() {
    return this.dealTrackingService.findAll()
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "admin")
  @Get("deal/:dealId")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all tracking records for a specific deal" })
  @ApiParam({ name: "dealId", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return tracking records" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller or admin role" })
  async findByDeal(@Param("dealId") dealId: string) {
    return this.dealTrackingService.findByDeal(dealId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer", "admin")
  @Get("buyer")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all tracking records for the current buyer" })
  @ApiResponse({ status: 200, description: "Return tracking records" })
  @ApiResponse({ status: 403, description: "Forbidden - requires buyer or admin role" })
  async findMyRecords(@Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.dealTrackingService.findByBuyer(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "admin")
  @Get("stats/:dealId")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get interaction statistics for a deal" })
  @ApiParam({ name: "dealId", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return interaction statistics" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller or admin role" })
  async getInteractionStats(@Param("dealId") dealId: string) {
    return this.dealTrackingService.getInteractionStats(dealId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("recent-activity")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get recent activity for a seller's deals" })
  @ApiQuery({ name: "limit", required: false, description: "Number of records to return" })
  @ApiResponse({ status: 200, description: "Return recent activity" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role" })
  async getRecentActivity(@Request() req: RequestWithUser, @Query("limit") limit: number = 10) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    return this.dealTrackingService.getRecentActivityForSeller(req.user.userId, limit)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post("view/:dealId")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Log a view interaction for a deal" })
  @ApiParam({ name: "dealId", description: "Deal ID" })
  @ApiResponse({ status: 201, description: "View logged successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires buyer role" })
  async logView(@Request() req: RequestWithUser, @Param("dealId") dealId: string) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    return this.dealTrackingService.logView(dealId, req.user.userId)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post("interest/:dealId")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Log an interest interaction for a deal" })
  @ApiParam({ name: "dealId", description: "Deal ID" })
  @ApiResponse({ status: 201, description: "Interest logged successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires buyer role" })
  async logInterest(@Request() req: RequestWithUser, @Param("dealId") dealId: string) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    return this.dealTrackingService.logInterest(dealId, req.user.userId)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post("reject/:dealId")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Log a rejection interaction for a deal" })
  @ApiParam({ name: "dealId", description: "Deal ID" })
  @ApiBody({
    type: RejectDealDto,
    required: false,
    description: "Optional rejection notes"
  })
  @ApiResponse({ status: 201, description: "Rejection logged successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires buyer role" })
  async logRejection(
    @Request() req: RequestWithUser,
    @Param("dealId") dealId: string,
    @Body() body: RejectDealDto = {}, 
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    // Safely access notes with optional chaining and default value
    const notes = body?.notes || undefined;
    return this.dealTrackingService.logRejection(dealId, req.user.userId, notes)
  }
}