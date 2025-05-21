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
    return requiredRoles.some((role) => user.role === role)
  }
}
