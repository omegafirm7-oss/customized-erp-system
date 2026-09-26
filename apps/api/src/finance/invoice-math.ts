import { BadRequestException } from "@nestjs/common";
import { Prisma, VatCategory } from "@prisma/client";

/**
 * Pure invoice arithmetic — no I/O, unit-testable in isolation.
 *
 * VAT is rounded to 2 decimal places PER LINE (ZATCA rounding convention;
 * FBR also validates per line); document totals are then sums of the
 * already-rounded line values, so the printed/reported totals always equal
 * the sum of the printed lines.
 */

/**
 * Fixed rate per category. PK_REDUCED and PK_SERVICES have no fixed rate —
 * the caller supplies `rate` (item reducedRate; for services, falling back
 * to the company services-tax rate).
 */
export const VAT_RATE_BY_CATEGORY: Record<VatCategory, Prisma.Decimal | null> = {
  STANDARD_15: new Prisma.Decimal("15"),
  ZERO_RATED: new Prisma.Decimal("0"),
  EXEMPT: new Prisma.Decimal("0"),
  PK_STANDARD: new Prisma.Decimal("18"),
  PK_REDUCED: null,
  PK_THIRD_SCHEDULE: new Prisma.Decimal("18"),
  PK_SERVICES: null,
};

/** Categories each country may use; ZERO_RATED/EXEMPT are shared. */
export const PK_ONLY_CATEGORIES: readonly VatCategory[] = [
  VatCategory.PK_STANDARD,
  VatCategory.PK_REDUCED,
  VatCategory.PK_THIRD_SCHEDULE,
  VatCategory.PK_SERVICES,
];
export const SA_ONLY_CATEGORIES: readonly VatCategory[] = [VatCategory.STANDARD_15];

export function isCategoryAllowedForCountry(category: VatCategory, countryCode: string): boolean {
  if (countryCode === "PK") return !SA_ONLY_CATEGORIES.includes(category);
  return !PK_ONLY_CATEGORIES.includes(category);
}

export function defaultCategoryForCountry(countryCode: string): VatCategory {
  return countryCode === "PK" ? VatCategory.PK_STANDARD : VatCategory.STANDARD_15;
}

export type TaxMode = "EXCLUSIVE" | "INCLUSIVE";

export interface LineAmountsInput {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  vatCategory: VatCategory;
  /** Whether unitPrice*quantity-discount is net-of-tax (default) or the tax-inclusive gross amount. */
  taxMode?: TaxMode;
  /** Required for PK_REDUCED / PK_SERVICES (percent). Ignored otherwise. */
  rate?: Prisma.Decimal | null;
  /** Required for PK_THIRD_SCHEDULE: printed retail price per unit. */
  retailPrice?: Prisma.Decimal | null;
  /** Pakistan further tax percent (unregistered buyers); 0/undefined = none. */
  furtherTaxRate?: Prisma.Decimal | null;
}

export interface LineAmounts {
  netAmount: Prisma.Decimal;
  vatRate: Prisma.Decimal;
  /** Total tax on the line — sales tax plus any further tax. */
  vatAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  furtherTaxRate: Prisma.Decimal;
  furtherTaxAmount: Prisma.Decimal;
  /** Third Schedule only: retailPrice * quantity. */
  retailValue: Prisma.Decimal | null;
}

const ZERO = new Prisma.Decimal(0);

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

  const vatRate = resolveRate(input);

  if (input.vatCategory === VatCategory.PK_THIRD_SCHEDULE) {
    return computeThirdSchedule(input, rawAmount, vatRate);
  }

  // Further tax applies only on top of standard-rate sales tax.
  const furtherTaxRate =
    input.vatCategory === VatCategory.PK_STANDARD && input.furtherTaxRate && input.furtherTaxRate.gt(0)
      ? input.furtherTaxRate
      : ZERO;

  if (input.taxMode === "INCLUSIVE") {
    // rawAmount is the tax-inclusive gross; back out the net so net + tax ==
    // the gross the user typed exactly (tax computed as the difference, not
    // net*rate, to avoid a rounding mismatch against the entered total —
    // ZATCA convention). Further tax, when present, is net*ftRate and the
    // sales tax absorbs the rounding residual.
    const grossAmount = rawAmount;
    const netAmount = grossAmount.div(vatRate.add(furtherTaxRate).div(100).add(1)).toDecimalPlaces(2);
    const furtherTaxAmount = netAmount.mul(furtherTaxRate).div(100).toDecimalPlaces(2);
    const vatAmount = grossAmount.sub(netAmount);
    return { netAmount, vatRate, vatAmount, grossAmount, furtherTaxRate, furtherTaxAmount, retailValue: null };
  }

  const netAmount = rawAmount;
  const salesTax = netAmount.mul(vatRate).div(100).toDecimalPlaces(2);
  const furtherTaxAmount = netAmount.mul(furtherTaxRate).div(100).toDecimalPlaces(2);
  const vatAmount = salesTax.add(furtherTaxAmount);
  const grossAmount = netAmount.add(vatAmount);

  return { netAmount, vatRate, vatAmount, grossAmount, furtherTaxRate, furtherTaxAmount, retailValue: null };
}

function resolveRate(input: LineAmountsInput): Prisma.Decimal {
  const fixed = VAT_RATE_BY_CATEGORY[input.vatCategory];
  if (fixed) return fixed;
  if (input.vatCategory === VatCategory.PK_SERVICES) {
    if (!input.rate || input.rate.lte(0) || input.rate.gt(30)) {
      throw new BadRequestException("Services lines need a services sales tax rate (set it in FBR Settings)");
    }
    return input.rate;
  }
  // PK_REDUCED: rate comes from the item (8th Schedule / SRO).
  if (!input.rate || input.rate.lt(0) || input.rate.gte(18)) {
    throw new BadRequestException("Reduced-rate lines need the item's reduced rate (0 < rate < 18%)");
  }
  return input.rate;
}

/**
 * Third Schedule goods (Sales Tax Act s.3(2)(a)): tax is charged on the
 * PRINTED RETAIL PRICE, not the sale price — tax = retailPrice × qty × rate.
 * The net (value of sales excl. ST) is still the actual sale consideration.
 * FBR DI rejects mismatches with error 0111 ("Calculated tax not matched in
 * 3rd schedule"); confirm the formula against the live sandbox (SN008).
 */
function computeThirdSchedule(input: LineAmountsInput, rawAmount: Prisma.Decimal, vatRate: Prisma.Decimal): LineAmounts {
  if (!input.retailPrice || input.retailPrice.lte(0)) {
    throw new BadRequestException("Third Schedule lines need the item's printed retail price");
  }
  const retailValue = input.retailPrice.mul(input.quantity).toDecimalPlaces(2);
  const vatAmount = retailValue.mul(vatRate).div(100).toDecimalPlaces(2);
  const netAmount = input.taxMode === "INCLUSIVE" ? rawAmount.sub(vatAmount) : rawAmount;
  if (netAmount.lt(0)) {
    throw new BadRequestException("Third Schedule line amount is less than the tax on its retail price");
  }
  return {
    netAmount,
    vatRate,
    vatAmount,
    grossAmount: netAmount.add(vatAmount),
    furtherTaxRate: ZERO,
    furtherTaxAmount: ZERO,
    retailValue,
  };
}

export interface DocumentTotals {
  netTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  grossTotal: Prisma.Decimal;
  furtherTaxTotal: Prisma.Decimal;
}

export function sumDocumentTotals(lines: Array<Pick<LineAmounts, "netAmount" | "vatAmount" | "grossAmount"> & { furtherTaxAmount?: Prisma.Decimal }>): DocumentTotals {
  const zero = new Prisma.Decimal(0);
  return {
    netTotal: lines.reduce((sum, l) => sum.add(l.netAmount), zero),
    vatTotal: lines.reduce((sum, l) => sum.add(l.vatAmount), zero),
    grossTotal: lines.reduce((sum, l) => sum.add(l.grossAmount), zero),
    furtherTaxTotal: lines.reduce((sum, l) => sum.add(l.furtherTaxAmount ?? zero), zero),
  };
}
