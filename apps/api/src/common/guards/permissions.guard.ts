import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY, SENSITIVE_KEY } from "../decorators/permissions.decorator";
import { IamService } from "../../iam/iam.service";
import { JwtPayload } from "../../auth/types/jwt-payload.type";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly iamService: IamService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const anyOf = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const hasRequired = required && required.length > 0;
    const hasAnyOf = anyOf && anyOf.length > 0;
    if (!hasRequired && !hasAnyOf) {
      return true;
    }

    const isSensitive = this.reflector.getAllAndOverride<boolean>(SENSITIVE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = request.user;
    if (!user) {
      throw new ForbiddenException("Not authenticated");
    }

    const grantedPermissions = isSensitive ? await this.loadFreshPermissions(user) : user.permissions;

    if (hasRequired) {
      const missing = required.filter((permission) => !grantedPermissions.includes(permission));
      if (missing.length > 0) {
        throw new ForbiddenException(`Missing required permission(s): ${missing.join(", ")}`);
      }
    }

    if (hasAnyOf && !anyOf.some((permission) => grantedPermissions.includes(permission))) {
      throw new ForbiddenException(`Missing required permission(s): one of ${anyOf.join(", ")}`);
    }

    return true;
  }

  private async loadFreshPermissions(user: JwtPayload): Promise<string[]> {
    if (!user.activeCompanyId) {
      return [];
    }
    return this.iamService.getPermissionsForCompanyUser(user.sub, user.activeCompanyId);
  }
}
