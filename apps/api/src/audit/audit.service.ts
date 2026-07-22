import { Injectable } from "@nestjs/common";
import { AuditAction } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";

export interface AuditLogInput {
  companyId?: string | null;
  entityName: string;
  entityId: string;
  action: AuditAction;
  changedByUserId?: string | null;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        companyId: input.companyId ?? null,
        entityName: input.entityName,
        entityId: input.entityId,
        action: input.action,
        changedByUserId: input.changedByUserId ?? null,
        beforeSnapshot: input.beforeSnapshot as never,
        afterSnapshot: input.afterSnapshot as never,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }
}
