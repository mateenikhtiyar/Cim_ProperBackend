import { Module, Logger, forwardRef } from "@nestjs/common"
import { PassportModule } from "@nestjs/passport"
import { JwtModule } from "@nestjs/jwt"
import { ConfigModule, ConfigService } from "@nestjs/config"
import { AuthService } from "./auth.service"
import { AuthController } from "./auth.controller"
import { LocalStrategy } from "./strategies/local.strategy"
import { JwtStrategy } from "./strategies/jwt.strategy"
import { RolesGuard } from "../auth/guards/roles.guard"
import { MailService } from "mail/mail.service"
import { MongooseModule } from "@nestjs/mongoose"
import { BuyersModule } from '../buyers/buyers.module';
import { SellersModule } from '../sellers/sellers.module';
import { MailModule } from '../mail/mail.module';
import { AdminModule } from '../admin/admin.module';
import { Buyer, BuyerSchema } from '../buyers/schemas/buyer.schema';
import { Seller, SellerSchema } from '../sellers/schemas/seller.schema';
import { RevokedToken, RevokedTokenSchema } from "./schemas/revoked-token.schema";
import { ActivityLog, ActivityLogSchema } from "./schemas/activity-log.schema";
import { TeamMember, TeamMemberSchema } from "../team/schemas/team-member.schema";

const getValidatedJwtSecret = (configService: ConfigService): string => {
  const secret = configService.get<string>("JWT_SECRET");
  if (!secret || secret.length < 10) {
    throw new Error("JWT_SECRET must be set and at least 10 characters long.");
  }
  return secret;
};

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Buyer.name, schema: BuyerSchema },
      { name: Seller.name, schema: SellerSchema },
      { name: RevokedToken.name, schema: RevokedTokenSchema },
      { name: ActivityLog.name, schema: ActivityLogSchema },
      { name: TeamMember.name, schema: TeamMemberSchema },
    ]),
    forwardRef(() => BuyersModule),
    forwardRef(() => SellersModule),
    forwardRef(() => AdminModule),
    MailModule,
    PassportModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const secret = getValidatedJwtSecret(configService);
        return {
          secret,
          signOptions: { expiresIn: "1d" },
        }
      },
      inject: [ConfigService],
    }),
  ],
  
  controllers: [AuthController],
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    RolesGuard,
    
    {
      provide: "LOGGER",
      useFactory: () => {
        const logger = new Logger("AuthModule")
        logger.log("AuthModule LOGGER initialized")
        return logger
      },
    },
  ],
  exports: [AuthService, JwtModule, RolesGuard], // Export JwtModule
})
export class AuthModule {
  constructor() {
    const logger = new Logger("AuthModule")
    const imports = ["PassportModule", "ConfigModule", "JwtModule"]
    imports.forEach((importName, index) => {
      logger.log(`AuthModule import at index [${index}]: ${importName}`)
    })
  }
}
