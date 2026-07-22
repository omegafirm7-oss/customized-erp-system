import { Prisma } from "@prisma/client";
import {
  computeAbsenceDeduction,
  computeEosbEntitlement,
  computeEosbPayable,
  computeGosi,
  computeLeaveAccruedDays,
  computeLeaveProvision,
  computeOvertimePay,
  computePayrollLine,
  eosbReasonFactor,
  serviceYears,
  wageForBasis,
  GosiRules,
  SalaryStructure,
} from "./payroll-math";

const D = (v: string | number) => new Prisma.Decimal(v);

const rules: GosiRules = {
  saudiEmployeeRatePct: D("9.75"),
  saudiEmployerRatePct: D("11.75"),
  expatEmployerRatePct: D("2"),
  gosiWageFloor: D("1500"),
  gosiWageCap: D("45000"),
};

const settings = {
  gosi: rules,
  daysPerMonth: D(30),
  hoursPerDay: D(8),
  overtimeMultiplier: D("1.5"),
};

// Worked example employee A (Saudi): 10,000 basic + 2,500 housing + 1,000 transport
const salaryA: SalaryStructure = {
  basicSalary: D(10000),
  housingAllowance: D(2500),
  transportAllowance: D(1000),
  otherAllowance: D(0),
};

describe("computeGosi", () => {
  it("Saudi employee: base = basic + housing, both shares", () => {
    const r = computeGosi(salaryA, rules, { isSaudi: true, gosiExempt: false });
    expect(r.gosiBase.toString()).toBe("12500");
    expect(r.employeeShare.toString()).toBe("1218.75");
    expect(r.employerShare.toString()).toBe("1468.75");
  });

  it("expat: employer-only at the expat rate", () => {
    const salaryB: SalaryStructure = {
      basicSalary: D(8000),
      housingAllowance: D(2000),
      transportAllowance: D(0),
      otherAllowance: D(0),
    };
    const r = computeGosi(salaryB, rules, { isSaudi: false, gosiExempt: false });
    expect(r.gosiBase.toString()).toBe("10000");
    expect(r.employeeShare.toString()).toBe("0");
    expect(r.employerShare.toString()).toBe("200");
  });

  it("caps the wage base at gosiWageCap", () => {
    const rich: SalaryStructure = {
      basicSalary: D(50000),
      housingAllowance: D(0),
      transportAllowance: D(0),
      otherAllowance: D(0),
    };
    const r = computeGosi(rich, rules, { isSaudi: true, gosiExempt: false });
    expect(r.gosiBase.toString()).toBe("45000");
    expect(r.employeeShare.toString()).toBe("4387.5");
    expect(r.employerShare.toString()).toBe("5287.5");
  });

  it("floors the wage base at gosiWageFloor", () => {
    const low: SalaryStructure = {
      basicSalary: D(1000),
      housingAllowance: D(0),
      transportAllowance: D(0),
      otherAllowance: D(0),
    };
    const r = computeGosi(low, rules, { isSaudi: true, gosiExempt: false });
    expect(r.gosiBase.toString()).toBe("1500");
    expect(r.employeeShare.toString()).toBe("146.25");
  });

  it("returns all zeros when exempt", () => {
    const r = computeGosi(salaryA, rules, { isSaudi: true, gosiExempt: true });
    expect(r.gosiBase.toString()).toBe("0");
    expect(r.employeeShare.toString()).toBe("0");
    expect(r.employerShare.toString()).toBe("0");
  });
});

describe("overtime and absence", () => {
  it("overtime pays on the basic hourly rate times the multiplier", () => {
    // 10,000 / 30 / 8 × 1.5 × 10h = 625
    const r = computeOvertimePay(D(10000), D(10), {
      daysPerMonth: D(30),
      hoursPerDay: D(8),
      overtimeMultiplier: D("1.5"),
    });
    expect(r.toString()).toBe("625");
  });

  it("absence deducts at the full-gross daily rate", () => {
    // 13,500 / 30 × 2 = 900
    expect(computeAbsenceDeduction(salaryA, D(2), D(30)).toString()).toBe("900");
  });
});

describe("computePayrollLine (worked example A)", () => {
  it("nets 11,006.25 with 2 unpaid days, 10 OT hours and a 1,000 loan installment", () => {
    const r = computePayrollLine(
      {
        salary: salaryA,
        isSaudi: true,
        gosiExempt: false,
        unpaidDays: D(2),
        absentDays: D(0),
        overtimeHours: D(10),
        otherDeduction: D(0),
        loanDeduction: D(1000),
      },
      settings,
    );
    expect(r.absenceDeduction.toString()).toBe("900");
    expect(r.overtimePay.toString()).toBe("625");
    expect(r.grossPay.toString()).toBe("13225");
    expect(r.gosiEmployee.toString()).toBe("1218.75");
    expect(r.netPay.toString()).toBe("11006.25");
  });

  it("rejects deductions exceeding gross pay", () => {
    expect(() =>
      computePayrollLine(
        {
          salary: salaryA,
          isSaudi: true,
          gosiExempt: false,
          unpaidDays: D(0),
          absentDays: D(0),
          overtimeHours: D(0),
          otherDeduction: D(0),
          loanDeduction: D(13000),
        },
        settings,
      ),
    ).toThrow(/exceed gross pay/);
  });
});

describe("serviceYears", () => {
  it("one exact month is 1/12 of a year", () => {
    const y = serviceYears(new Date(Date.UTC(2026, 5, 1)), new Date(Date.UTC(2026, 6, 1)));
    expect(y.mul(12).toDecimalPlaces(6).toString()).toBe("1");
  });

  it("is zero when asOf precedes joinDate", () => {
    expect(serviceYears(new Date(Date.UTC(2026, 5, 1)), new Date(Date.UTC(2026, 4, 1))).toString()).toBe("0");
  });
});

describe("EOSB (Art. 84 tiers, Art. 85 factors)", () => {
  it("first month accrues half-month wage pro-rated: 562.50 on 13,500", () => {
    const oneMonth = serviceYears(new Date(Date.UTC(2026, 5, 1)), new Date(Date.UTC(2026, 6, 1)));
    expect(computeEosbEntitlement(D(13500), oneMonth).toString()).toBe("562.5");
  });

  it("7 years on 10,000 = 5×0.5 + 2×1 months = 45,000", () => {
    expect(computeEosbEntitlement(D(10000), D(7)).toString()).toBe("45000");
  });

  it("resignation factors: <2y none, 2–5y third, 5–10y two-thirds, 10y+ full", () => {
    expect(eosbReasonFactor("RESIGNATION", D("1.5")).toString()).toBe("0");
    expect(computeEosbPayable(D(10000), D(3), "RESIGNATION").toString()).toBe("5000");
    expect(computeEosbPayable(D(10000), D(7), "RESIGNATION").toString()).toBe("30000");
    expect(eosbReasonFactor("RESIGNATION", D(10)).toString()).toBe("1");
  });

  it("employer termination pays in full regardless of service", () => {
    expect(computeEosbPayable(D(10000), D(3), "TERMINATION_BY_EMPLOYER").toString()).toBe("15000");
  });
});

describe("leave accrual and provision", () => {
  it("accrues 1.75 days after one month at 21 days/year", () => {
    const days = computeLeaveAccruedDays(new Date(Date.UTC(2026, 5, 1)), new Date(Date.UTC(2026, 6, 1)), D(21));
    expect(days.toString()).toBe("1.75");
  });

  it("provisions 787.50 for 1.75 days on 13,500 full gross", () => {
    expect(computeLeaveProvision(salaryA, D("1.75"), D(30)).toString()).toBe("787.5");
  });
});

describe("wageForBasis", () => {
  it("selects the configured wage basis", () => {
    expect(wageForBasis(salaryA, "BASIC_ONLY").toString()).toBe("10000");
    expect(wageForBasis(salaryA, "BASIC_HOUSING").toString()).toBe("12500");
    expect(wageForBasis(salaryA, "FULL_GROSS").toString()).toBe("13500");
  });
});
