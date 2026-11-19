import { Injectable, NotFoundException } from "@nestjs/common";
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

export interface ListActivityLogFilter {
  userId?: string;
  action?: AuditAction;
  entityName?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
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

  /**
   * Company-scoped activity feed for the admin-facing screen — who did what,
   * when. `changedByUserId` has no DB relation to User (a deliberate,
   * lightweight append-only design so a deleted user doesn't cascade or
   * block deleting audit history), so the user names are joined in-memory
   * here rather than via a Prisma `include`.
   */
  async list(companyId: string, filter: ListActivityLogFilter) {
    const where = {
      companyId,
      ...(filter.userId ? { changedByUserId: filter.userId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.entityName ? { entityName: filter.entityName } : {}),
      ...(filter.from || filter.to
        ? {
            changedAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { changedAt: "desc" },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.changedByUserId).filter((id): id is string => id !== null))];
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, fullName: true } })
      : [];
    const usersById = new Map(users.map((u) => [u.id, u]));

    return {
      items: rows.map((r) => ({
        id: r.id,
        changedAt: r.changedAt,
        action: r.action,
        entityName: r.entityName,
        entityId: r.entityId,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        // What was acted on, for events that carry it (for example which timesheet was downloaded).
        details: r.action === AuditAction.DOWNLOAD ? (r.afterSnapshot ?? null) : null,
        user: r.changedByUserId ? (usersById.get(r.changedByUserId) ?? null) : null,
      })),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }

  /** The kinds of record that appear in this company's log, for the filter drop-down. */
  async recordTypes(companyId: string) {
    const rows = await this.prisma.auditLog.groupBy({ by: ["entityName"], where: { companyId }, _count: { _all: true }, orderBy: { entityName: "asc" } });
    return rows.map((r) => ({ entityName: r.entityName, count: r._count._all }));
  }

  /**
   * Records that someone downloaded (or sent over WhatsApp) an employee's timesheet PDF. The names and the
   * period come from the database, not from what the browser claims, so the entry can't be made to say
   * something else.
   */
  async logTimesheetDownload(
    companyId: string,
    userId: string,
    input: { employeeId: string; periodId?: string; channel: "DOWNLOAD" | "WHATSAPP" },
    meta: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    const employee = await this.prisma.employee.findFirst({ where: { id: input.employeeId, companyId }, select: { id: true, code: true, nameEn: true } });
    if (!employee) throw new NotFoundException("Employee not found");
    const period = input.periodId
      ? await this.prisma.fiscalPeriod.findFirst({ where: { id: input.periodId, companyId }, select: { startDate: true, endDate: true } })
      : null;
    await this.log({
      companyId,
      entityName: "Timesheet PDF",
      entityId: employee.id,
      action: AuditAction.DOWNLOAD,
      changedByUserId: userId,
      afterSnapshot: {
        employeeCode: employee.code,
        employeeName: employee.nameEn,
        period: period ? `${period.startDate.toISOString().slice(0, 10)} to ${period.endDate.toISOString().slice(0, 10)}` : null,
        via: input.channel === "WHATSAPP" ? "Sent via WhatsApp" : "Downloaded",
      },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    });
  }
}
