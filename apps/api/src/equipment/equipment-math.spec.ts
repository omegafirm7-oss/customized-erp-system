import { Prisma } from "@prisma/client";
import {
  computeUsageBilling,
  depreciationForPeriod,
  monthlyDepreciation,
  netBookValue,
  UsageSummary,
} from "./equipment-math";

const D = (v: string | number) => new Prisma.Decimal(v);
const THIRTY = D(30);

function summary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return { recordedDays: 31, breakdownDays: 0, totalHours: D(0), ...overrides };
}

describe("depreciation", () => {
  it("worked example: crane 240,000 − 24,000 salvage over 72 months = 3,000/month", () => {
    expect(monthlyDepreciation(D(240000), D(24000), 72).toString()).toBe("3000");
  });

  it("worked example: generator 36,000 over 36 months = 1,000/month", () => {
    expect(monthlyDepreciation(D(36000), D(0), 36).toString()).toBe("1000");
  });

  it("clamps the final month to the remaining depreciable base", () => {
    // Base 10,000 over 3 months → 3,333.33/month; after two months
    // accumulated 6,666.66 → final month takes 3,333.34
    const monthly = monthlyDepreciation(D(10000), D(0), 3);
    expect(monthly.toString()).toBe("3333.33");
    const final = depreciationForPeriod(D(10000), D(0), 3, D("6666.66"));
    expect(final.toString()).toBe("3333.33");
    const overflow = depreciationForPeriod(D(10000), D(0), 3, D("9999.99"));
    expect(overflow.toString()).toBe("0.01");
  });

  it("returns zero once fully depreciated", () => {
    expect(depreciationForPeriod(D(240000), D(24000), 72, D(216000)).toString()).toBe("0");
  });

  it("computes NBV", () => {
    expect(netBookValue(D(240000), D(9000)).toString()).toBe("231000");
  });
});

describe("computeUsageBilling", () => {
  it("MONTHLY caps at one month: 15,000/30 × min(31, 30) = 15,000", () => {
    const r = computeUsageBilling("MONTHLY", D(15000), summary(), THIRTY)!;
    expect(r.quantity.toString()).toBe("30");
    expect(r.amount.toString()).toBe("15000");
  });

  it("MONTHLY deducts breakdown days: 15,000/30 × (28 − 3) = 12,500", () => {
    const r = computeUsageBilling("MONTHLY", D(15000), summary({ recordedDays: 28, breakdownDays: 3 }), THIRTY)!;
    expect(r.quantity.toString()).toBe("25");
    expect(r.amount.toString()).toBe("12500");
  });

  it("DAILY bills non-breakdown days: (31 − 3) × 400 = 11,200", () => {
    const r = computeUsageBilling("DAILY", D(400), summary({ breakdownDays: 3 }), THIRTY)!;
    expect(r.quantity.toString()).toBe("28");
    expect(r.amount.toString()).toBe("11200");
  });

  it("HOURLY bills metered hours: 87.5 × 60 = 5,250", () => {
    const r = computeUsageBilling("HOURLY", D(60), summary({ totalHours: D("87.5") }), THIRTY)!;
    expect(r.amount.toString()).toBe("5250");
    expect(r.unitLabel).toBe("hours");
  });

  it("returns null when nothing is billable", () => {
    expect(computeUsageBilling("HOURLY", D(60), summary({ totalHours: D(0) }), THIRTY)).toBeNull();
    expect(
      computeUsageBilling("DAILY", D(400), summary({ recordedDays: 3, breakdownDays: 3 }), THIRTY),
    ).toBeNull();
  });
});
