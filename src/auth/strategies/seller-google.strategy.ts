import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, VerifyCallback, Profile, StrategyOptions } from "passport-google-oauth20";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "../auth.service";

@Injectable()
export class SellerGoogleStrategy extends PassportStrategy(Strategy, "seller-google") {
    constructor(
        private configService: ConfigService,
        private authService: AuthService
    ) {
        super({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: configService.get<string>("SELLER_GOOGLE_CALLBACK_URL") || "http://localhost:3001/sellers/google/callback",
            scope: ["email", "profile"]
        } as StrategyOptions);
    }

    async validate(
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: VerifyCallback
    ): Promise<any> {
        const { name, emails, photos, id } = profile;
        const user = {
            email: emails?.[0]?.value,
            name: `${name?.givenName || ""} ${name?.familyName || ""}`.trim(),
            picture: photos?.[0]?.value,
            sub: id,
        };

        // Use authService to handle the Google login
        const authenticatedUser = await this.authService.loginSellerWithGoogle(user);

        // Pass the user to the guard
        done(null, authenticatedUser);
    }
}