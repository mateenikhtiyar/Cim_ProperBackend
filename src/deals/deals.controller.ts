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
  UseInterceptors,
  UploadedFiles,
  ValidationPipe,
  BadRequestException,
  HttpException,
  HttpStatus,
  Res,
  Query,
} from "@nestjs/common"
import { getEffectiveUserId } from "../common/team-utils"
import { FilesInterceptor } from "@nestjs/platform-express"
import { memoryStorage } from "multer"
import { extname } from "path"
import { randomBytes } from "crypto"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBody, ApiConsumes, ApiQuery } from "@nestjs/swagger"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { DealsService } from "./deals.service"
import { CreateDealDto } from "./dto/create-deal.dto"
import { UpdateDealDto } from "./dto/update-deal.dto"
import { DealResponseDto } from "./dto/deal-response.dto"
import { Express } from "express"
import { Response } from 'express'
import { Throttle } from "@nestjs/throttler"

const PUBLIC_LINK_ENDPOINT_LIMIT_PER_MINUTE = 10000

interface RequestWithUser extends Request {
  user: {
    userId: string
    email: string
    role: string
  }
}

interface DocumentInfo {
  filename: string;
  originalName: string;
  path?: string;
  base64Content?: string;
  size: number;
  mimetype: string;
  uploadedAt: Date;
}

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15 MB per file (BSON 16 MB doc limit)

@ApiTags("deals")
@Controller("deals")
export class DealsController {
  constructor(private readonly dealsService: DealsService) { }

  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Server is healthy' })
  async healthCheck() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Marketplace: list public deals (buyer only) with buyer-specific status
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('buyer')
  @Get('marketplace')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List public marketplace deals with buyer status (buyer only)' })
  @ApiQuery({ name: 'location', required: false, type: String, description: 'Filter by geography/location' })
  @ApiQuery({ name: 'industry', required: false, type: String, description: 'Filter by industry sector' })
  @ApiResponse({ status: 200, description: 'Public deals list with current buyer status' })
  async listMarketplaceDeals(
    @Request() req: RequestWithUser,
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20,
    @Query("location") location?: string,
    @Query("industry") industry?: string,
  ) {
    const buyerId = getEffectiveUserId(req.user);
    return this.dealsService.findPublicDealsPaginated(
      buyerId,
      Number(page),
      Number(limit),
      location,
      industry,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Post()
  @ApiBearerAuth()
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Create a new deal with optional document uploads" })
  @ApiResponse({ status: 201, description: "Deal created successfully", type: DealResponseDto })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        dealData: {
          type: "string",
          description: "JSON string containing all deal data",
          example: JSON.stringify({
            title: "SaaS Company Acquisition Opportunity",
            companyDescription: "Established SaaS company with recurring revenue seeking acquisition.",
            companyType: "SaaS Company",
            dealType: "acquisition",
            industrySector: "Technology",
            geographySelection: "United States",
            yearsInBusiness: 5,
            employeeCount: 50,
            financialDetails: {
              trailingRevenueAmount: 1000000,
              trailingRevenueCurrency: "USD($)",
              trailingEBITDAAmount: 250000,
              trailingEBITDACurrency: "USD($)",
              t12FreeCashFlow: 180000,
              t12NetIncome: 200000,
              avgRevenueGrowth: 42,
              netIncome: 200000,
              askingPrice: 5000000
            },
            businessModel: {
              recurringRevenue: true,
              assetLight: true,
              projectBased: false,
              assetHeavy: false
            },
            managementPreferences: {
              retiringDivesting: true,
              staffStay: true
            },
            buyerFit: {
              capitalAvailability: "Ready to deploy immediately",
              minPriorAcquisitions: 2,
              minTransactionSize: 1000000
            },
            tags: ["growth opportunity", "recurring revenue", "saas"],
            isPublic: false,
            isFeatured: false,
            stakePercentage: 100
          })
        },
        files: {
          type: "array",
          items: {
            type: "string",
            format: "binary",
          },
          description: "Optional documents to upload with the deal",
        },
      },
    },
  })
  async create(
    @Body() body: any, // Accept any body type
    @Request() req: RequestWithUser,
  ) {
    
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException('User not authenticated')
    }

    let createDealDto: CreateDealDto

    try {
      // Handle both JSON body and FormData with dealData string
      if (body && typeof body === 'object' && 'dealData' in body && typeof body.dealData === 'string') {
        // FormData approach: dealData is a JSON string
        createDealDto = JSON.parse(body.dealData)
      } else if (body && typeof body === 'object' && 'title' in body) {
        // Direct JSON body approach
        createDealDto = body as CreateDealDto
      } else {
        throw new BadRequestException('Invalid request body: expected dealData string or deal object')
      }

      // File uploads disabled - just create empty documents array
      const documents: any[] = []

      // Merge seller and documents into the DTO
      const dealWithSellerAndDocuments: CreateDealDto = {
        ...createDealDto,
        seller: getEffectiveUserId(req.user),
        documents,
      }

      // Save the deal
      const result = await this.dealsService.create(dealWithSellerAndDocuments);
      return result;
    } catch (error) {
      throw error;
    }
  }

  
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Post(":id/upload-documents")
  @ApiBearerAuth()
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Upload documents for a deal" })
  @ApiResponse({ status: 200, description: "Documents uploaded successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 404, description: "Deal not found" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: {
            type: "string",
            format: "binary",
          },
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor("files", 10, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_BYTES },
    }),
  )
  async uploadDocuments(
    @Param("id") dealId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: RequestWithUser,
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }

    const deal = await this.dealsService.findOne(dealId)
    if (deal.seller.toString() !== getEffectiveUserId(req.user)) {
      throw new ForbiddenException("You don't have permission to upload documents for this deal")
    }

    if (!files || files.length === 0) {
      throw new BadRequestException("No files were uploaded")
    }

    const documents: DocumentInfo[] = files.map((file) => {
      const ext = extname(file.originalname)
      const filename = `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`
      return {
        filename,
        originalName: file.originalname,
        base64Content: file.buffer.toString("base64"),
        size: file.size,
        mimetype: file.mimetype,
        uploadedAt: new Date(),
      }
    })

    const updatedDeal = await this.dealsService.addDocuments(dealId, documents)
    return {
      message: "Documents uploaded successfully",
      documents: updatedDeal.documents,
    }
  }

  // Buyer requests access to a public deal
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('buyer')
  @Post(':id/request-access')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request access to a marketplace deal (buyer only)' })
  @ApiParam({ name: 'id', description: 'Deal ID' })
  @ApiResponse({ status: 200, description: 'Request sent' })
  async requestAccess(
    @Param('id') dealId: string,
    @Request() req: RequestWithUser,
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.dealsService.requestAccess(dealId, getEffectiveUserId(req.user));
  }

  // Buyer marks a marketplace deal as not interested
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('buyer')
  @Post(':id/not-interested')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a marketplace deal as not interested (buyer only)' })
  @ApiParam({ name: 'id', description: 'Deal ID' })
  @ApiResponse({ status: 200, description: 'Deal marked as not interested' })
  async markNotInterested(
    @Param('id') dealId: string,
    @Request() req: RequestWithUser,
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.dealsService.markNotInterested(dealId, getEffectiveUserId(req.user));
  }

// Place static routes before dynamic routes
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Get('active-accepted')
@ApiBearerAuth()
@ApiOperation({ summary: 'Get all deals with at least one accepted invitation (admin only)' })
@ApiResponse({ status: 200, description: 'List of deals with accepted invitations', type: [DealResponseDto] })
async getAllActiveDealsWithAccepted() {
  return this.dealsService.getAllActiveDealsWithAccepted();
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Get('admin/buyer/:buyerId/status-counts')
@ApiBearerAuth()
@ApiOperation({ summary: 'Get deal counts by status for a buyer (admin only)' })
@ApiParam({ name: 'buyerId', description: 'Buyer ID' })
@ApiResponse({ status: 200, description: 'Deal status counts for the buyer', schema: { example: { active: 2, pending: 1, rejected: 0 } } })
async getBuyerDealStatusCounts(@Param('buyerId') buyerId: string) {
  const [active, pending, rejected] = await Promise.all([
    this.dealsService.getBuyerDeals(buyerId, 'active'),
    this.dealsService.getBuyerDeals(buyerId, 'pending'),
    this.dealsService.getBuyerDeals(buyerId, 'rejected'),
  ]);
  return {
    active: active.length,
    pending: pending.length,
    rejected: rejected.length,
  };
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Get('admin/buyer/:buyerId/deals')
@ApiBearerAuth()
@ApiOperation({ summary: 'Get all deals for a buyer by status (admin only)' })
@ApiParam({ name: 'buyerId', description: 'Buyer ID' })
@ApiQuery({ name: 'status', required: false, enum: ['active', 'pending', 'rejected'], description: 'Deal status' })
@ApiResponse({ status: 200, description: 'Deals for the buyer', type: [Object] })
async getBuyerDealsByStatus(@Param('buyerId') buyerId: string, @Query('status') status?: 'active' | 'pending' | 'rejected') {
  return this.dealsService.getBuyerDeals(buyerId, status);
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Get('admin/seller/:sellerId/deals')
@ApiBearerAuth()
@ApiOperation({ summary: 'Get all deals for a seller by status (admin only)' })
@ApiParam({ name: 'sellerId', description: 'Seller ID' })
@ApiQuery({ name: 'status', required: false, enum: ['active', 'completed', 'loi'], description: 'Deal status' })
@ApiResponse({ status: 200, description: 'Deals for the seller', type: [Object] })
async getSellerDealsByStatus(@Param('sellerId') sellerId: string, @Query('status') status?: 'active' | 'completed' | 'loi') {
  if (status === 'completed') {
    return this.dealsService.getCompletedDeals(sellerId);
  } else if (status === 'active') {
    return this.dealsService.getSellerActiveDeals(sellerId);
  } else if (status === 'loi') {
    return this.dealsService.getSellerLOIDeals(sellerId);
  } else {
    // For "all" deals, return all non-completed deals (includes LOI)
    return this.dealsService.findAllDealsBySeller(sellerId);
  }
}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Delete(":id/documents/:documentIndex")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove a document from a deal" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiParam({ name: "documentIndex", description: "Index of the document to remove" })
  @ApiResponse({ status: 200, description: "Document removed successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 404, description: "Deal or document not found" })
  async removeDocument(
    @Param("id") dealId: string,
    @Param("documentIndex") documentIndex: string,
    @Request() req: RequestWithUser,
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }

    // Verify the seller owns this deal
    const deal = await this.dealsService.findOne(dealId)
    if (deal.seller.toString() !== getEffectiveUserId(req.user)) {
      throw new ForbiddenException("You don't have permission to remove documents from this deal")
    }

    const index = Number.parseInt(documentIndex, 10)
    const updatedDeal = await this.dealsService.removeDocument(dealId, index)

    return { message: "Document removed successfully" }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all deals (admin only) - Optimized with seller profiles and status summaries" })
  @ApiResponse({ status: 200, description: "Return all deals with seller profiles and stats" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number for pagination' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of items per page' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search term for deals' })
  @ApiQuery({ name: 'buyerResponse', required: false, type: String, description: 'Filter deals by buyer response status' })
  @ApiQuery({ name: 'status', required: false, type: String, description: 'Filter deals by status' })
  async findAllAdmin(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search: string = '',
    @Query('buyerResponse') buyerResponse?: string,
    @Query('status') status?: string,
    @Query('isPublic') isPublic?: string,
    @Query('excludeStatus') excludeStatus?: string,
  ) {
    // Use optimized endpoint that returns everything in single query
    return this.dealsService.findAllAdminOptimized(
      { search, buyerResponse, status, isPublic, excludeStatus },
      page,
      limit
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("admin/tab-counts")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get admin tab counts for deals dashboard" })
  @ApiResponse({ status: 200, description: "Return tab counts" })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search term for deals' })
  async getAdminTabCounts(@Query('search') search: string = '') {
    return this.dealsService.getAdminTabCounts(search);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("admin/stats")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get admin dashboard statistics" })
  @ApiResponse({ status: 200, description: "Return dashboard statistics" })
  async getAdminStats() {
    return this.dealsService.getAdminDashboardStats();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("my-deals")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all deals created by the seller" })
  @ApiResponse({ status: 200, description: "Return seller's deals", type: [DealResponseDto] })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role" })
  async findMine(@Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.dealsService.findBySeller(getEffectiveUserId(req.user));
  }

  @Get("public")
  @ApiOperation({ summary: "Get all public active deals" })
  @ApiResponse({ status: 200, description: "Return public deals", type: [DealResponseDto] })
  async findPublic() {
    return this.dealsService.findPublicDeals()
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "admin") // ✅ Allow both seller and admin
  @Get("completed")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get completed deals for seller or admin" })
  @ApiResponse({ status: 200, description: "Return completed deals", type: [DealResponseDto] })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller or admin role" })
  async getCompletedDeals(@Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.dealsService.getCompletedDeals(getEffectiveUserId(req.user));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("loi-deals")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all LOI (Letter of Intent) deals for the seller" })
  @ApiResponse({ status: 200, description: "Return LOI deals", type: [DealResponseDto] })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role" })
  async getLOIDeals(@Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.dealsService.getSellerLOIDeals(getEffectiveUserId(req.user));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "admin")
  @Post(":id/pause-for-loi")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Pause a deal for LOI negotiations" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        loiBuyerId: {
          type: "string",
          description: "Optional CIM Amplify buyer ID if LOI is with a CIM buyer",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal paused for LOI successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 400, description: "Deal must be active to pause for LOI" })
  async pauseDealForLOI(
    @Param("id") dealId: string,
    @Request() req: RequestWithUser,
    @Body() body: { loiBuyerId?: string },
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }

    const deal = await this.dealsService.moveDealToLOI(
      dealId,
      getEffectiveUserId(req.user),
      req.user.role,
      body?.loiBuyerId,
    );

    return {
      message: "Deal paused for LOI successfully",
      deal,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "admin")
  @Post(":id/revive-from-loi")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Revive a deal from LOI status back to Active" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Deal revived successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 400, description: "Deal must be in LOI status to revive" })
  async reviveDealFromLOI(
    @Param("id") dealId: string,
    @Request() req: RequestWithUser,
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }

    const deal = await this.dealsService.reviveDealFromLOI(
      dealId,
      getEffectiveUserId(req.user),
      req.user.role,
    );

    return {
      message: "Deal revived successfully",
      deal,
    };
  }
  

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("statistics")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get deal statistics for the seller" })
  @ApiResponse({ status: 200, description: "Return deal statistics" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role" })
  async getDealStatistics(@Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.dealsService.getDealStatistics(getEffectiveUserId(req.user));
  }

  @UseGuards(JwtAuthGuard)
  @Get(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a deal by ID" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return the deal", type: DealResponseDto })
  @ApiResponse({ status: 404, description: "Deal not found" })
  async findOne(@Param("id") id: string, @Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }
    const deal = await this.dealsService.findOne(id)
    const userRole = req.user.role
    const userId = getEffectiveUserId(req.user)

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
  @Get(":id/matching-buyers")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get matching buyers for a deal" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return matching buyers" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 404, description: "Deal not found" })
  async getMatchingBuyers(@Param("id") id: string, @Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }

    // First verify the seller owns this deal
    const deal = await this.dealsService.findOne(id)
    if (deal.seller.toString() !== getEffectiveUserId(req.user)) {
      throw new ForbiddenException("You don't have permission to access this deal's matching buyers")
    }

    return this.dealsService.findMatchingBuyers(id)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get(":id/buyer-interactions")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get buyer interactions for a deal (seller only)" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return buyer interactions for the deal" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  async getDealBuyerInteractions(@Param("id") dealId: string, @Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }

    // Verify the seller owns this deal
    const deal = await this.dealsService.findOne(dealId)
    if (deal.seller.toString() !== getEffectiveUserId(req.user)) {
      throw new ForbiddenException("You don't have permission to view interactions for this deal")
    }

    return this.dealsService.getBuyerInteractionsForDeal(dealId)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get(":id/ever-active-buyers")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get buyers who ever had this deal in their Active tab (for 'Buyer from CIM Amplify' option)" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return list of buyers who ever had this deal in Active" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  async getEverActiveBuyers(@Param("id") dealId: string, @Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }

    // Verify the seller owns this deal
    const deal = await this.dealsService.findOne(dealId)
    if (deal.seller.toString() !== getEffectiveUserId(req.user)) {
      throw new ForbiddenException("You don't have permission to access this deal's buyers")
    }

    return this.dealsService.getEverActiveBuyers(dealId)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("admin/completed/all")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all completed deals (admin only)" })
  @ApiResponse({ status: 200, description: "List of completed deals", type: [DealResponseDto] })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  async getAllCompletedDeals(@Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user) || req.user.role !== "admin") {
      throw new UnauthorizedException("Access denied: admin only.");
    }

    return this.dealsService.getAllCompletedDeals();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Get("admin/:id/ever-active-buyers")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get buyers who ever had this deal in their Active tab (admin only)" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return list of buyers who ever had this deal in Active" })
  @ApiResponse({ status: 403, description: "Forbidden - requires admin role" })
  async getEverActiveBuyersAdmin(@Param("id") dealId: string, @Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user) || req.user.role !== "admin") {
      throw new UnauthorizedException("Access denied: admin only.")
    }

    return this.dealsService.getEverActiveBuyers(dealId)
  }
  





  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "admin")
  @Get(":id/status-summary")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get deal status summary with buyer breakdown (admin or seller)" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return deal status summary" })
  @ApiResponse({ status: 403, description: "Forbidden - requires role or ownership" })
  async getDealStatusSummary(
    @Param("id") dealId: string,
    @Request() req: RequestWithUser
  ) {
    const userId = getEffectiveUserId(req.user);
    const role = req.user?.role;
  
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
  
    const deal = await this.dealsService.findOne(dealId);
  
    // 🔐 If seller, enforce ownership
    if (role === "seller" && deal.seller.toString() !== userId) {
      throw new ForbiddenException("You don't have permission to view this deal's status");
    }
  
    // ✅ Admin can access any deal
    return this.dealsService.getDealWithBuyerStatusSummary(dealId);
  }
  
  @Get(':dealId/document/:filename')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'seller', 'seller-member', 'buyer', 'buyer-member')
  @ApiBearerAuth()
  async downloadDocument(
    @Param('dealId') dealId: string,
    @Param('filename') filename: string,
    @Request() req: RequestWithUser,
    @Res() res: Response,
  ) {
    try {
      const userId = getEffectiveUserId(req.user);
      if (!userId) {
        throw new UnauthorizedException("User not authenticated");
      }
      const file = await this.dealsService.getDocumentFile(dealId, filename, userId, req.user.role);
      res.set({
        'Content-Type': file.mimetype,
        'Content-Disposition': `attachment; filename="${file.originalName}"`,
        'Content-Length': file.buffer.length.toString(),
      });
      res.send(file.buffer);
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw new HttpException(error.message, HttpStatus.FORBIDDEN);
      }
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update a deal" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Deal updated successfully", type: DealResponseDto })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 404, description: "Deal not found" })
  async update(@Param("id") id: string, @Request() req: RequestWithUser, @Body() updateDealDto: UpdateDealDto) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }
    return this.dealsService.update(id, getEffectiveUserId(req.user), updateDealDto, req.user.role)
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
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }

    // First verify the seller owns this deal
    const deal = await this.dealsService.findOne(id)
    if (deal.seller.toString() !== getEffectiveUserId(req.user)) {
      throw new ForbiddenException("You don't have permission to target buyers for this deal")
    }

    return this.dealsService.targetDealToBuyers(id, body.buyerIds)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "admin")
  @Post(":id/close-deal")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Close a deal (seller only)" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        finalSalePrice: {
          type: "number",
          description: "Final sale price of the deal",
        },
        notes: {
          type: "string",
          description: "Notes about the deal closure",
        },
        winningBuyerId: {
          type: "string",
          description: "ID of the buyer who won the deal",
        },
        buyerFromCIM: {
          type: "boolean",
          description: "Whether the selected buyer came from CIM Amplify",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal closed successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  async closeDealBySeller(
    @Param("id") dealId: string,
    @Body() body: { finalSalePrice?: number; notes?: string; winningBuyerId?: string; buyerFromCIM?: boolean },
    @Request() req: RequestWithUser,
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }

    const closedDeal = await this.dealsService.closeDealseller(
      dealId,
      getEffectiveUserId(req.user),
      body.finalSalePrice,
      body.notes,
      body.winningBuyerId,
      req.user.role,
      body.buyerFromCIM,
    )

    return {
      message: "Deal closed successfully",
      deal: closedDeal,
    }
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("buyer")
  @Post(":id/update-status")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update deal status by buyer (active/pending/rejected)" })
  @ApiParam({ name: "id", description: "Deal ID" })
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
  @ApiResponse({ status: 403, description: "Forbidden - requires buyer role" })
  async updateDealStatusByBuyer(
    @Param("id") dealId: string,
    @Request() req: RequestWithUser,
    @Body() body: { status: "pending" | "active" | "rejected"; notes?: string },
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }

    return this.dealsService.updateDealStatusByBuyer(dealId, getEffectiveUserId(req.user), body.status, body.notes)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller","admin")
  @Delete(":id")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete a deal(both admin and seller)" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Deal deleted successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  @ApiResponse({ status: 404, description: "Deal not found" })
  async remove(@Param("id") id: string, @Request() req: RequestWithUser) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }
    await this.dealsService.remove(id, getEffectiveUserId(req.user), req.user.role)
    return { message: "Deal deleted successfully" }
  }
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "admin")
  @Post(":id/close")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Close a deal (seller only)" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        finalSalePrice: {
          type: "number",
          description: "Final sale price of the deal",
        },
        notes: {
          type: "string",
          description: "Notes about the deal closure",
        },
        winningBuyerId: {
          type: "string",
          description: "ID of the buyer who won the deal",
        },
        buyerFromCIM: {
          type: "boolean",
          description: "Whether the selected buyer came from CIM Amplify",
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal closed successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  async closeDeal(
    @Param("id") dealId: string,
    @Body() body: { finalSalePrice?: number; notes?: string; winningBuyerId?: string; buyerFromCIM?: boolean },
    @Request() req: RequestWithUser,
  ) {
    if (!getEffectiveUserId(req.user)) {
      throw new UnauthorizedException("User not authenticated")
    }

    try {
      const closedDeal = await this.dealsService.closeDealseller(
        dealId,
        getEffectiveUserId(req.user),
        body.finalSalePrice,
        body.notes,
        body.winningBuyerId,
        req.user.role,
        body.buyerFromCIM,
      )

      return {
        message: "Deal closed successfully",
        deal: closedDeal,
      }
    } catch (error) {
      throw error
    }
  }

  // ── Public endpoint (no auth) for email-based deal actions ──

  @Throttle({ default: { limit: PUBLIC_LINK_ENDPOINT_LIMIT_PER_MINUTE, ttl: 60000 } })
  @Post("email-action/:token")
  @ApiOperation({ summary: "Handle deal action from email link (no login required)" })
  @ApiParam({ name: "token", description: "Unique action token from the email" })
  @ApiQuery({ name: "action", enum: ["activate", "pass", "loi", "off-market", "flag-inactive"], description: "The action to perform" })
  @ApiBody({
    required: false,
    schema: {
      type: "object",
      properties: {
        buyerFromCIM: { type: "boolean", description: "Whether the deal closed/paused with a CIM Amplify buyer" },
        winningBuyerId: { type: "string", description: "Selected buyer for off-market close (only when buyerFromCIM is true)" },
        loiBuyerId: { type: "string", description: "Selected buyer for LOI pause (only when buyerFromCIM is true)" },
        finalSalePrice: { type: "number", description: "Final sale price (off-market close only)" },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Action completed successfully" })
  @ApiResponse({ status: 400, description: "Invalid action or expired token" })
  @ApiResponse({ status: 404, description: "Token not found" })
  @ApiResponse({ status: 429, description: "Too many requests" })
  async handleEmailAction(
    @Param("token") token: string,
    @Query("action") action: 'activate' | 'pass' | 'loi' | 'off-market' | 'flag-inactive',
    @Request() req: any,
    @Body() body: {
      buyerFromCIM?: boolean
      winningBuyerId?: string
      loiBuyerId?: string
      finalSalePrice?: number
    } = {},
  ) {
    if (!["activate", "pass", "loi", "off-market", "flag-inactive"].includes(action)) {
      throw new BadRequestException("Invalid action. Must be one of 'activate', 'pass', 'loi', 'off-market', or 'flag-inactive'.")
    }

    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    return this.dealsService.handleEmailAction(token, action, ip, userAgent, body || {})
  }

  @Throttle({ default: { limit: PUBLIC_LINK_ENDPOINT_LIMIT_PER_MINUTE, ttl: 60000 } })
  @Get("email-action/:token/buyers")
  @ApiOperation({ summary: "List buyers eligible for LOI / Off Market selection from an email action token (no login required)" })
  @ApiParam({ name: "token", description: "Unique action token from the email" })
  @ApiResponse({ status: 200, description: "List of ever-active buyers for the deal" })
  @ApiResponse({ status: 400, description: "Invalid or unsupported token" })
  @ApiResponse({ status: 404, description: "Token not found" })
  async listBuyersForEmailAction(
    @Param("token") token: string,
    @Request() req: any,
  ) {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    return this.dealsService.getEverActiveBuyersByActionToken(token, ip)
  }

  @Throttle({ default: { limit: PUBLIC_LINK_ENDPOINT_LIMIT_PER_MINUTE, ttl: 60000 } })
  @Get("email-action/:token/status")
  @ApiOperation({ summary: "Check whether an email action token has already been consumed (no login required)" })
  @ApiParam({ name: "token", description: "Unique action token from the email" })
  @ApiResponse({ status: 200, description: "Token status (used / unused) and previously-taken action" })
  @ApiResponse({ status: 400, description: "Invalid or expired token" })
  @ApiResponse({ status: 404, description: "Token not found" })
  async getEmailActionTokenStatus(
    @Param("token") token: string,
    @Request() req: any,
  ) {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    return this.dealsService.getEmailActionTokenStatus(token, ip)
  }

  @Throttle({ default: { limit: PUBLIC_LINK_ENDPOINT_LIMIT_PER_MINUTE, ttl: 60000 } })
  @Get("nda/:token")
  @ApiOperation({ summary: "Download the NDA document for a deal via a signed email link (no login required)" })
  @ApiParam({ name: "token", description: "Signed NDA download token from an introduction or invitation email" })
  @ApiResponse({ status: 200, description: "NDA file streamed as an attachment" })
  @ApiResponse({ status: 400, description: "Invalid or expired token" })
  @ApiResponse({ status: 404, description: "Deal or NDA not found" })
  async downloadNdaByToken(
    @Param("token") token: string,
    @Res() res: Response,
  ) {
    const { buffer, filename, mimetype } = await this.dealsService.getNdaForDownload(token);
    const safeFilename = (filename || 'NDA').replace(/[\r\n"]/g, '');
    res.setHeader('Content-Type', mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buffer);
  }

}
