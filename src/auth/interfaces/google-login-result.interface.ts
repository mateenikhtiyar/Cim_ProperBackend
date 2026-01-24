import { Buyer } from "../../buyers/schemas/buyer.schema"

export interface GoogleLoginResult {
  access_token: string
  refresh_token: string
  expires_in: number
  isNewUser: boolean
  user: Buyer & { _id: string }
}
