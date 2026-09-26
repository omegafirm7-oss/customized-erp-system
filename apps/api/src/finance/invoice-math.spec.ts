import { Prisma, VatCategory } from "@prisma/client";
import { computeLineAmounts, defaultCategoryForCountry, isCategoryAllowedForCountry, sumDocumentTotals } from "./invoice-math";

const d = (value: string | number) => new Prisma.Decimal(value);

describe("invoice-math", () => {
  it("computes standard 15% VAT with per-line 2dp rounding", () => {
    const line = computeLineAmounts({
      quantity: d(3),
      unitPrice: d("33.33"),
      discountAmount: d(0),
      vatCategory: VatCategory.STANDARD_15,
    });
    expect(line.netAmount.toString()).toBe("99.99");
    expect(line.vatRate.toString()).toBe("15");
    // 99.99 * 0.15 = 14.9985 → 15.00 (rounded per line)
    expect(line.vatAmount.toString()).toBe("15");
    expect(line.grossAmount.toString()).toBe("114.99");
  });

  it("computes zero VAT for zero-rated and exempt categories", () => {
    for (const category of [VatCategory.ZERO_RATED, VatCategory.EXEMPT]) {
      const line = computeLineAmounts({
        quantity: d(2),
        unitPrice: d("50"),
        discountAmount: d(0),
        vatCategory: category,
      });
      expect(line.netAmount.toString()).toBe("100");
      expect(line.vatAmount.toString()).toBe("0");
      expect(line.grossAmount.toString()).toBe("100");
    }
  });

  it("applies discounts before VAT", () => {
    const line = computeLineAmounts({
      quantity: d(1),
      unitPrice: d("200"),
      discountAmount: d("100"),
      vatCategory: VatCategory.STANDARD_15,
    });
    expect(line.netAmount.toString()).toBe("100");
    expect(line.vatAmount.toString()).toBe("15");
    expect(line.grossAmount.toString()).toBe("115");
  });

  it("rejects negative and zero quantities, negative prices, over-discounts", () => {
    const base = { quantity: d(1), unitPrice: d(10), discountAmount: d(0), vatCategory: VatCategory.STANDARD_15 };
    expect(() => computeLineAmounts({ ...base, quantity: d(0) })).toThrow();
    expect(() => computeLineAmounts({ ...base, quantity: d(-1) })).toThrow();
    expect(() => computeLineAmounts({ ...base, unitPrice: d(-5) })).toThrow();
    expect(() => computeLineAmounts({ ...base, discountAmount: d(-1) })).toThrow();
    expect(() => computeLineAmounts({ ...base, discountAmount: d(11) })).toThrow();
  });

  it("computes tax-inclusive VAT, preserving the entered gross exactly", () => {
    const line = computeLineAmounts({
      quantity: d(1),
      unitPrice: d("115"),
      discountAmount: d(0),
      vatCategory: VatCategory.STANDARD_15,
      taxMode: "INCLUSIVE",
    });
    // 115 / 1.15 = 100 exactly
    expect(line.netAmount.toString()).toBe("100");
    expect(line.vatAmount.toString()).toBe("15");
    expect(line.grossAmount.toString()).toBe("115");
  });

  it("tax-inclusive mode keeps net+vat equal to the typed gross even with rounding", () => {
    const line = computeLineAmounts({
      quantity: d(1),
      unitPrice: d("100"),
      discountAmount: d(0),
      vatCategory: VatCategory.STANDARD_15,
      taxMode: "INCLUSIVE",
    });
    // 100 / 1.15 = 86.9565... -> 86.96 net, vat = 100 - 86.96 = 13.04 (difference, not net*rate)
    expect(line.netAmount.toString()).toBe("86.96");
    expect(line.vatAmount.toString()).toBe("13.04");
    expect(line.netAmount.add(line.vatAmount).toString()).toBe("100");
    expect(line.grossAmount.toString()).toBe("100");
  });

  it("tax-inclusive mode is a no-op for zero-rated/exempt (net == gross)", () => {
    const line = computeLineAmounts({
      quantity: d(1),
      unitPrice: d("50"),
      discountAmount: d(0),
      vatCategory: VatCategory.ZERO_RATED,
      taxMode: "INCLUSIVE",
    });
    expect(line.netAmount.toString()).toBe("50");
    expect(line.vatAmount.toString()).toBe("0");
    expect(line.grossAmount.toString()).toBe("50");
  });

  it("document totals equal the sum of rounded lines", () => {
    const lines = [
      computeLineAmounts({ quantity: d(3), unitPrice: d("33.33"), discountAmount: d(0), vatCategory: VatCategory.STANDARD_15 }),
      computeLineAmounts({ quantity: d(7), unitPrice: d("14.29"), discountAmount: d(0), vatCategory: VatCategory.STANDARD_15 }),
      computeLineAmounts({ quantity: d(1), unitPrice: d("50"), discountAmount: d(0), vatCategory: VatCategory.ZERO_RATED }),
    ];
    const totals = sumDocumentTotals(lines);
    expect(totals.netTotal.toString()).toBe(
      lines
        .reduce((s, l) => s.add(l.netAmount), d(0))
        .toString(),
    );
    expect(totals.grossTotal.toString()).toBe(totals.netTotal.add(totals.vatTotal).toString());
  });

  describe("Pakistan (FBR)", () => {
    it("PK_STANDARD charges 18% sales tax — matches the DI spec sample (1000 → 180)", () => {
      const line = computeLineAmounts({ quantity: d(1), unitPrice: d(1000), discountAmount: d(0), vatCategory: VatCategory.PK_STANDARD });
      expect(line.vatRate.toString()).toBe("18");
      expect(line.vatAmount.toString()).toBe("180");
      expect(line.furtherTaxAmount.toString()).toBe("0");
      expect(line.grossAmount.toString()).toBe("1180");
    });

    it("adds further tax on top of standard sales tax (1000 → 180 ST + 40 FT at 4%)", () => {
      const line = computeLineAmounts({
        quantity: d(1), unitPrice: d(1000), discountAmount: d(0), vatCategory: VatCategory.PK_STANDARD, furtherTaxRate: d(4),
      });
      expect(line.furtherTaxRate.toString()).toBe("4");
      expect(line.furtherTaxAmount.toString()).toBe("40");
      // vatAmount is total tax: sales tax + further tax
      expect(line.vatAmount.toString()).toBe("220");
      expect(line.grossAmount.toString()).toBe("1220");
    });

    it("never applies further tax to reduced, exempt, zero-rated or third schedule lines", () => {
      const reduced = computeLineAmounts({
        quantity: d(1), unitPrice: d(1000), discountAmount: d(0), vatCategory: VatCategory.PK_REDUCED, rate: d(5), furtherTaxRate: d(4),
      });
      expect(reduced.vatAmount.toString()).toBe("50");
      expect(reduced.furtherTaxAmount.toString()).toBe("0");
      for (const category of [VatCategory.EXEMPT, VatCategory.ZERO_RATED]) {
        const line = computeLineAmounts({ quantity: d(1), unitPrice: d(1000), discountAmount: d(0), vatCategory: category, furtherTaxRate: d(4) });
        expect(line.vatAmount.toString()).toBe("0");
      }
    });

    it("PK_REDUCED requires a rate between 0 and 18", () => {
      const base = { quantity: d(1), unitPrice: d(100), discountAmount: d(0), vatCategory: VatCategory.PK_REDUCED };
      expect(() => computeLineAmounts(base)).toThrow();
      expect(() => computeLineAmounts({ ...base, rate: d(18) })).toThrow();
      expect(computeLineAmounts({ ...base, rate: d("12.5") }).vatAmount.toString()).toBe("12.5");
    });

    it("PK_THIRD_SCHEDULE taxes the printed retail price, not the sale price", () => {
      // Sold to the retailer at 80/unit, printed retail price 100/unit, 10 units:
      // tax = 100 * 10 * 18% = 180; net stays the actual consideration 800.
      const line = computeLineAmounts({
        quantity: d(10), unitPrice: d(80), discountAmount: d(0), vatCategory: VatCategory.PK_THIRD_SCHEDULE, retailPrice: d(100), furtherTaxRate: d(4),
      });
      expect(line.retailValue!.toString()).toBe("1000");
      expect(line.netAmount.toString()).toBe("800");
      expect(line.vatAmount.toString()).toBe("180");
      expect(line.furtherTaxAmount.toString()).toBe("0");
      expect(line.grossAmount.toString()).toBe("980");
      expect(() =>
        computeLineAmounts({ quantity: d(1), unitPrice: d(80), discountAmount: d(0), vatCategory: VatCategory.PK_THIRD_SCHEDULE }),
      ).toThrow();
    });

    it("inclusive mode with further tax preserves the typed gross exactly", () => {
      const line = computeLineAmounts({
        quantity: d(1), unitPrice: d(1000), discountAmount: d(0), vatCategory: VatCategory.PK_STANDARD, furtherTaxRate: d(4), taxMode: "INCLUSIVE",
      });
      // 1000 / 1.22 = 819.67; FT = 32.79; total tax = 180.33
      expect(line.netAmount.toString()).toBe("819.67");
      expect(line.furtherTaxAmount.toString()).toBe("32.79");
      expect(line.netAmount.add(line.vatAmount).toString()).toBe("1000");
    });

    it("rejects categories from the other country", () => {
      expect(isCategoryAllowedForCountry(VatCategory.PK_STANDARD, "SA")).toBe(false);
      expect(isCategoryAllowedForCountry(VatCategory.STANDARD_15, "PK")).toBe(false);
      expect(isCategoryAllowedForCountry(VatCategory.EXEMPT, "PK")).toBe(true);
      expect(isCategoryAllowedForCountry(VatCategory.EXEMPT, "SA")).toBe(true);
      expect(defaultCategoryForCountry("PK")).toBe(VatCategory.PK_STANDARD);
      expect(defaultCategoryForCountry("SA")).toBe(VatCategory.STANDARD_15);
    });

    it("document totals carry the further-tax breakdown", () => {
      const lines = [
        computeLineAmounts({ quantity: d(1), unitPrice: d(1000), discountAmount: d(0), vatCategory: VatCategory.PK_STANDARD, furtherTaxRate: d(4) }),
        computeLineAmounts({ quantity: d(1), unitPrice: d(500), discountAmount: d(0), vatCategory: VatCategory.EXEMPT }),
      ];
      const totals = sumDocumentTotals(lines);
      expect(totals.furtherTaxTotal.toString()).toBe("40");
      expect(totals.vatTotal.toString()).toBe("220");
      expect(totals.grossTotal.toString()).toBe("1720");
    });
  });
});
