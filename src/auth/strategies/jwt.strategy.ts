import { Injectable, UnauthorizedException } from "@nestjs/common"
import { PassportStrategy } from "@nestjs/passport"
import { ExtractJwt, Strategy } from "passport-jwt"
import { InjectModel } from "@nestjs/mongoose"
import { Model } from "mongoose"
import { RevokedToken, RevokedTokenDocument } from "../schemas/revoked-token.schema"

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(RevokedToken.name)
    private readonly revokedTokenModel: Model<RevokedTokenDocument>,
  ) {
    const jwtSecret = process.env.JWT_SECRET
    if (!jwtSecret || jwtSecret.length < 10) {
      throw new Error("JWT_SECRET must be set and at least 10 characters long.")
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    })
  }

  async validate(payload: any) {
    if (!payload?.jti) {
      throw new UnauthorizedException("Token missing jti.");
    }

    const revoked = await this.revokedTokenModel.findOne({ jti: payload.jti }).lean().exec();
    if (revoked) {
      throw new UnauthorizedException("Token has been revoked.");
    }

    const user: any = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role || "buyer",
    }

    // Include team member fields if present
    if (payload.isTeamMember) {
      user.isTeamMember = true
      user.ownerId = payload.ownerId
      user.permissions = payload.permissions || []
      user.ownerType = payload.ownerType
    }

    return user
  }
}
