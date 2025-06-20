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
} from "@nestjs/common"
import { FilesInterceptor } from "@nestjs/platform-express"
import { diskStorage } from "multer"
import { extname } from "path"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags, ApiParam, ApiBody, ApiConsumes } from "@nestjs/swagger"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { DealsService } from "./deals.service"
import { CreateDealDto } from "./dto/create-deal.dto"
import { UpdateDealDto } from "./dto/update-deal.dto"
import { DealResponseDto } from "./dto/deal-response.dto"
import { Express } from "express"

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
  path: string;
  size: number;
  mimetype: string;
  uploadedAt: Date;
}

@ApiTags("deals")
@Controller("deals")
export class DealsController {
  constructor(private readonly dealsService: DealsService) { }

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
  @UseInterceptors(
    FilesInterceptor("files", 10, {
      storage: diskStorage({
        destination: "./uploads/deal-documents",
        filename: (req: any, file, cb) => {
          const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
          const ext = extname(file.originalname)
          const userId = req.user?.userId || "unknown"
          const sanitizedOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")
          cb(null, `${userId}_${uniqueSuffix}_${sanitizedOriginalName}`)
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|jpg|jpeg|png|gif)$/i
        if (!file.originalname.match(allowedTypes)) {
          return cb(new Error("Only document and image files are allowed!"), false)
        }
        cb(null, true)
      },
      limits: {
        fileSize: 1024 * 1024 * 10, // 10MB limit per file
      },
    }),
  )
  async create(
    @Body() body: { dealData: string },
    @Request() req: RequestWithUser,
    @UploadedFiles() files?: Express.Multer.File[]
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException('User not authenticated')
    }
  
    let createDealDto: CreateDealDto
    try {
      createDealDto = JSON.parse(body.dealData)
    } catch {
      throw new BadRequestException('Invalid JSON in dealData field')
    }
  
    // Gather uploaded file data
    const documents = files?.map((file) => ({
      filename: file.filename,
      originalName: file.originalname,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date(),
    })) || []
  
    // Merge seller and documents into the DTO
    const dealWithSellerAndDocuments: CreateDealDto = {
      ...createDealDto,
      seller: req.user.userId,
      // If you changed your schema's `documents` to accept an array of `DocumentInfo`,
      // this will work; if it's just file paths, do: documents.map(doc => doc.path)
      documents,
    }
  
    // Save the deal
    return this.dealsService.create(dealWithSellerAndDocuments)
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
      // Allow up to 10 files
      storage: diskStorage({
        destination: "./uploads/deal-documents",
        filename: (req: any, file, cb) => {
          const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9)
          const ext = extname(file.originalname)
          const dealId = req.params.id
          const sanitizedOriginalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")
          cb(null, `${dealId}_${uniqueSuffix}_${sanitizedOriginalName}`)
        },
      }),
      fileFilter: (req, file, cb) => {
        // Allow common document types
        const allowedTypes = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|jpg|jpeg|png|gif)$/i
        if (!file.originalname.match(allowedTypes)) {
          return cb(new Error("Only document and image files are allowed!"), false)
        }
        cb(null, true)
      },
      limits: {
        fileSize: 1024 * 1024 * 10, // 10MB limit per file
      },
    }),
  )
  async uploadDocuments(
    @Param("id") dealId: string,
    @Request() req: RequestWithUser,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }

    // Verify the seller owns this deal
    const deal = await this.dealsService.findOne(dealId)
    if (deal.seller.toString() !== req.user.userId) {
      throw new ForbiddenException("You don't have permission to upload documents for this deal")
    }

    if (!files || files.length === 0) {
      throw new Error("No files uploaded")
    }

    const documentPaths = files.map((file) => ({
      filename: file.filename,
      originalName: file.originalname,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date(),
    }))

    const updatedDeal = await this.dealsService.addDocuments(dealId, documentPaths)

    return {
      message: "Documents uploaded successfully",
      uploadedFiles: documentPaths.length,
      documents: documentPaths,
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }

    // Verify the seller owns this deal
    const deal = await this.dealsService.findOne(dealId)
    if (deal.seller.toString() !== req.user.userId) {
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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get("completed")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get completed deals for the seller" })
  @ApiResponse({ status: 200, description: "Return completed deals", type: [DealResponseDto] })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role" })
  async getCompletedDeals(@Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.dealsService.getCompletedDeals(req.user.userId);
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
  @Get(":id/buyer-interactions")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get buyer interactions for a deal (seller only)" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return buyer interactions for the deal" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  async getDealBuyerInteractions(@Param("id") dealId: string, @Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }

    // Verify the seller owns this deal
    const deal = await this.dealsService.findOne(dealId)
    if (deal.seller.toString() !== req.user.userId) {
      throw new ForbiddenException("You don't have permission to view interactions for this deal")
    }

    return this.dealsService.getBuyerInteractionsForDeal(dealId)
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
  @Get(":id/status-summary")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get deal status summary with buyer breakdown (seller only)" })
  @ApiParam({ name: "id", description: "Deal ID" })
  @ApiResponse({ status: 200, description: "Return deal status summary" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  async getDealStatusSummary(@Param("id") dealId: string, @Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }

    // Verify the seller owns this deal
    const deal = await this.dealsService.findOne(dealId)
    if (deal.seller.toString() !== req.user.userId) {
      throw new ForbiddenException("You don't have permission to view this deal's status")
    }

    return this.dealsService.getDealWithBuyerStatusSummary(dealId)
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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller")
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
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal closed successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  async closeDealBySeller(
    @Param("id") dealId: string,
    @Body() body: { finalSalePrice?: number; notes?: string; winningBuyerId?: string },
    @Request() req: RequestWithUser,
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }

    const closedDeal = await this.dealsService.closeDealseller(
      dealId,
      req.user.userId,
      body.finalSalePrice,
      body.notes,
      body.winningBuyerId,
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
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }

    return this.dealsService.updateDealStatusByBuyer(dealId, req.user.userId, body.status, body.notes)
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
      },
    },
  })
  @ApiResponse({ status: 200, description: "Deal closed successfully" })
  @ApiResponse({ status: 403, description: "Forbidden - requires seller role and ownership" })
  async closeDeal(
    @Param("id") dealId: string,
    @Body() body: { finalSalePrice?: number; notes?: string; winningBuyerId?: string },
    @Request() req: RequestWithUser,
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException("User not authenticated")
    }

    try {
      const closedDeal = await this.dealsService.closeDealseller(
        dealId,
        req.user.userId,
        body.finalSalePrice,
        body.notes,
        body.winningBuyerId,
      )

      return {
        message: "Deal closed successfully",
        deal: closedDeal,
      }
    } catch (error) {
      console.error("Error closing deal:", error)
      throw error
    }
  }
}