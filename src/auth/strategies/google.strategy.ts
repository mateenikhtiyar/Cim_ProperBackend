import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile, StrategyOptions } from 'passport-google-oauth20';
import { AuthService } from '../auth.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private authService: AuthService, private configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');
    console.log('Google Client ID:', clientID); // Debug log
    console.log('Google Client Secret:', clientSecret); // Debug log

    if (!clientID || !clientSecret) {
      throw new Error('Google OAuth credentials are missing');
    }

    super({
      clientID,
      clientSecret,
      callbackURL: `${configService.get<string>('BACKEND_URL')}/buyers/google/callback`, // Use BACKEND_URL
      scope: ['email', 'profile'],
    } as StrategyOptions);
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback): Promise<any> {
    const { name, emails, photos, id } = profile;

    const user = {
      email: emails?.[0]?.value,
      name: `${name?.givenName || ''} ${name?.familyName || ''}`.trim(),
      picture: photos?.[0]?.value,
      sub: id,
    };

    done(null, user);
  }
}