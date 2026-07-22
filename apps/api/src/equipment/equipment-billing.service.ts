import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ControlAccountType, TimesheetStatus, UsageDayType, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ArService } from "../finance/ar.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { InvoiceLineDto } from "../finance/dto/invoice-line.dto";
import { computeUsageBilling, RateBasisKind, UsageSummary } from "./equipment-math";

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class EquipmentBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly arService: ArService,
    private readonly accountResolution: AccountResolutionService,
  ) {}

  /**
   * APPROVED usage log → AR draft: one line per assignment on the 4500
   * equipment-revenue account, dimensioned with the contract's cost center.
   * Mirrors the manpower billing flow, including the optimistic status-
   * guarded link against double-billing.
   */
  async generateInvoice(companyId: string, usageLogId: string, userId: string) {
    const usageLog = await this.prisma.usageLog.findFirst({
      where: { id: usageLogId, companyId },
      include: {
        contract: { include: { costCenter: true } },
        fiscalPeriod: true,
        entries: true,
      },
    });
    if (!usageLog) {
      throw new NotFoundException("Usage log not found");
    }
    if (usageLog.status !== TimesheetStatus.APPROVED) {
      throw new ConflictException(
        usageLog.status === TimesheetStatus.INVOICED
          ? "Usage log is already invoiced"
          : "Only approved usage logs can be billed — approve it first",
      );
    }

    const assignments = await this.prisma.equipmentAssignment.findMany({
      where: { contractId: usageLog.contractId },
      include: { equipment: { select: { code: true, name: true } } },
    });
    const assignmentById = new Map(assignments.map((a) => [a.id, a]));
    const settings = await this.prisma.hrSettings.findUniqueOrThrow({ where: { companyId } });

    const summaries = new Map<string, UsageSummary>();
    for (const entry of usageLog.entries) {
      const summary =
        summaries.get(entry.assignmentId) ??
        ({ recordedDays: 0, breakdownDays: 0, totalHours: ZERO } satisfies UsageSummary);
      summary.recordedDays += 1;
      if (entry.dayStatus === UsageDayType.BREAKDOWN) {
        summary.breakdownDays += 1;
      } else {
        summary.totalHours = summary.totalHours.add(entry.hoursUsed);
      }
      summaries.set(entry.assignmentId, summary);
    }

    const revenueAccount = await this.prisma.$transaction((tx) =>
      this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.EQUIPMENT_REVENUE),
    );

    const lines: InvoiceLineDto[] = [];
    for (const [assignmentId, summary] of summaries) {
      const assignment = assignmentById.get(assignmentId);
      if (!assignment) continue;
      const billing = computeUsageBilling(
        assignment.rateBasis as RateBasisKind,
        assignment.billRate,
        summary,
        settings.daysPerMonth,
      );
      if (billing) {
        lines.push({
          description: `${assignment.equipment.code} ${assignment.equipment.name} — ${billing.quantity} ${billing.unitLabel} @ ${billing.unitPrice}`,
          quantity: billing.quantity.toString(),
          unitPrice: billing.unitPrice.toString(),
          accountId: revenueAccount.id,
          costCenterId: usageLog.contract.costCenterId,
        });
      }
    }
    if (lines.length === 0) {
      throw new BadRequestException("Nothing billable on this usage log");
    }

    const now = new Date();
    const invoice = await this.arService.createDraft(companyId, userId, {
      businessPartnerId: usageLog.contract.businessPartnerId,
      issueDateTime: now.toISOString(),
      postingDate: now.toISOString(),
      dueDate: new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString(),
      memo: `Equipment rental ${usageLog.contract.code} — period ${usageLog.fiscalPeriod.periodNumber}`,
      lines,
    } as Parameters<ArService["createDraft"]>[2]);

    const linked = await this.prisma.usageLog.updateMany({
      where: { id: usageLogId, status: TimesheetStatus.APPROVED },
      data: { status: TimesheetStatus.INVOICED, salesInvoiceId: invoice.id },
    });
    if (linked.count === 0) {
      throw new ConflictException("Usage log status changed while generating the invoice");
    }

    await this.auditService.log({
      companyId,
      entityName: "UsageLog",
      entityId: usageLogId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: TimesheetStatus.INVOICED, salesInvoiceId: invoice.id },
    });

    return invoice;
  }
}
