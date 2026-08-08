import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ModuleKey } from "@erp/shared-constants";
import { REQUIRES_MODULE_KEY } from "../decorators/requires-module.decorator";
import { JwtPayload } from "../../auth/types/jwt-payload.type";

@Injectable()
export class ModuleEntitlementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredModule = this.reflector.getAllAndOverride<ModuleKey | undefined>(REQUIRES_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredModule) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = request.user;
    if (!user) {
      throw new ForbiddenException("Not authenticated");
    }
    if (user.isPlatformAdmin) {
      return true;
    }
    if (!user.enabledModules?.includes(requiredModule)) {
      throw new ForbiddenException(`This company is not entitled to the "${requiredModule}" module`);
    }
    return true;
  }
}
