import { createParamDecorator, ExecutionContext, ForbiddenException } from "@nestjs/common";

/**
 * Resolves the caller's active company from the validated JWT only — never
 * from a client-supplied header — so a request can't claim access to a
 * company the token wasn't issued for. Switching companies re-issues the
 * token via POST /auth/switch-company.
 */
export const CurrentCompanyId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  const companyId = request.user?.activeCompanyId;
  if (!companyId) {
    throw new ForbiddenException("No active company selected for this session");
  }
  return companyId;
});
