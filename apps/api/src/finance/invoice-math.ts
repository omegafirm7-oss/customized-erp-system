import { BadRequestException } from "@nestjs/common";
import { Prisma, VatCategory } from "@prisma/client";

/**
 * Pure invoice arithmetic — no I/O, unit-testable in isolation.
 *
 * VAT is rounded to 2 decimal places PER LINE (ZATCA rounding convention);
 * document totals are then sums of the already-rounded line values, so the
 * printed/reported totals always equal the sum of the printed lines.
 */

export const VAT_RATE_BY_CATEGORY: Record<VatCategory, Prisma.Decimal> = {
  STANDARD_15: new Prisma.Decimal("15"),
  ZERO_RATED: new Prisma.Decimal("0"),
  EXEMPT: new Prisma.Decimal("0"),
};

export type TaxMode = "EXCLUSIVE" | "INCLUSIVE";

export interface LineAmountsInput {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  vatCategory: VatCategory;
  /** Whether unitPrice*quantity-discount is net-of-tax (default) or the tax-inclusive gross amount. */
  taxMode?: TaxMode;
}

export interface LineAmounts {
  netAmount: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
}

export function computeLineAmounts(input: LineAmountsInput): LineAmounts {
  if (input.quantity.lte(0)) {
    throw new BadRequestException("Line quantity must be positive");
  }
  if (input.unitPrice.lt(0)) {
    throw new BadRequestException("Line unit price cannot be negative");
  }
  if (input.discountAmount.lt(0)) {
    throw new BadRequestException("Line discount cannot be negative");
  }

  const rawAmount = input.quantity.mul(input.unitPrice).sub(input.discountAmount).toDecimalPlaces(2);
  if (rawAmount.lt(0)) {
    throw new BadRequestException("Line discount exceeds the line amount");
  }

  const vatRate = VAT_RATE_BY_CATEGORY[input.vatCategory];

  if (input.taxMode === "INCLUSIVE") {
    // rawAmount is the tax-inclusive gross; back out the net so net + vat == the
    // gross the user typed exactly (vat computed as the difference, not net*rate,
    // to avoid a rounding mismatch against the entered total — ZATCA convention).
    const grossAmount = rawAmount;
    const netAmount = grossAmount.div(vatRate.div(100).add(1)).toDecimalPlaces(2);
    const vatAmount = grossAmount.sub(netAmount);
    return { netAmount, vatRate, vatAmount, grossAmount };
  }

  const netAmount = rawAmount;
  const vatAmount = netAmount.mul(vatRate).div(100).toDecimalPlaces(2);
  const grossAmount = netAmount.add(vatAmount);

  return { netAmount, vatRate, vatAmount, grossAmount };
}

export interface DocumentTotals {
  netTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  grossTotal: Prisma.Decimal;
}

export function sumDocumentTotals(lines: LineAmounts[]): DocumentTotals {
  const zero = new Prisma.Decimal(0);
  return {
    netTotal: lines.reduce((sum, l) => sum.add(l.netAmount), zero),
    vatTotal: lines.reduce((sum, l) => sum.add(l.vatAmount), zero),
    grossTotal: lines.reduce((sum, l) => sum.add(l.grossAmount), zero),
  };
}
