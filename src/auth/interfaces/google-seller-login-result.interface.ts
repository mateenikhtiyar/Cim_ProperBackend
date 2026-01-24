import { Seller } from "../../sellers/schemas/seller.schema";

export interface GoogleSellerLoginResult {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    isNewUser: boolean;
    user: Seller & { _id: string };
}