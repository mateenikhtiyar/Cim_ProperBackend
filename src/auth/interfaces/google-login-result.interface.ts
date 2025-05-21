import { Buyer } from "../../buyers/schemas/buyer.schema"

export interface GoogleLoginResult {
  access_token: string
  isNewUser: boolean
  user: Buyer & { _id: string }
}
