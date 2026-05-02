// src/mail/mail.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CommunicationLog, CommunicationLogSchema } from './schemas/communication-log.schema';
import { EmailQueue, EmailQueueSchema } from './schemas/email-queue.schema';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { Buyer, BuyerSchema } from '../buyers/schemas/buyer.schema';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import { TeamMember, TeamMemberSchema } from '../team/schemas/team-member.schema';
import { DealsModule } from '../deals/deals.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CommunicationLog.name, schema: CommunicationLogSchema },
      { name: EmailQueue.name, schema: EmailQueueSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Buyer.name, schema: BuyerSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: Admin.name, schema: AdminSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
    forwardRef(() => DealsModule),
  ],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
