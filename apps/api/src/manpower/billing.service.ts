import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ControlAccountType, TimesheetDayType, TimesheetStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ArService } from "../finance/ar.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { InvoiceLineDto } from "../finance/dto/invoice-line.dto";
import { computeAssignmentBilling, EntrySummary, RateBasisKind } from "./manpower-math";

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly arService: ArService,
    private readonly accountResolution: AccountResolutionService,
  ) {}

  /**
   * Turns an APPROVED timesheet into an AR draft invoice: one line per
   * assignment (plus an OT line where billable) on the 4400 manpower-revenue
   * account, every line dimensioned with the contract's cost center. The
   * invoice then posts/clears through the normal AR + ZATCA flow.
   */
  async generateInvoice(companyId: string, timesheetId: string, userId: string) {
    const timesheet = await this.prisma.timesheet.findFirst({
      where: { id: timesheetId, companyId },
      include: {
        contract: { include: { costCenter: true } },
        fiscalPeriod: true,
        entries: true,
      },
    });
    if (!timesheet) {
      throw new NotFoundException("Timesheet not found");
    }
    if (timesheet.status !== TimesheetStatus.APPROVED) {
      throw new ConflictException(
        timesheet.status === TimesheetStatus.INVOICED
          ? "Timesheet is already invoiced"
          : "Only approved timesheets can be billed — approve it first",
      );
    }

    const assignments = await this.prisma.manpowerAssignment.findMany({
      where: { contractId: timesheet.contractId },
      include: { employee: { select: { code: true, nameEn: true } } },
    });
    const assignmentById = new Map(assignments.map((a) => [a.id, a]));
    const settings = await this.prisma.hrSettings.findUniqueOrThrow({ where: { companyId } });

    // Summarize entries per assignment. Hours/OT only count on WORKED days.
    const summaries = new Map<string, EntrySummary>();
    for (const entry of timesheet.entries) {
      const summary =
        summaries.get(entry.assignmentId) ??
        ({
          recordedDays: 0,
          workedDays: 0,
          absentDays: 0,
          unpaidDays: 0,
          totalHours: ZERO,
          totalOtHours: ZERO,
        } satisfies EntrySummary);
      summary.recordedDays += 1;
      if (entry.dayType === TimesheetDayType.WORKED) {
        summary.workedDays += 1;
        summary.totalHours = summary.totalHours.add(entry.hours);
        summary.totalOtHours = summary.totalOtHours.add(entry.overtimeHours);
      } else if (entry.dayType === TimesheetDayType.ABSENT) {
        summary.absentDays += 1;
      } else if (entry.dayType === TimesheetDayType.UNPAID_LEAVE) {
        summary.unpaidDays += 1;
      }
      summaries.set(entry.assignmentId, summary);
    }

    const revenueAccount = await this.prisma.$transaction((tx) =>
      this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.MANPOWER_REVENUE),
    );

    const lines: InvoiceLineDto[] = [];
    for (const [assignmentId, summary] of summaries) {
      const assignment = assignmentById.get(assignmentId);
      if (!assignment) continue;
      const billing = computeAssignmentBilling(
        assignment.rateBasis as RateBasisKind,
        assignment.billRate,
        assignment.otBillRate,
        summary,
        settings.daysPerMonth,
      );
      const who = `${assignment.employee.code} ${assignment.employee.nameEn}`;
      if (billing.regular) {
        lines.push({
          description: `${who} — ${billing.regular.quantity} ${billing.regular.unitLabel} @ ${billing.regular.unitPrice}`,
          quantity: billing.regular.quantity.toString(),
          unitPrice: billing.regular.unitPrice.toString(),
          accountId: revenueAccount.id,
          costCenterId: timesheet.contract.costCenterId,
        });
      }
      if (billing.overtime) {
        lines.push({
          description: `${who} — overtime ${billing.overtime.quantity} hours @ ${billing.overtime.unitPrice}`,
          quantity: billing.overtime.quantity.toString(),
          unitPrice: billing.overtime.unitPrice.toString(),
          accountId: revenueAccount.id,
          costCenterId: timesheet.contract.costCenterId,
        });
      }
    }
    if (lines.length === 0) {
      throw new BadRequestException("Nothing billable on this timesheet");
    }

    const now = new Date();
    const invoice = await this.arService.createDraft(companyId, userId, {
      businessPartnerId: timesheet.contract.businessPartnerId,
      issueDateTime: now.toISOString(),
      postingDate: now.toISOString(),
      dueDate: new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString(),
      memo: `Manpower ${timesheet.contract.code} — period ${timesheet.fiscalPeriod.periodNumber}`,
      lines,
    } as Parameters<ArService["createDraft"]>[2]);

    // Optimistic link: re-check the status so two concurrent generations
    // cannot both attach (the second update matches zero rows and throws).
    const linked = await this.prisma.timesheet.updateMany({
      where: { id: timesheetId, status: TimesheetStatus.APPROVED },
      data: { status: TimesheetStatus.INVOICED, salesInvoiceId: invoice.id },
    });
    if (linked.count === 0) {
      throw new ConflictException("Timesheet status changed while generating the invoice");
    }

    await this.auditService.log({
      companyId,
      entityName: "Timesheet",
      entityId: timesheetId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: TimesheetStatus.INVOICED, salesInvoiceId: invoice.id },
    });

    return invoice;
  }
}
