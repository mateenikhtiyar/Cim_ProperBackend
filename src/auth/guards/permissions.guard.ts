import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { PERMISSIONS_KEY } from "../../decorators/permissions.decorator"

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    )

    if (!requiredPermissions) {
      return true
    }

    const { user } = context.switchToHttp().getRequest()

    if (!user) {
      return false
    }

    // Owners (seller, buyer) and admins have all permissions
    if (["seller", "buyer", "admin"].includes(user.role)) {
      return true
    }

    // Team members must have the required permission
    if (["seller-member", "buyer-member"].includes(user.role)) {
      const userPermissions: string[] = user.permissions || []
      return requiredPermissions.some((perm) => userPermissions.includes(perm))
    }

    return false
  }
}
