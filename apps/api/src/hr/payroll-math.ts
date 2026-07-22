import { Prisma } from "@prisma/client";

/**
 * Pure Saudi payroll math: GOSI contributions, overtime, absence proration,
 * end-of-service benefits (Labor Law Art. 84/85) and annual-leave accrual.
 * All statutory parameters arrive via GosiRules / EosbBasis inputs — rates
 * are configurable per company (HrSettings), never hardcoded here.
 */

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const TWELVE = new Prisma.Decimal(12);

export type EosbBasisKind = "BASIC_ONLY" | "BASIC_HOUSING" | "FULL_GROSS";
export type SettlementReasonKind = "RESIGNATION" | "TERMINATION_BY_EMPLOYER" | "CONTRACT_END";

export interface SalaryStructure {
  basicSalary: Prisma.Decimal;
  housingAllowance: Prisma.Decimal;
  transportAllowance: Prisma.Decimal;
  otherAllowance: Prisma.Decimal;
}

export interface GosiRules {
  saudiEmployeeRatePct: Prisma.Decimal;
  saudiEmployerRatePct: Prisma.Decimal;
  expatEmployerRatePct: Prisma.Decimal;
  gosiWageFloor: Prisma.Decimal;
  gosiWageCap: Prisma.Decimal;
}

export interface GosiResult {
  /** basic + housing, clamped to [floor, cap]; ZERO when exempt. */
  gosiBase: Prisma.Decimal;
  employeeShare: Prisma.Decimal;
  employerShare: Prisma.Decimal;
}

export function fullGross(s: SalaryStructure): Prisma.Decimal {
  return s.basicSalary.add(s.housingAllowance).add(s.transportAllowance).add(s.otherAllowance);
}

export function wageForBasis(s: SalaryStructure, basis: EosbBasisKind): Prisma.Decimal {
  switch (basis) {
    case "BASIC_ONLY":
      return s.basicSalary;
    case "BASIC_HOUSING":
      return s.basicSalary.add(s.housingAllowance);
    case "FULL_GROSS":
      return fullGross(s);
  }
}

export function computeGosi(
  s: SalaryStructure,
  rules: GosiRules,
  opts: { isSaudi: boolean; gosiExempt: boolean },
): GosiResult {
  if (opts.gosiExempt) {
    return { gosiBase: ZERO, employeeShare: ZERO, employerShare: ZERO };
  }
  const rawBase = s.basicSalary.add(s.housingAllowance);
  const base = Prisma.Decimal.min(Prisma.Decimal.max(rawBase, rules.gosiWageFloor), rules.gosiWageCap);
  if (opts.isSaudi) {
    return {
      gosiBase: base,
      employeeShare: base.mul(rules.saudiEmployeeRatePct).div(HUNDRED).toDecimalPlaces(2),
      employerShare: base.mul(rules.saudiEmployerRatePct).div(HUNDRED).toDecimalPlaces(2),
    };
  }
  return {
    gosiBase: base,
    employeeShare: ZERO,
    employerShare: base.mul(rules.expatEmployerRatePct).div(HUNDRED).toDecimalPlaces(2),
  };
}

/** Overtime pays on the BASIC hourly rate (basic / daysPerMonth / hoursPerDay). */
export function computeOvertimePay(
  basicSalary: Prisma.Decimal,
  hours: Prisma.Decimal,
  opts: { daysPerMonth: Prisma.Decimal; hoursPerDay: Prisma.Decimal; overtimeMultiplier: Prisma.Decimal },
): Prisma.Decimal {
  if (hours.lte(0)) return ZERO;
  return basicSalary
    .div(opts.daysPerMonth)
    .div(opts.hoursPerDay)
    .mul(opts.overtimeMultiplier)
    .mul(hours)
    .toDecimalPlaces(2);
}

/** Unpaid/absent days deduct at the FULL-GROSS daily rate. */
export function computeAbsenceDeduction(
  s: SalaryStructure,
  days: Prisma.Decimal,
  daysPerMonth: Prisma.Decimal,
): Prisma.Decimal {
  if (days.lte(0)) return ZERO;
  return fullGross(s).div(daysPerMonth).mul(days).toDecimalPlaces(2);
}

/**
 * Service length in years with month precision (days pro-rated within the
 * month). Both dates are treated as UTC calendar dates.
 */
export function serviceYears(joinDate: Date, asOf: Date): Prisma.Decimal {
  if (asOf <= joinDate) return ZERO;
  const months =
    (asOf.getUTCFullYear() - joinDate.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - joinDate.getUTCMonth());
  const dayFraction = new Prisma.Decimal(asOf.getUTCDate() - joinDate.getUTCDate()).div(30);
  const totalMonths = new Prisma.Decimal(months).add(dayFraction);
  const years = totalMonths.div(TWELVE);
  // Full precision — only money rounds; callers snapshot at their own scale.
  return Prisma.Decimal.max(ZERO, years);
}

/**
 * EOSB entitlement per Saudi Labor Law Art. 84: half a month's wage per year
 * for the first five years, a full month's wage per year beyond, pro-rated
 * for partial years.
 */
export function computeEosbEntitlement(wage: Prisma.Decimal, years: Prisma.Decimal): Prisma.Decimal {
  if (years.lte(0) || wage.lte(0)) return ZERO;
  const FIVE = new Prisma.Decimal(5);
  const firstTierYears = Prisma.Decimal.min(years, FIVE);
  const secondTierYears = Prisma.Decimal.max(ZERO, years.sub(FIVE));
  return wage.mul(new Prisma.Decimal("0.5")).mul(firstTierYears).add(wage.mul(secondTierYears)).toDecimalPlaces(2);
}

/**
 * Art. 85 resignation factor applied to the Art. 84 entitlement:
 * under 2 years — nothing; 2–5 — one third; 5–10 — two thirds; 10+ — full.
 * Employer-initiated termination and limited-contract expiry pay in full.
 */
export function eosbReasonFactor(reason: SettlementReasonKind, years: Prisma.Decimal): Prisma.Decimal {
  if (reason !== "RESIGNATION") return new Prisma.Decimal(1);
  if (years.lt(2)) return ZERO;
  if (years.lt(5)) return new Prisma.Decimal(1).div(3);
  if (years.lt(10)) return new Prisma.Decimal(2).div(3);
  return new Prisma.Decimal(1);
}

export function computeEosbPayable(
  wage: Prisma.Decimal,
  years: Prisma.Decimal,
  reason: SettlementReasonKind,
): Prisma.Decimal {
  return computeEosbEntitlement(wage, years).mul(eosbReasonFactor(reason, years)).toDecimalPlaces(2);
}

/** Annual-leave days accrued between joinDate and asOf (annualLeaveDays/12 per service month). */
export function computeLeaveAccruedDays(
  joinDate: Date,
  asOf: Date,
  annualLeaveDays: Prisma.Decimal,
): Prisma.Decimal {
  return serviceYears(joinDate, asOf).mul(annualLeaveDays).toDecimalPlaces(2);
}

/** Monetary leave provision for a balance of days, at the full-gross daily rate. */
export function computeLeaveProvision(
  s: SalaryStructure,
  balanceDays: Prisma.Decimal,
  daysPerMonth: Prisma.Decimal,
): Prisma.Decimal {
  if (balanceDays.lte(0)) return ZERO;
  return fullGross(s).div(daysPerMonth).mul(balanceDays).toDecimalPlaces(2);
}

export interface PayrollLineInput {
  salary: SalaryStructure;
  isSaudi: boolean;
  gosiExempt: boolean;
  unpaidDays: Prisma.Decimal;
  absentDays: Prisma.Decimal;
  overtimeHours: Prisma.Decimal;
  otherDeduction: Prisma.Decimal;
  /** min(installment, remaining balance) across the employee's active loans. */
  loanDeduction: Prisma.Decimal;
}

export interface PayrollSettingsInput {
  gosi: GosiRules;
  daysPerMonth: Prisma.Decimal;
  hoursPerDay: Prisma.Decimal;
  overtimeMultiplier: Prisma.Decimal;
}

export interface PayrollLineResult {
  gosiBase: Prisma.Decimal;
  gosiEmployee: Prisma.Decimal;
  gosiEmployer: Prisma.Decimal;
  overtimePay: Prisma.Decimal;
  absenceDeduction: Prisma.Decimal;
  /** Contractual gross adjusted for absences and overtime (the 5200 debit). */
  grossPay: Prisma.Decimal;
  netPay: Prisma.Decimal;
}

export function computePayrollLine(input: PayrollLineInput, settings: PayrollSettingsInput): PayrollLineResult {
  const gosi = computeGosi(input.salary, settings.gosi, {
    isSaudi: input.isSaudi,
    gosiExempt: input.gosiExempt,
  });
  const overtimePay = computeOvertimePay(input.salary.basicSalary, input.overtimeHours, {
    daysPerMonth: settings.daysPerMonth,
    hoursPerDay: settings.hoursPerDay,
    overtimeMultiplier: settings.overtimeMultiplier,
  });
  const absenceDeduction = computeAbsenceDeduction(
    input.salary,
    input.unpaidDays.add(input.absentDays),
    settings.daysPerMonth,
  );
  const grossPay = fullGross(input.salary).sub(absenceDeduction).add(overtimePay);
  if (grossPay.lt(0)) {
    throw new Error("Absence deductions exceed gross salary");
  }
  const netPay = grossPay.sub(gosi.employeeShare).sub(input.loanDeduction).sub(input.otherDeduction);
  if (netPay.lt(0)) {
    throw new Error("Deductions exceed gross pay — reduce loan/other deductions");
  }
  return {
    gosiBase: gosi.gosiBase,
    gosiEmployee: gosi.employeeShare,
    gosiEmployer: gosi.employerShare,
    overtimePay,
    absenceDeduction,
    grossPay,
    netPay,
  };
}
