import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { AuditAction } from "@prisma/client";
import { Observable, tap } from "rxjs";
import { AuditService } from "./audit.service";

const METHOD_TO_ACTION: Record<string, AuditAction> = {
  POST: AuditAction.CREATE,
  PATCH: AuditAction.UPDATE,
  PUT: AuditAction.UPDATE,
  DELETE: AuditAction.DELETE,
};

/**
 * Generic, always-on audit trail for every mutating request: records who
 * changed what and when, keyed off the controller name and response body.
 * This is intentionally lightweight (no "before" snapshot — that requires
 * knowing how to fetch prior state, which is entity-specific). High-value
 * actions (journal posting/reversal, period close, role changes, user
 * invite/deactivate) additionally call AuditService.log() explicitly from
 * their own services with a proper before/after diff — see gl-posting.service.ts
 * and companies.service.ts for examples.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const action = METHOD_TO_ACTION[request.method as string];

    if (!action) {
      return next.handle();
    }

    const entityName = context.getClass().name.replace(/Controller$/, "");
    const companyId: string | null = request.companyId ?? request.user?.activeCompanyId ?? null;
    const changedByUserId: string | null = request.userId ?? request.user?.sub ?? null;
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers?.["user-agent"] ?? null;

    return next.handle().pipe(
      tap((responseBody) => {
        const entityId =
          request.params?.id ?? (responseBody && typeof responseBody === "object" ? (responseBody as any).id : undefined);
        if (!entityId) {
          return;
        }
        void this.auditService.log({
          companyId,
          entityName,
          entityId,
          action,
          changedByUserId,
          afterSnapshot: responseBody,
          ipAddress,
          userAgent,
        });
      }),
    );
  }
}
