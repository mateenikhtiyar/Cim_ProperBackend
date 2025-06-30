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
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../decorators/roles.decorator';
import { CompanyProfileService } from './company-profile.service';
import { CreateCompanyProfileDto } from './dto/create-company-profile.dto';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';

interface RequestWithUser extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
}

@ApiTags('company-profiles')
@Controller('company-profiles')
export class CompanyProfileController {
  constructor(private readonly companyProfileService: CompanyProfileService) { }

  @UseGuards(JwtAuthGuard)
  @Roles('buyer')  // Only buyers can create company profiles
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new company profile' })
  @ApiResponse({ status: 201, description: 'Company profile created successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires buyer role' })
  async create(
    @Request() req: RequestWithUser,
    @Body() createCompanyProfileDto: CreateCompanyProfileDto
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.companyProfileService.create(
      req.user.userId,
      createCompanyProfileDto
    );
  }

  @UseGuards(JwtAuthGuard)
  @Roles('buyer')
  @Get('my-profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current buyer\'s company profile' })
  @ApiResponse({ status: 200, description: 'Return the company profile' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires buyer role' })
  @ApiResponse({ status: 404, description: 'Company profile not found' })
  async findMyProfile(@Request() req: RequestWithUser) {
    if (!req.user?.userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    try {
      return await this.companyProfileService.findByBuyerId(req.user.userId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { exists: false, message: 'Company profile not created yet' };
      }
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Roles('buyer')
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a company profile by ID' })
  @ApiParam({ name: 'id', type: String, description: 'Company profile ID' })
  @ApiResponse({ status: 200, description: 'Return the company profile' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin or buyer role' })
  @ApiResponse({ status: 404, description: 'Company profile not found' })
  async findOne(@Param('id') id: string) {
    return this.companyProfileService.findOne(id);
  }

  @Get('public/:id')
  @ApiOperation({ summary: 'Get a company profile by ID (public access)' })
  @ApiParam({ name: 'id', type: String, description: 'Company profile ID' })
  @ApiResponse({ status: 200, description: 'Return the company profile' })
  @ApiResponse({ status: 404, description: 'Company profile not found' })
  async findOnePublic(@Param('id') id: string) {
    return this.companyProfileService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Roles('buyer')
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a company profile' })
  @ApiParam({ name: 'id', type: String, description: 'Company profile ID' })
  @ApiResponse({ status: 200, description: 'Company profile updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires buyer role or profile ownership' })
  @ApiResponse({ status: 404, description: 'Company profile not found' })
  async update(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
    @Body() updateCompanyProfileDto: UpdateCompanyProfileDto
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.companyProfileService.update(
      id,
      req.user.userId,
      updateCompanyProfileDto
    );
  }

  @UseGuards(JwtAuthGuard)
  @Roles('buyer')
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a company profile' })
  @ApiParam({ name: 'id', type: String, description: 'Company profile ID' })
  @ApiResponse({ status: 200, description: 'Company profile deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires admin role or profile ownership' })
  @ApiResponse({ status: 404, description: 'Company profile not found' })
  async remove(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ) {
    if (!req.user?.userId) {
      throw new UnauthorizedException('User not authenticated');
    }


    await this.companyProfileService.remove(id, req.user.userId);


    return { message: 'Company profile deleted successfully' };
  }
}