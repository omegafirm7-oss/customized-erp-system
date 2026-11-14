import { Prisma } from "@prisma/client";
import { basicSalaryOn, costForEntries, hourlyRateOn } from "./salary-rate";

const D = (v: number | string) => new Prisma.Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("salary-rate", () => {
  const revisions = [
    { effectiveFrom: new Date("1970-01-01T00:00:00.000Z"), basicSalary: D(3000) },
    { effectiveFrom: day("2026-08-25"), basicSalary: D(4000) },
  ];

  it("uses the stored salary when there are no revisions", () => {
    expect(basicSalaryOn(D(3500), [], day("2026-08-30")).toString()).toBe("3500");
    expect(basicSalaryOn(D(3500), undefined, day("2026-08-30")).toString()).toBe("3500");
  });

  it("prices days before the change at the old salary and from the change date at the new one", () => {
    expect(basicSalaryOn(D(4000), revisions, day("2026-08-24")).toString()).toBe("3000");
    expect(basicSalaryOn(D(4000), revisions, day("2026-08-25")).toString()).toBe("4000");
    expect(basicSalaryOn(D(4000), revisions, day("2026-10-01")).toString()).toBe("4000");
  });

  it("derives the hourly rate as salary / 260 to 4 dp", () => {
    expect(hourlyRateOn(D(4000), revisions, day("2026-09-01")).toString()).toBe("15.3846");
    expect(hourlyRateOn(D(4000), revisions, day("2026-08-01")).toString()).toBe("11.5385");
  });

  it("costs entries per rate in force, and equals rate x hours rounded once when there is one rate", () => {
    const entries = [
      { date: day("2026-08-24"), hoursWorked: D(10) },
      { date: day("2026-08-25"), hoursWorked: D(10) },
      { date: day("2026-08-26"), hoursWorked: D(5) },
    ];
    // 10h x 11.5385 + 15h x 15.3846
    expect(costForEntries(D(4000), revisions, entries).toString()).toBe("346.16");
    expect(costForEntries(D(3000), [], entries).toString()).toBe(D(3000).div(260).toDecimalPlaces(4).mul(25).toDecimalPlaces(2).toString());
  });
});
