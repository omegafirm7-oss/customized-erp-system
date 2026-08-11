import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ControlAccountType, HiredEquipmentDayType, Prisma, TimesheetStatus } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ApService } from "../finance/ap.service";
import { AccountResolutionService } from "../finance/account-resolution.service";
import { InvoiceLineDto } from "../finance/dto/invoice-line.dto";
import { computeAssignmentBilling, EntrySummary, RateBasisKind } from "../manpower/manpower-math";

const ZERO = new Prisma.Decimal(0);
// Equipment rentals have no company-wide "standard month length" the way
// payroll does — 30 only matters for the rare MONTHLY-basis assignment, and
// only changes the per-day unit price shown on the invoice line, not what's
// actually billed (that's still billRate × billable days).
const DAYS_PER_MONTH = new Prisma.Decimal(30);

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly apService: ApService,
    private readonly accountResolution: AccountResolutionService,
  ) {}

  /**
   * Turns an APPROVED timesheet into an AP draft invoice: one line per
   * assignment (plus an OT line where billable) on the Machinery & Equipment
   * Rental account, every line stamped with the contract's project so it
   * flows straight into that project's Project Intelligence Machinery cost
   * — no separate "pending accrual" needed, unlike Labor, since a DRAFT
   * purchase invoice already counts there. The invoice then posts/pays
   * through the normal AP flow.
   */
  async generateInvoice(companyId: string, timesheetId: string, userId: string) {
    const timesheet = await this.prisma.hiredEquipmentTimesheet.findFirst({
      where: { id: timesheetId, companyId },
      include: {
        contract: true,
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

    const assignments = await this.prisma.hiredEquipmentAssignment.findMany({
      where: { contractId: timesheet.contractId },
    });
    const assignmentById = new Map(assignments.map((a) => [a.id, a]));

    // Summarize entries per assignment. Only WORKED days are billable.
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
      if (entry.dayType === HiredEquipmentDayType.WORKED) {
        summary.workedDays += 1;
        summary.totalHours = summary.totalHours.add(entry.hours);
        summary.totalOtHours = summary.totalOtHours.add(entry.overtimeHours);
      }
      summaries.set(entry.assignmentId, summary);
    }

    const expenseAccount = await this.prisma.$transaction((tx) =>
      this.accountResolution.getControlAccount(tx, companyId, ControlAccountType.HIRED_EQUIPMENT_EXPENSE),
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
        DAYS_PER_MONTH,
      );
      if (billing.regular) {
        lines.push({
          description: `${assignment.equipmentName} — ${billing.regular.quantity} ${billing.regular.unitLabel} @ ${billing.regular.unitPrice}`,
          quantity: billing.regular.quantity.toString(),
          unitPrice: billing.regular.unitPrice.toString(),
          accountId: expenseAccount.id,
          projectId: timesheet.contract.projectId,
        });
      }
      if (billing.overtime) {
        lines.push({
          description: `${assignment.equipmentName} — overtime ${billing.overtime.quantity} hours @ ${billing.overtime.unitPrice}`,
          quantity: billing.overtime.quantity.toString(),
          unitPrice: billing.overtime.unitPrice.toString(),
          accountId: expenseAccount.id,
          projectId: timesheet.contract.projectId,
        });
      }
    }
    if (lines.length === 0) {
      throw new BadRequestException("Nothing billable on this timesheet");
    }

    const now = new Date();
    const invoice = await this.apService.createDraft(companyId, userId, {
      businessPartnerId: timesheet.contract.businessPartnerId,
      vendorInvoiceNumber: `HEQ-${timesheet.contract.code}-P${timesheet.fiscalPeriod.periodNumber}`,
      postingDate: now.toISOString(),
      dueDate: new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString(),
      memo: `Hired equipment ${timesheet.contract.code} — period ${timesheet.fiscalPeriod.periodNumber}`,
      lines,
    } as Parameters<ApService["createDraft"]>[2]);

    // Optimistic link: re-check the status so two concurrent generations
    // cannot both attach (the second update matches zero rows and throws).
    const linked = await this.prisma.hiredEquipmentTimesheet.updateMany({
      where: { id: timesheetId, status: TimesheetStatus.APPROVED },
      data: { status: TimesheetStatus.INVOICED, purchaseInvoiceId: invoice.id },
    });
    if (linked.count === 0) {
      throw new ConflictException("Timesheet status changed while generating the invoice");
    }

    await this.auditService.log({
      companyId,
      entityName: "HiredEquipmentTimesheet",
      entityId: timesheetId,
      action: "UPDATE",
      changedByUserId: userId,
      afterSnapshot: { status: TimesheetStatus.INVOICED, purchaseInvoiceId: invoice.id },
    });

    return invoice;
  }
}
