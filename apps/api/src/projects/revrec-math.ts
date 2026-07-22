import { Prisma } from "@prisma/client";

/**
 * Pure percentage-of-completion (cost-to-cost, IFRS 15 over-time) math.
 *
 * Model: costs expense as incurred; progress billings credit the Contract
 * Liability account (2400); each run RETARGETS the cumulative balances of
 * Contract Asset (1450) and Contract Liability (2400) to their theoretical
 * positions and credits Contract Revenue (4300) with the recognition delta.
 *
 * Invariant maintained across runs: bal2400 − bal1450 = billed − recognized.
 * Balance proof: Δ1450dr + Δ2400dr − Δrevenue = 0 by construction.
 * At POC 100% and fully billed, both targets are zero — no special
 * close-out entry needed. Negative deltas (downward estimate revision)
 * flip line sides naturally.
 */

export interface RevRecInput {
  costsToDate: Prisma.Decimal;
  estimatedTotalCost: Prisma.Decimal;
  contractValue: Prisma.Decimal;
  /** Current 1450 balance for this project's cost center (debit-positive). */
  contractAssetBalance: Prisma.Decimal;
  /** Current 2400 balance for this project's cost center (credit-positive). */
  contractLiabilityBalance: Prisma.Decimal;
  /** Current 4300 balance for this project's cost center (credit-positive). */
  previouslyRecognized: Prisma.Decimal;
}

export interface RevRecResult {
  percentComplete: Prisma.Decimal;
  cumulativeRevenue: Prisma.Decimal;
  recognizedThisRun: Prisma.Decimal;
  /** Positive = debit 1450 by this amount; negative = credit. */
  contractAssetDelta: Prisma.Decimal;
  /** Positive = debit 2400 by this amount; negative = credit. */
  contractLiabilityDelta: Prisma.Decimal;
  /** Positive = credit 4300; negative = debit (de-recognition). */
  revenueDelta: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

export function computeRevRec(input: RevRecInput): RevRecResult {
  if (input.estimatedTotalCost.lte(0)) {
    throw new Error("estimatedTotalCost must be positive");
  }

  const rawPoc = input.costsToDate.div(input.estimatedTotalCost);
  const percentComplete = rawPoc.gt(ONE) ? ONE : rawPoc.lt(ZERO) ? ZERO : rawPoc.toDecimalPlaces(4);

  const cumulativeRevenue = percentComplete.mul(input.contractValue).toDecimalPlaces(4);
  const revenueDelta = cumulativeRevenue.sub(input.previouslyRecognized);

  // Billed-to-date implied by the invariant: B = R_prev + bal2400 − bal1450
  const billedToDate = input.previouslyRecognized
    .add(input.contractLiabilityBalance)
    .sub(input.contractAssetBalance);

  const targetAsset = Prisma.Decimal.max(ZERO, cumulativeRevenue.sub(billedToDate));
  const targetLiability = Prisma.Decimal.max(ZERO, billedToDate.sub(cumulativeRevenue));

  const contractAssetDelta = targetAsset.sub(input.contractAssetBalance);
  const contractLiabilityDelta = input.contractLiabilityBalance.sub(targetLiability);

  // Sanity: entry must balance — Dr(1450 Δ) + Dr(2400 Δ) = Cr(revenue Δ)
  const drSum = contractAssetDelta.add(contractLiabilityDelta);
  if (!drSum.sub(revenueDelta).abs().lt(new Prisma.Decimal("0.0001"))) {
    throw new Error(
      `RevRec entry does not balance: asset Δ ${contractAssetDelta} + liability Δ ${contractLiabilityDelta} != revenue Δ ${revenueDelta}`,
    );
  }

  return {
    percentComplete,
    cumulativeRevenue,
    recognizedThisRun: revenueDelta,
    contractAssetDelta,
    contractLiabilityDelta,
    revenueDelta,
  };
}
