import { Prisma } from "@prisma/client";

/**
 * Pure manpower billing math. An assignment bills from its timesheet-entry
 * summary according to its rate basis:
 *  - HOURLY:  Σ hours × billRate
 *  - DAILY:   count(WORKED days) × billRate
 *  - MONTHLY: billRate / daysPerMonth × billableDays, where billableDays =
 *             min(recordedDays − absentDays − unpaidDays, daysPerMonth) —
 *             REST and ANNUAL_LEAVE days stay billable on monthly secondments.
 * Overtime always bills Σ otHours × otBillRate; an otBillRate of 0 means OT
 * is not billable and produces no line.
 */

export type RateBasisKind = "HOURLY" | "DAILY" | "MONTHLY";

export interface EntrySummary {
  /** Total calendar days recorded on the timesheet for this assignment. */
  recordedDays: number;
  workedDays: number;
  absentDays: number;
  unpaidDays: number;
  totalHours: Prisma.Decimal;
  totalOtHours: Prisma.Decimal;
}

export interface BillingLine {
  /** Billed quantity: hours (HOURLY) or days (DAILY/MONTHLY). */
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
  /** Human unit label used to compose the invoice-line description. */
  unitLabel: "hours" | "days";
}

export interface AssignmentBilling {
  regular: BillingLine | null;
  overtime: BillingLine | null;
}

export function computeAssignmentBilling(
  basis: RateBasisKind,
  billRate: Prisma.Decimal,
  otBillRate: Prisma.Decimal,
  summary: EntrySummary,
  daysPerMonth: Prisma.Decimal,
): AssignmentBilling {
  let regular: BillingLine | null = null;

  if (basis === "HOURLY") {
    if (summary.totalHours.gt(0)) {
      const amount = summary.totalHours.mul(billRate).toDecimalPlaces(2);
      regular = { quantity: summary.totalHours, unitPrice: billRate, amount, unitLabel: "hours" };
    }
  } else if (basis === "DAILY") {
    if (summary.workedDays > 0) {
      const qty = new Prisma.Decimal(summary.workedDays);
      regular = { quantity: qty, unitPrice: billRate, amount: qty.mul(billRate).toDecimalPlaces(2), unitLabel: "days" };
    }
  } else {
    const rawBillable = summary.recordedDays - summary.absentDays - summary.unpaidDays;
    const billableDays = Prisma.Decimal.min(new Prisma.Decimal(Math.max(0, rawBillable)), daysPerMonth);
    if (billableDays.gt(0)) {
      const dailyRate = billRate.div(daysPerMonth);
      regular = {
        quantity: billableDays,
        unitPrice: dailyRate.toDecimalPlaces(4),
        amount: dailyRate.mul(billableDays).toDecimalPlaces(2),
        unitLabel: "days",
      };
    }
  }

  let overtime: BillingLine | null = null;
  if (otBillRate.gt(0) && summary.totalOtHours.gt(0)) {
    overtime = {
      quantity: summary.totalOtHours,
      unitPrice: otBillRate,
      amount: summary.totalOtHours.mul(otBillRate).toDecimalPlaces(2),
      unitLabel: "hours",
    };
  }

  return { regular, overtime };
}
