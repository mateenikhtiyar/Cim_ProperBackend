import { Injectable, UnauthorizedException, Inject, forwardRef } from "@nestjs/common"
import { PassportStrategy } from "@nestjs/passport"
import { Strategy } from "passport-local"
import { AuthService } from "../auth.service"  // Remove the 'type' keyword

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(forwardRef(() => AuthService)) private authService: AuthService
  ) {
    super({
      usernameField: "email",
      passReqToCallback: true,
    })
  }

  async validate(req: any, email: string, password: string): Promise<any> {
    // Check user type for proper authentication
    const userType = req.body.userType || "buyer"

    const user = await this.authService.validateUser(email, password, userType as "buyer" | "admin" | "seller")
    if (!user) {
      throw new UnauthorizedException("Invalid credentials")
    }
    return user
  }
}