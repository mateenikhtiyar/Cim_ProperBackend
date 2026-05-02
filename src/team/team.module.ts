import { Module, forwardRef } from "@nestjs/common"
import { MongooseModule } from "@nestjs/mongoose"
import { TeamMember, TeamMemberSchema } from "./schemas/team-member.schema"
import { TeamService } from "./team.service"
import { TeamController } from "./team.controller"
import { Buyer, BuyerSchema } from "../buyers/schemas/buyer.schema"
import { Seller, SellerSchema } from "../sellers/schemas/seller.schema"
import { MailModule } from "../mail/mail.module"
import { AuthModule } from "../auth/auth.module"

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Buyer.name, schema: BuyerSchema },
      { name: Seller.name, schema: SellerSchema },
    ]),
    MailModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [TeamController],
  providers: [TeamService],
  exports: [TeamService, MongooseModule],
})
export class TeamModule {}
