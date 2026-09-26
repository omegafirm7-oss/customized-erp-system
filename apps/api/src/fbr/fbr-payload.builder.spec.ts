import { FbrRegistrationType, Prisma, VatCategory } from "@prisma/client";
import { buildDiPayload, buildPosPayload, findFbrDataProblems, FbrSource, formatPkDateTime, rateStringFor } from "./fbr-payload.builder";
import { resolveScenarioId } from "./fbr-constants";

const d = (v: string | number) => new Prisma.Decimal(v);

function source(overrides: Partial<FbrSource> = {}): FbrSource {
  return {
    isReturn: false,
    invoiceNumber: "INV-000001",
    postingDate: new Date("2025-04-21T00:00:00Z"),
    issueDateTime: new Date("2025-04-21T07:30:00Z"),
    exchangeRate: d(1),
    seller: { ntn: "1234567", legalName: "Company 8", province: "SINDH", address: "Karachi", businessActivity: "Manufacturer" },
    buyer: {
      ntnCnic: "7654321",
      name: "FERTILIZER MANUFAC IRS NEW",
      province: "SINDH",
      address: "Karachi",
      registrationType: FbrRegistrationType.REGISTERED,
    },
    lines: [
      {
        itemCode: "P-1",
        description: "product Description",
        hsCode: "0101.2100",
        fbrUom: null,
        fbrSaleType: null,
        sroScheduleNo: null,
        sroItemSerialNo: null,
        quantity: d(1),
        discountAmount: d(0),
        netAmount: d(1000),
        vatCategory: VatCategory.PK_STANDARD,
        vatRate: d(18),
        vatAmount: d(180),
        furtherTaxAmount: d(0),
        grossAmount: d(1180),
        retailValue: null,
      },
    ],
    ...overrides,
  };
}

describe("FBR DI payload", () => {
  it("matches the PRAL v1.12 sandbox sample field-for-field", () => {
    const payload = buildDiPayload(source(), { sandbox: true });
    expect(payload).toEqual({
      invoiceType: "Sale Invoice",
      invoiceDate: "2025-04-21",
      sellerNTNCNIC: "1234567",
      sellerBusinessName: "Company 8",
      sellerProvince: "SINDH",
      sellerAddress: "Karachi",
      buyerNTNCNIC: "7654321",
      buyerBusinessName: "FERTILIZER MANUFAC IRS NEW",
      buyerProvince: "SINDH",
      buyerAddress: "Karachi",
      buyerRegistrationType: "Registered",
      invoiceRefNo: "",
      scenarioId: "SN001",
      items: [
        {
          hsCode: "0101.2100",
          productDescription: "product Description",
          rate: "18%",
          uoM: "Numbers, pieces, units",
          quantity: 1,
          totalValues: 1180,
          valueSalesExcludingST: 1000,
          fixedNotifiedValueOrRetailPrice: 0,
          salesTaxApplicable: 180,
          salesTaxWithheldAtSource: 0,
          extraTax: 0,
          furtherTax: 0,
          sroScheduleNo: "",
          fedPayable: 0,
          discount: 0,
          saleType: "Goods at standard rate (default)",
          sroItemSerialNo: "",
        },
      ],
    });
  });

  it("omits scenarioId in production", () => {
    expect(buildDiPayload(source(), { sandbox: false }).scenarioId).toBeUndefined();
  });

  it("splits further tax out of sales tax for unregistered buyers (sample: 180 ST + 120 FT)", () => {
    const s = source({ buyer: { ...source().buyer, registrationType: FbrRegistrationType.UNREGISTERED } });
    s.lines[0] = { ...s.lines[0], vatAmount: d(300), furtherTaxAmount: d(120), grossAmount: d(1300) };
    const item = buildDiPayload(s, { sandbox: true });
    expect(item.buyerRegistrationType).toBe("Unregistered");
    expect(item.scenarioId).toBe("SN002");
    expect(item.items[0].salesTaxApplicable).toBe(180);
    expect(item.items[0].furtherTax).toBe(120);
  });

  it("converts foreign-currency invoices to PKR", () => {
    const item = buildDiPayload(source({ exchangeRate: d("278.5") }), { sandbox: false }).items[0];
    expect(item.valueSalesExcludingST).toBe(278500);
    expect(item.salesTaxApplicable).toBe(50130);
  });

  it("sends returns as a note referencing the original FBR invoice number", () => {
    const payload = buildDiPayload(source({ isReturn: true, originalFbrInvoiceNumber: "7000007DI1747119701593" }), { sandbox: false });
    expect(payload.invoiceType).toBe("Debit Note");
    expect(payload.invoiceRefNo).toBe("7000007DI1747119701593");
  });

  it("formats rates and third-schedule retail values", () => {
    expect(rateStringFor({ vatCategory: VatCategory.PK_REDUCED, vatRate: d("12.5") })).toBe("12.5%");
    expect(rateStringFor({ vatCategory: VatCategory.EXEMPT, vatRate: d(0) })).toBe("Exempt");
    const s = source();
    s.lines[0] = { ...s.lines[0], vatCategory: VatCategory.PK_THIRD_SCHEDULE, netAmount: d(800), retailValue: d(1000), vatAmount: d(180) };
    const item = buildDiPayload(s, { sandbox: true });
    expect(item.items[0].fixedNotifiedValueOrRetailPrice).toBe(1000);
    expect(item.items[0].saleType).toBe("3rd Schedule Goods");
    expect(item.scenarioId).toBe("SN008");
  });
});

describe("FBR data problems (pre-posting checks)", () => {
  it("passes a complete invoice", () => {
    expect(findFbrDataProblems(source(), "DI")).toEqual([]);
  });

  it("flags missing seller NTN, buyer province, registered buyer NTN and bad HS codes", () => {
    const s = source({
      seller: { ...source().seller, ntn: null },
      buyer: { ...source().buyer, ntnCnic: null, province: null },
    });
    s.lines[0] = { ...s.lines[0], hsCode: "01012100" };
    const problems = findFbrDataProblems(s, "DI");
    expect(problems.join("|")).toMatch(/Company NTN/);
    expect(problems.join("|")).toMatch(/no province/);
    expect(problems.join("|")).toMatch(/no NTN\/CNIC/);
    expect(problems.join("|")).toMatch(/HS code/);
  });

  it("POS channel only needs HS codes (walk-in buyers have no province/NTN)", () => {
    const s = source({ buyer: { ntnCnic: null, name: "Walk-in", province: null, address: null, registrationType: null } });
    expect(findFbrDataProblems(s, "POS")).toEqual([]);
  });

  it("requires the original FBR number before a DI return", () => {
    expect(findFbrDataProblems(source({ isReturn: true }), "DI").join()).toMatch(/original invoice has no FBR invoice number/);
  });
});

describe("FBR POS payload", () => {
  it("maps totals, PCTCode and buyer CNIC", () => {
    const s = source({ buyer: { ...source().buyer, ntnCnic: "3520212345671" } });
    const payload = buildPosPayload(s, { posId: 812345, paymentMode: 2 });
    expect(payload.POSID).toBe(812345);
    expect(payload.USIN).toBe("INV-000001");
    expect(payload.DateTime).toBe("2025-04-21 12:30:00");
    expect(payload.BuyerCNIC).toBe("3520212345671");
    expect(payload.BuyerNTN).toBeNull();
    expect(payload.TotalSaleValue).toBe(1000);
    expect(payload.TotalTaxCharged).toBe(180);
    expect(payload.TotalBillAmount).toBe(1180);
    expect(payload.InvoiceType).toBe(1);
    expect(payload.Items[0].PCTCode).toBe("01012100");
    expect(payload.Items[0].TaxRate).toBe(18);
  });

  it("returns carry InvoiceType 3 and the original USIN", () => {
    const payload = buildPosPayload(source({ isReturn: true, originalUsin: "INV-000001" }), { posId: 1, paymentMode: 1 });
    expect(payload.InvoiceType).toBe(3);
    expect(payload.RefUSIN).toBe("INV-000001");
    expect(payload.Items[0].RefUSIN).toBe("INV-000001");
  });

  it("formats IMS DateTime in Pakistan Standard Time", () => {
    expect(formatPkDateTime(new Date("2025-12-31T21:15:09Z"))).toBe("2026-01-01 02:15:09");
  });
});

describe("scenario resolver", () => {
  const base = { saleType: "", businessActivity: "Manufacturer" };
  it.each([
    [VatCategory.PK_STANDARD, FbrRegistrationType.REGISTERED, "SN001"],
    [VatCategory.PK_STANDARD, FbrRegistrationType.UNREGISTERED, "SN002"],
    [VatCategory.PK_REDUCED, FbrRegistrationType.REGISTERED, "SN005"],
    [VatCategory.EXEMPT, FbrRegistrationType.REGISTERED, "SN006"],
    [VatCategory.ZERO_RATED, FbrRegistrationType.REGISTERED, "SN007"],
    [VatCategory.PK_THIRD_SCHEDULE, FbrRegistrationType.REGISTERED, "SN008"],
  ])("%s to %s buyer → %s", (category, reg, expected) => {
    expect(resolveScenarioId({ ...base, category, buyerRegistrationType: reg })).toBe(expected);
  });

  it("retailers selling to end consumers use SN026-SN028; services use SN019", () => {
    const retail = { saleType: "", businessActivity: "Retailer", buyerRegistrationType: FbrRegistrationType.UNREGISTERED };
    expect(resolveScenarioId({ ...retail, category: VatCategory.PK_STANDARD })).toBe("SN026");
    expect(resolveScenarioId({ ...retail, category: VatCategory.PK_THIRD_SCHEDULE })).toBe("SN027");
    expect(resolveScenarioId({ ...retail, category: VatCategory.PK_REDUCED })).toBe("SN028");
    expect(resolveScenarioId({ ...base, saleType: "Services", category: VatCategory.PK_STANDARD, buyerRegistrationType: FbrRegistrationType.REGISTERED })).toBe("SN019");
  });
});
