import { Injectable } from "@nestjs/common"
import { PassportStrategy } from "@nestjs/passport"
import { Strategy, VerifyCallback, Profile, StrategyOptions } from "passport-google-oauth20"
import { AuthService } from "../auth.service" // Remove the 'type' keyword

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor(private authService: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3001/buyers/google/callback",
      scope: ["email", "profile"],
    } as StrategyOptions)
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback): Promise<any> {
    const { name, emails, photos, id } = profile

    const user = {
      email: emails?.[0]?.value,
      name: `${name?.givenName || ""} ${name?.familyName || ""}`.trim(),
      picture: photos?.[0]?.value,
      sub: id,
    }

    done(null, user)
  }
}
