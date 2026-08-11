import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { AuditInterceptor } from "./audit.interceptor";
import { AuditController } from "./audit.controller";

@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
