import { Prisma } from "@prisma/client";

/**
 * Pure fixed-asset and rental-billing math.
 *
 * Depreciation is straight-line: monthly = (cost − salvage) / usefulLifeMonths.
 * Accumulated depreciation never exceeds the depreciable base (cost − salvage);
 * the final month takes whatever remainder is left.
 *
 * Usage billing: a billable day is anything except BREAKDOWN — an IDLE unit
 * kept on site still bills; breakdown days are the customer's downtime credit.
 */

const ZERO = new Prisma.Decimal(0);

export function monthlyDepreciation(
  acquisitionCost: Prisma.Decimal,
  salvageValue: Prisma.Decimal,
  usefulLifeMonths: number,
): Prisma.Decimal {
  if (usefulLifeMonths <= 0) {
    throw new Error("usefulLifeMonths must be positive");
  }
  return acquisitionCost.sub(salvageValue).div(usefulLifeMonths).toDecimalPlaces(2);
}

/** This period's charge, clamped so accumulated never exceeds cost − salvage. */
export function depreciationForPeriod(
  acquisitionCost: Prisma.Decimal,
  salvageValue: Prisma.Decimal,
  usefulLifeMonths: number,
  accumulatedSoFar: Prisma.Decimal,
): Prisma.Decimal {
  const base = acquisitionCost.sub(salvageValue);
  const remaining = base.sub(accumulatedSoFar);
  if (remaining.lte(0)) return ZERO;
  const monthly = monthlyDepreciation(acquisitionCost, salvageValue, usefulLifeMonths);
  return Prisma.Decimal.min(monthly, remaining);
}

export function netBookValue(acquisitionCost: Prisma.Decimal, accumulated: Prisma.Decimal): Prisma.Decimal {
  return acquisitionCost.sub(accumulated);
}

export interface UsageSummary {
  /** Total calendar days recorded on the log for this assignment. */
  recordedDays: number;
  breakdownDays: number;
  /** Metered hours on non-breakdown days (HOURLY basis). */
  totalHours: Prisma.Decimal;
}

export type RateBasisKind = "HOURLY" | "DAILY" | "MONTHLY";

export interface UsageBillingLine {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  amount: Prisma.Decimal;
  unitLabel: "hours" | "days";
}

export function computeUsageBilling(
  basis: RateBasisKind,
  billRate: Prisma.Decimal,
  summary: UsageSummary,
  daysPerMonth: Prisma.Decimal,
): UsageBillingLine | null {
  if (basis === "HOURLY") {
    if (summary.totalHours.lte(0)) return null;
    return {
      quantity: summary.totalHours,
      unitPrice: billRate,
      amount: summary.totalHours.mul(billRate).toDecimalPlaces(2),
      unitLabel: "hours",
    };
  }

  const billableDays = Math.max(0, summary.recordedDays - summary.breakdownDays);
  if (billableDays === 0) return null;

  if (basis === "DAILY") {
    const qty = new Prisma.Decimal(billableDays);
    return { quantity: qty, unitPrice: billRate, amount: qty.mul(billRate).toDecimalPlaces(2), unitLabel: "days" };
  }

  // MONTHLY: prorate by daysPerMonth, capped at one full month
  const cappedDays = Prisma.Decimal.min(new Prisma.Decimal(billableDays), daysPerMonth);
  const dailyRate = billRate.div(daysPerMonth);
  return {
    quantity: cappedDays,
    unitPrice: dailyRate.toDecimalPlaces(4),
    amount: dailyRate.mul(cappedDays).toDecimalPlaces(2),
    unitLabel: "days",
  };
}
