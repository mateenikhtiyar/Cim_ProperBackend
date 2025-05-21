import { Seller } from "../../sellers/schemas/seller.schema";

export interface GoogleSellerLoginResult {
    access_token: string;
    isNewUser: boolean;
    user: Seller & { _id: string };
}