import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class SellerGoogleAuthGuard extends AuthGuard("seller-google") { }