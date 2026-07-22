import { Prisma } from "@prisma/client";
import { computeRevRec } from "./revrec-math";

const d = (v: string | number) => new Prisma.Decimal(v);

describe("revrec-math (POC cumulative retargeting)", () => {
  const base = { contractValue: d(150000), estimatedTotalCost: d(100000) };

  it("period 1, billing-first ordering: 40k costs, 50k billed → Dr 2400 50k / Dr 1450 10k / Cr 4300 60k", () => {
    const result = computeRevRec({
      ...base,
      costsToDate: d(40000),
      contractAssetBalance: d(0),
      contractLiabilityBalance: d(50000),
      previouslyRecognized: d(0),
    });
    expect(result.percentComplete.toNumber()).toBe(0.4);
    expect(result.cumulativeRevenue.toNumber()).toBe(60000);
    expect(result.revenueDelta.toNumber()).toBe(60000);
    expect(result.contractLiabilityDelta.toNumber()).toBe(50000); // Dr 2400
    expect(result.contractAssetDelta.toNumber()).toBe(10000); // Dr 1450
  });

  it("period 1, run-before-billing: 40k costs, nothing billed → Dr 1450 60k / Cr 4300 60k", () => {
    const result = computeRevRec({
      ...base,
      costsToDate: d(40000),
      contractAssetBalance: d(0),
      contractLiabilityBalance: d(0),
      previouslyRecognized: d(0),
    });
    expect(result.contractAssetDelta.toNumber()).toBe(60000);
    expect(result.contractLiabilityDelta.toNumber()).toBe(0);
    expect(result.revenueDelta.toNumber()).toBe(60000);
  });

  it("period 2 after run-first ordering: 70k costs, 50k billed → Dr 2400 50k / Cr 1450 5k / Cr 4300 45k", () => {
    // After P1 (run-first): 1450 = 60k, 2400 = 50k (billed later), 4300 = 60k
    const result = computeRevRec({
      ...base,
      costsToDate: d(70000),
      contractAssetBalance: d(60000),
      contractLiabilityBalance: d(50000),
      previouslyRecognized: d(60000),
    });
    expect(result.percentComplete.toNumber()).toBe(0.7);
    expect(result.cumulativeRevenue.toNumber()).toBe(105000);
    expect(result.revenueDelta.toNumber()).toBe(45000);
    // Target: B = 60+50-60 = 50k billed; R = 105k → asset 55k, liability 0
    expect(result.contractAssetDelta.toNumber()).toBe(-5000); // Cr 1450 5k
    expect(result.contractLiabilityDelta.toNumber()).toBe(50000); // Dr 2400 50k
  });

  it("period 2 per plan worked example (billing-first): costs 70k, billed 90k → Dr 2400 40k / Dr 1450 5k / Cr 4300 45k", () => {
    // After P1 billing-first: 1450 = 10k, 2400 = 40k (90k billed − 50k drawn), 4300 = 60k
    const result = computeRevRec({
      ...base,
      costsToDate: d(70000),
      contractAssetBalance: d(10000),
      contractLiabilityBalance: d(40000),
      previouslyRecognized: d(60000),
    });
    expect(result.revenueDelta.toNumber()).toBe(45000);
    expect(result.contractLiabilityDelta.toNumber()).toBe(40000);
    expect(result.contractAssetDelta.toNumber()).toBe(5000);
    // Final: 1450 = 15k (105k recognized − 90k billed), 2400 = 0
  });

  it("overbilled: 20k costs, 60k billed → liability position, no asset", () => {
    const result = computeRevRec({
      ...base,
      costsToDate: d(20000),
      contractAssetBalance: d(0),
      contractLiabilityBalance: d(60000),
      previouslyRecognized: d(0),
    });
    expect(result.cumulativeRevenue.toNumber()).toBe(30000);
    // Target liability = 60 − 30 = 30k → Dr 2400 by 30k
    expect(result.contractLiabilityDelta.toNumber()).toBe(30000);
    expect(result.contractAssetDelta.toNumber()).toBe(0);
  });

  it("downward estimate revision produces a negative revenue delta", () => {
    // Costs 40k but estimate ballooned to 200k → POC 20% → R 30k < 60k prior
    const result = computeRevRec({
      contractValue: d(150000),
      estimatedTotalCost: d(200000),
      costsToDate: d(40000),
      contractAssetBalance: d(60000),
      contractLiabilityBalance: d(0),
      previouslyRecognized: d(60000),
    });
    expect(result.revenueDelta.toNumber()).toBe(-30000);
    expect(result.contractAssetDelta.toNumber()).toBe(-30000); // Cr 1450
  });

  it("100% complete and fully billed sweeps both accounts to zero", () => {
    const result = computeRevRec({
      ...base,
      costsToDate: d(100000),
      contractAssetBalance: d(15000),
      contractLiabilityBalance: d(60000), // 150k billed total − 90k drawn
      previouslyRecognized: d(105000),
    });
    expect(result.percentComplete.toNumber()).toBe(1);
    expect(result.cumulativeRevenue.toNumber()).toBe(150000);
    expect(result.revenueDelta.toNumber()).toBe(45000);
    // Final targets both 0: Dr 2400 60k, Cr 1450 15k, Cr 4300 45k
    expect(result.contractLiabilityDelta.toNumber()).toBe(60000);
    expect(result.contractAssetDelta.toNumber()).toBe(-15000);
  });

  it("POC caps at 100% on cost overrun", () => {
    const result = computeRevRec({
      ...base,
      costsToDate: d(130000),
      contractAssetBalance: d(0),
      contractLiabilityBalance: d(0),
      previouslyRecognized: d(0),
    });
    expect(result.percentComplete.toNumber()).toBe(1);
    expect(result.cumulativeRevenue.toNumber()).toBe(150000);
  });

  it("rejects a non-positive estimate", () => {
    expect(() =>
      computeRevRec({
        ...base,
        estimatedTotalCost: d(0),
        costsToDate: d(10),
        contractAssetBalance: d(0),
        contractLiabilityBalance: d(0),
        previouslyRecognized: d(0),
      }),
    ).toThrow();
  });
});
