import { Prisma, VatCategory } from "@prisma/client";
import { computeLineAmounts, sumDocumentTotals } from "./invoice-math";

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
});
