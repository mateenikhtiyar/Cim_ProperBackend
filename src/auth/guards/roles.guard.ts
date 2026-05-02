import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common"
import { Reflector } from "@nestjs/core"
import { ROLES_KEY } from "../../decorators/roles.decorator"

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredRoles) {
      return true // No role requirements specified, allow access
    }

    const { user } = context.switchToHttp().getRequest()

    if (!user) {
      return false // No user in request, deny access
    }

    // Check if the user's role is in the required roles
    // Also allow team members to access their parent role's routes
    // e.g., "seller-member" can access routes requiring "seller" (subject to permission checks)
    const memberToParentRole: Record<string, string> = {
      "seller-member": "seller",
      "buyer-member": "buyer",
    }

    return requiredRoles.some((role) => {
      if (user.role === role) return true
      // Allow member roles when the parent role is required
      const parentRole = memberToParentRole[user.role]
      return parentRole === role
    })
  }
}
