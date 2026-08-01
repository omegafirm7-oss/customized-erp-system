import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { JwtPayload } from "../../auth/types/jwt-payload.type";

/**
 * Gates the cross-tenant SaaS-provider dashboard. Deliberately separate from
 * PermissionsGuard, which is scoped to the active company — this checks a
 * flag on the user's identity itself, independent of which (if any) company
 * is active, since platform routes never take a companyId at all.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = request.user;
    if (!user?.isPlatformAdmin) {
      throw new ForbiddenException("Platform admin access required");
    }
    return true;
  }
}
