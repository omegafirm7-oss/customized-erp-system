import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";

/**
 * Runs after JwtAuthGuard on protected routes. Does not trust any client
 * header for company scoping — the active company is whatever the validated
 * JWT says (set at login / POST /auth/switch-company). This interceptor's
 * job is to make that value available on the request in one consistent
 * place (`request.companyId`) for downstream interceptors like AuditInterceptor,
 * rather than re-deriving it ad hoc. Route handlers that need the value use
 * the @CurrentCompanyId() decorator, which reads the same JWT field directly.
 */
@Injectable()
export class CompanyContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    if (request.user) {
      request.companyId = request.user.activeCompanyId ?? null;
      request.userId = request.user.sub ?? null;
    }
    return next.handle();
  }
}
