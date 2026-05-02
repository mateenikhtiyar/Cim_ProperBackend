import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  UsePipes,
  ValidationPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common"
import { FileInterceptor } from "@nestjs/platform-express"
import { memoryStorage } from "multer"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard"
import { RolesGuard } from "../auth/guards/roles.guard"
import { Roles } from "../decorators/roles.decorator"
import { TeamService } from "./team.service"
import { CreateTeamMemberDto } from "./dto/create-team-member.dto"
import { UpdateTeamMemberDto, UpdateMemberProfileDto, ChangeMemberPasswordDto } from "./dto/update-team-member.dto"

const MAX_TEAM_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB

const teamAvatarUpload = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_TEAM_AVATAR_BYTES },
  fileFilter: (_req: any, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (!/^image\/(jpe?g|png|gif|webp)$/.test(file.mimetype)) {
      return cb(new BadRequestException("Only JPG, PNG, GIF, or WEBP images are allowed"), false)
    }
    cb(null, true)
  },
}

@ApiTags("team")
@Controller("team")
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  // ─── Owner endpoints ─────────────────────────────────

  @Post("members")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "buyer")
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({ summary: "Add a new team member" })
  @ApiResponse({ status: 201, description: "Team member created and invitation sent" })
  async createMember(@Request() req: any, @Body() dto: CreateTeamMemberDto) {
    return this.teamService.createMember(dto, req.user.userId, req.user.role)
  }

  @Get("members")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "buyer")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List team members for the authenticated owner" })
  async getMembers(@Request() req: any) {
    return this.teamService.getMembers(req.user.userId, req.user.role)
  }

  @Get("members/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "buyer")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get a specific team member" })
  async getMember(@Request() req: any, @Param("id") id: string) {
    return this.teamService.getMemberById(id, req.user.userId)
  }

  @Patch("members/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "buyer")
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({ summary: "Update a team member" })
  async updateMember(
    @Request() req: any,
    @Param("id") id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.teamService.updateMember(id, req.user.userId, dto)
  }

  @Delete("members/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "buyer")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove a team member" })
  async deleteMember(@Request() req: any, @Param("id") id: string) {
    return this.teamService.deleteMember(id, req.user.userId)
  }

  @Post("members/:id/reset-password")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller", "buyer")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Reset a team member's password and resend invite" })
  async resetMemberPassword(@Request() req: any, @Param("id") id: string) {
    return this.teamService.resetMemberPassword(id, req.user.userId)
  }

  // ─── Member self-service ─────────────────────────────

  @Get("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller-member", "buyer-member")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get own team member profile" })
  async getMyProfile(@Request() req: any) {
    return this.teamService.getMemberProfile(req.user.userId)
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller-member", "buyer-member")
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({ summary: "Update own name / profile picture" })
  async updateMyProfile(@Request() req: any, @Body() dto: UpdateMemberProfileDto) {
    return this.teamService.updateMemberProfile(req.user.userId, dto)
  }

  @Post("me/change-password")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller-member", "buyer-member")
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({ summary: "Change own password" })
  async changeMyPassword(@Request() req: any, @Body() dto: ChangeMemberPasswordDto) {
    return this.teamService.changeMemberPassword(req.user.userId, dto)
  }

  @Post("me/upload-profile-picture")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("seller-member", "buyer-member")
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor("profilePicture", teamAvatarUpload))
  @ApiOperation({ summary: "Upload own profile picture" })
  async uploadProfilePicture(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("No file uploaded")
    }
    const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`
    return this.teamService.updateMemberProfile(req.user.userId, {
      profilePicture: dataUrl,
    })
  }

  // ─── Admin endpoints ─────────────────────────────────

  @Get("admin/all")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List all team members across all organizations" })
  async getAllMembers(
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.teamService.getAllMembers(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 50,
    )
  }

  @Get("admin/by-owner/:ownerId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "List team members for a specific owner" })
  async getMembersByOwner(@Param("ownerId") ownerId: string) {
    return this.teamService.getMembersByOwner(ownerId)
  }

  @Post("admin/members")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({ summary: "Add a team member to any organization (admin)" })
  async adminCreateMember(@Request() req: any, @Body() dto: CreateTeamMemberDto) {
    return this.teamService.adminCreateMember(dto, req.user.userId)
  }

  @Patch("admin/members/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({ summary: "Update any team member (admin)" })
  async adminUpdateMember(
    @Param("id") id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.teamService.adminUpdateMember(id, dto)
  }

  @Delete("admin/members/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove any team member (admin)" })
  async adminDeleteMember(@Param("id") id: string) {
    return this.teamService.adminDeleteMember(id)
  }
}
