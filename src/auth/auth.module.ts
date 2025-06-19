import { Module, Logger, forwardRef } from "@nestjs/common"
import { PassportModule } from "@nestjs/passport"
import { JwtModule } from "@nestjs/jwt"
import { ConfigModule, ConfigService } from "@nestjs/config"
import { AuthService } from "./auth.service"
import { AuthController } from "./auth.controller"
import { LocalStrategy } from "./strategies/local.strategy"
import { JwtStrategy } from "./strategies/jwt.strategy"
import { GoogleStrategy } from "./strategies/google.strategy"
import { SellerGoogleStrategy } from "./strategies/seller-google.strategy"
import { RolesGuard } from "../auth/guards/roles.guard"
import { SharedModule } from "../shared.module"
import { MailService } from "mail/mail.service"

@Module({
  imports: [
    forwardRef(() => SharedModule), // Handle circular dependency
    PassportModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const secret = configService.get<string>("JWT_SECRET", "your-secret-key")
        Logger.log(`JWT Module initialized with secret: ${secret.substring(0, 3)}...`, "AuthModule")
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
    MailService,
    GoogleStrategy,
    SellerGoogleStrategy,
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
    const imports = ["SharedModule", "PassportModule", "ConfigModule", "JwtModule"]
    imports.forEach((importName, index) => {
      logger.log(`AuthModule import at index [${index}]: ${importName}`)
    })
  }
}