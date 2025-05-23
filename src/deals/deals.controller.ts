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
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBody } from "@nestjs/swagger"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { DealsService } from "./deals.service"
import { CreateDealDto } from "./dto/create-deal.dto"
import { UpdateDealDto } from "./dto/update-deal.dto"
import { DealResponseDto } from "./dto/deal-response.dto"

interface RequestWithUser extends Request {
  user: {
    userId: string
    email: string
    role: string
  }
}

@ApiTags("deals")
@Controller("deals")
export class DealsController {
  constructor(private readonly dealsService: DealsService) { }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new deal" })
  @ApiResponse({ status: 201, description: "Deal created successfully", type: DealResponseDto })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role" })
  async create(@Body() createDealDto: CreateDealDto, @Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    return this.dealsService.create(req.user.userId, createDealDto)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all deals (admin only)" })
  @ApiResponse({ status: 200, description: "Return all deals", type: [DealResponseDto] })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  async findAllAdmin() {
    return this.dealsService.findAll()
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("my-deals")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all deals created by the seller" })
  @ApiResponse({ status: 200, description: "Return seller's deals", type: [DealResponseDto] })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role" })
  async findMine(@Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.dealsService.findBySeller(req.user.userId);
  }

  @Get("public")
  @ApiOperation({ summary: "Get all public active deals" })
  @ApiResponse({ status: 200, description: "Return public deals", type: [DealResponseDto] })
  async findPublic() {
    return this.dealsService.findPublicDeals()
  }

  @UseGuards(JwtAuthGuard)
  @Get(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a deal by ID" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return the deal", type: DealResponseDto })
  @ApiResponse({ status: 404, description: "Deal not found" })
  async findOne(@Param("id") id: string, @Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    const deal = await this.dealsService.findOne(id)
    const userRole = req.user.role
    const userId = req.user.userId

    if (
      userRole === "admin" ||
      (userRole === "seller" && deal.seller.toString() === userId) ||
      (userRole === "buyer" &&
        (deal.isPublic || deal.targetedBuyers.includes(userId) || deal.interestedBuyers.includes(userId)))
    ) {
      return deal
    }

    throw new ForbiddenException("You don't have permission to access this deal")
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Patch(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a deal" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Deal updated successfully", type: DealResponseDto })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 404, description: "Deal not found" })
  async update(@Param("id") id: string, @Request() req: RequestWithUser, @Body() updateDealDto: UpdateDealDto) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    return this.dealsService.update(id, req.user.userId, updateDealDto)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Delete(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a deal" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Deal deleted successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 404, description: "Deal not found" })
  async remove(@Param("id") id: string, @Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }
    await this.dealsService.remove(id, req.user.userId)
    return { message: "Deal deleted successfully" }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("statistics")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get deal statistics for the seller" })
  @ApiResponse({ status: 200, description: "Return deal statistics" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role" })
  async getDealStatistics(@Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.dealsService.getDealStatistics(req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get(":id/matching-buyers")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get matching buyers for a deal" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return matching buyers" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 404, description: "Deal not found" })
  async getMatchingBuyers(@Param("id") id: string, @Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }

    // First verify the seller owns this deal
    const deal = await this.dealsService.findOne(id)
    if (deal.seller.toString() !== req.user.userId) {
      throw new ForbiddenException("You don't have permission to access this deal's matching buyers")
    }

    return this.dealsService.findMatchingBuyers(id)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Post(":id/target-buyers")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Target a deal to specific buyers" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        buyerIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of buyer IDs to target",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal targeted to buyers successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 404, description: "Deal not found" })
  async targetDealToBuyers(
    @Param("id") id: string,
    @Body() body: { buyerIds: string[] },
    @Request() req: RequestWithUser,
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }

    // First verify the seller owns this deal
    const deal = await this.dealsService.findOne(id)
    if (deal.seller.toString() !== req.user.userId) {
      throw new ForbiddenException("You don't have permission to target buyers for this deal")
    }

    return this.dealsService.targetDealToBuyers(id, body.buyerIds)
  }
}
