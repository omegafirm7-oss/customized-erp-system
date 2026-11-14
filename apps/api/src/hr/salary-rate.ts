import { Prisma } from "@prisma/client";

/** 26 working days x 10 hours — the construction-costing convention used for every timesheet cost. */
export const HOURLY_DIVISOR = new Prisma.Decimal(260);

/** Select this on an Employee query to price its timesheet days by date. */
export const SALARY_REVISIONS_SELECT = {
  select: { effectiveFrom: true, basicSalary: true },
  orderBy: { effectiveFrom: "asc" as const },
};

export interface SalaryRevisionLite {
  effectiveFrom: Date;
  basicSalary: Prisma.Decimal;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Basic salary in force on a given day: the latest revision whose
 * effectiveFrom is on or before it. With no revisions (or a day before the
 * earliest one) the employee's stored basicSalary applies, so employees
 * without dated changes price exactly as they always did.
 */
export function basicSalaryOn(
  current: Prisma.Decimal,
  revisions: SalaryRevisionLite[] | undefined,
  date: Date,
): Prisma.Decimal {
  if (!revisions || revisions.length === 0) return current;
  const key = dayKey(date);
  let found: Prisma.Decimal | null = null;
  let foundFrom = "";
  for (const r of revisions) {
    const from = dayKey(r.effectiveFrom);
    if (from <= key && from >= foundFrom) {
      found = r.basicSalary;
      foundFrom = from;
    }
  }
  return found ?? current;
}

export function hourlyRateOn(
  current: Prisma.Decimal,
  revisions: SalaryRevisionLite[] | undefined,
  date: Date,
): Prisma.Decimal {
  return basicSalaryOn(current, revisions, date).div(HOURLY_DIVISOR).toDecimalPlaces(4);
}

/**
 * Cost of a set of timesheet days, pricing each at the rate in force that
 * day. Hours are summed per distinct rate and rounded once per rate, so an
 * employee with a single rate gets exactly `rate x totalHours` rounded once
 * (the aggregate convention several reports already use).
 */
export function costForEntries(
  current: Prisma.Decimal,
  revisions: SalaryRevisionLite[] | undefined,
  entries: Array<{ date: Date; hoursWorked: Prisma.Decimal }>,
): Prisma.Decimal {
  const hoursByRate = new Map<string, { rate: Prisma.Decimal; hours: Prisma.Decimal }>();
  for (const e of entries) {
    const rate = hourlyRateOn(current, revisions, e.date);
    const k = rate.toFixed(4);
    const slot = hoursByRate.get(k);
    if (slot) slot.hours = slot.hours.add(e.hoursWorked);
    else hoursByRate.set(k, { rate, hours: e.hoursWorked });
  }
  let total = new Prisma.Decimal(0);
  for (const { rate, hours } of hoursByRate.values()) {
    total = total.add(rate.mul(hours).toDecimalPlaces(2));
  }
  return total;
}
