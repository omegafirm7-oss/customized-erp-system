import { Prisma } from "@prisma/client";
import { computeAssignmentBilling, EntrySummary } from "./manpower-math";

const D = (v: string | number) => new Prisma.Decimal(v);
const THIRTY = D(30);

function summary(overrides: Partial<EntrySummary> = {}): EntrySummary {
  return {
    recordedDays: 31,
    workedDays: 31,
    absentDays: 0,
    unpaidDays: 0,
    totalHours: D(0),
    totalOtHours: D(0),
    ...overrides,
  };
}

describe("computeAssignmentBilling", () => {
  it("HOURLY bills total hours at the bill rate", () => {
    const r = computeAssignmentBilling("HOURLY", D(50), D(0), summary({ totalHours: D("120.5") }), THIRTY);
    expect(r.regular!.quantity.toString()).toBe("120.5");
    expect(r.regular!.amount.toString()).toBe("6025");
    expect(r.regular!.unitLabel).toBe("hours");
    expect(r.overtime).toBeNull();
  });

  it("DAILY bills worked days only (worked example: 27 days × 200 = 5,400)", () => {
    const r = computeAssignmentBilling(
      "DAILY",
      D(200),
      D(20),
      summary({ recordedDays: 31, workedDays: 27, absentDays: 4, totalOtHours: D(10) }),
      THIRTY,
    );
    expect(r.regular!.quantity.toString()).toBe("27");
    expect(r.regular!.amount.toString()).toBe("5400");
    expect(r.regular!.unitLabel).toBe("days");
    // OT: 10 × 20 = 200
    expect(r.overtime!.amount.toString()).toBe("200");
  });

  it("MONTHLY prorates absences and unpaid leave (worked example: 6,000/30 × 29 = 5,800)", () => {
    const r = computeAssignmentBilling(
      "MONTHLY",
      D(6000),
      D(0),
      summary({ recordedDays: 31, workedDays: 29, unpaidDays: 2 }),
      THIRTY,
    );
    expect(r.regular!.quantity.toString()).toBe("29");
    expect(r.regular!.unitPrice.toString()).toBe("200");
    expect(r.regular!.amount.toString()).toBe("5800");
  });

  it("MONTHLY caps billable days at daysPerMonth (full 31-day month bills exactly one month)", () => {
    const r = computeAssignmentBilling("MONTHLY", D(6000), D(0), summary({ recordedDays: 31 }), THIRTY);
    expect(r.regular!.quantity.toString()).toBe("30");
    expect(r.regular!.amount.toString()).toBe("6000");
  });

  it("MONTHLY keeps REST and ANNUAL_LEAVE days billable (only absent/unpaid deduct)", () => {
    // 28 recorded, 20 worked (4 rest + 4 annual leave), 0 absent → bills 28 days
    const r = computeAssignmentBilling(
      "MONTHLY",
      D(6000),
      D(0),
      summary({ recordedDays: 28, workedDays: 20 }),
      THIRTY,
    );
    expect(r.regular!.quantity.toString()).toBe("28");
    expect(r.regular!.amount.toString()).toBe("5600");
  });

  it("zero OT bill rate produces no overtime line even when OT hours exist", () => {
    const r = computeAssignmentBilling("DAILY", D(200), D(0), summary({ totalOtHours: D(15) }), THIRTY);
    expect(r.overtime).toBeNull();
  });

  it("returns no regular line when nothing billable", () => {
    const hourly = computeAssignmentBilling("HOURLY", D(50), D(0), summary({ totalHours: D(0) }), THIRTY);
    expect(hourly.regular).toBeNull();
    const monthly = computeAssignmentBilling(
      "MONTHLY",
      D(6000),
      D(0),
      summary({ recordedDays: 2, absentDays: 1, unpaidDays: 1 }),
      THIRTY,
    );
    expect(monthly.regular).toBeNull();
  });

  it("OT bills at the negotiated rate independent of the regular basis", () => {
    const r = computeAssignmentBilling("HOURLY", D(50), D("75.5"), summary({ totalHours: D(10), totalOtHours: D(4) }), THIRTY);
    expect(r.overtime!.amount.toString()).toBe("302");
  });
});
