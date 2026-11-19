import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { AuditInterceptor } from "./audit.interceptor";
import { AuditController } from "./audit.controller";
import { AuditEventsController } from "./audit-events.controller";

@Module({
  controllers: [AuditController, AuditEventsController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
