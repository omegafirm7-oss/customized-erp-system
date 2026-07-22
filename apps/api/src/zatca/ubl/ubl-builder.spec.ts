import { VatCategory, ZatcaInvoiceKind } from "@prisma/client";
import { buildUblInvoiceXml } from "./ubl-builder";
import { UblInvoiceInput } from "./ubl-types";
import { computeInvoiceHash } from "../crypto/invoice-hash";

function baseInput(overrides: Partial<UblInvoiceInput> = {}): UblInvoiceInput {
  return {
    kind: ZatcaInvoiceKind.STANDARD,
    invoiceTypeCode: "388",
    invoiceNumber: "INV-000001",
    uuid: "8e6dded5-2109-4b2b-9bcd-4cba1f1e0a10",
    issueDate: "2026-07-14",
    issueTime: "10:30:00",
    icv: 1,
    previousInvoiceHash: "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
    currencyCode: "SAR",
    billingReferenceId: null,
    instructionNote: null,
    paymentMeansCode: "30",
    deliveryDate: "2026-07-14",
    seller: {
      legalName: "Demo Company Ltd",
      vatNumber: "310000000000003",
      crNumber: "1010101010",
      streetName: "King Fahd Road",
      buildingNumber: "1234",
      district: "Al Olaya",
      city: "Riyadh",
      postalCode: "12211",
      countryCode: "SA",
    },
    buyer: {
      name: "Acme Trading LLC",
      vatNumber: "311111111111113",
      additionalIdScheme: null,
      additionalIdNumber: null,
      streetName: "Prince Sultan Road",
      buildingNumber: "5678",
      district: "As Sulimaniyah",
      city: "Riyadh",
      postalCode: "12233",
      countryCode: "SA",
    },
    lines: [
      {
        lineNumber: 1,
        description: "Consulting services",
        quantity: "2",
        unitCode: "PCE",
        unitPrice: "500.00",
        discountAmount: "0",
        netAmount: "1000.00",
        vatCategory: VatCategory.STANDARD_15,
        vatRate: "15.00",
        vatAmount: "150.00",
        grossAmount: "1150.00",
        vatExemptionReasonCode: null,
        vatExemptionReasonText: null,
      },
    ],
    netTotal: "1000.00",
    vatTotal: "150.00",
    grossTotal: "1150.00",
    totalDiscount: "0",
    vatTotalSar: "150.00",
    ...overrides,
  };
}

describe("ubl-builder", () => {
  it("builds a standard invoice with full buyer party and KSA-2 code 0100000", () => {
    const xml = buildUblInvoiceXml(baseInput());
    expect(xml).toContain(`<cbc:InvoiceTypeCode name="0100000">388</cbc:InvoiceTypeCode>`);
    expect(xml).toContain("<cbc:ProfileID>reporting:1.0</cbc:ProfileID>");
    expect(xml).toContain("<cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>");
    expect(xml).toContain("<cbc:CompanyID>310000000000003</cbc:CompanyID>");
    expect(xml).toContain("<cbc:CompanyID>311111111111113</cbc:CompanyID>"); // buyer TRN
    expect(xml).toContain("<cbc:RegistrationName>Acme Trading LLC</cbc:RegistrationName>");
    expect(xml).toContain("<cbc:BuildingNumber>1234</cbc:BuildingNumber>");
    expect(xml).toContain("<cbc:CitySubdivisionName>Al Olaya</cbc:CitySubdivisionName>");
    expect(xml).toContain("<cbc:ActualDeliveryDate>2026-07-14</cbc:ActualDeliveryDate>");
    // ICV + PIH references
    expect(xml).toContain("<cbc:ID>ICV</cbc:ID><cbc:UUID>1</cbc:UUID>");
    expect(xml).toContain("<cbc:ID>PIH</cbc:ID>");
    // Dual TaxTotal: one with subtotal, one bare in SAR
    expect((xml.match(/<cac:TaxTotal>/g) ?? []).length).toBe(3); // doc-level x2 + line-level x1
  });

  it("builds a simplified invoice with KSA-2 code 0200000 and minimal buyer", () => {
    const xml = buildUblInvoiceXml(
      baseInput({
        kind: ZatcaInvoiceKind.SIMPLIFIED,
        buyer: { name: "Walk-in Customer", vatNumber: null, additionalIdScheme: null, additionalIdNumber: null, streetName: null, buildingNumber: null, district: null, city: null, postalCode: null, countryCode: null },
        paymentMeansCode: "10",
      }),
    );
    expect(xml).toContain(`<cbc:InvoiceTypeCode name="0200000">388</cbc:InvoiceTypeCode>`);
    expect(xml).toContain("<cbc:RegistrationName>Walk-in Customer</cbc:RegistrationName>");
    // No buyer postal address / TRN for simplified
    expect(xml).not.toContain("311111111111113");
  });

  it("builds a credit note with BillingReference and InstructionNote", () => {
    const xml = buildUblInvoiceXml(
      baseInput({
        invoiceTypeCode: "381",
        invoiceNumber: "CN-000001",
        billingReferenceId: "INV-000001",
        instructionNote: "Goods returned by customer",
      }),
    );
    expect(xml).toContain(`name="0100000">381<`);
    expect(xml).toContain("<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>INV-000001</cbc:ID>");
    expect(xml).toContain("<cbc:InstructionNote>Goods returned by customer</cbc:InstructionNote>");
  });

  it("emits VATEX exemption codes for zero-rated lines", () => {
    const xml = buildUblInvoiceXml(
      baseInput({
        lines: [
          {
            lineNumber: 1,
            description: "Exported goods",
            quantity: "1",
            unitCode: "PCE",
            unitPrice: "500.00",
            discountAmount: "0",
            netAmount: "500.00",
            vatCategory: VatCategory.ZERO_RATED,
            vatRate: "0.00",
            vatAmount: "0.00",
            grossAmount: "500.00",
            vatExemptionReasonCode: "VATEX-SA-32",
            vatExemptionReasonText: "Export of goods",
          },
        ],
        netTotal: "500.00",
        vatTotal: "0.00",
        grossTotal: "500.00",
        vatTotalSar: "0.00",
      }),
    );
    expect(xml).toContain("<cbc:TaxExemptionReasonCode>VATEX-SA-32</cbc:TaxExemptionReasonCode>");
    expect(xml).toContain("<cbc:TaxExemptionReason>Export of goods</cbc:TaxExemptionReason>");
    expect(xml).toContain("<cbc:ID>Z</cbc:ID>");
  });

  it("groups tax subtotals by category and includes line discounts", () => {
    const xml = buildUblInvoiceXml(
      baseInput({
        lines: [
          { ...baseInput().lines[0] },
          {
            lineNumber: 2,
            description: "More consulting",
            quantity: "1",
            unitCode: "PCE",
            unitPrice: "300.00",
            discountAmount: "50.00",
            netAmount: "250.00",
            vatCategory: VatCategory.STANDARD_15,
            vatRate: "15.00",
            vatAmount: "37.50",
            grossAmount: "287.50",
            vatExemptionReasonCode: null,
            vatExemptionReasonText: null,
          },
        ],
        netTotal: "1250.00",
        vatTotal: "187.50",
        grossTotal: "1437.50",
        totalDiscount: "50.00",
        vatTotalSar: "187.50",
      }),
    );
    // One grouped subtotal for the S/15 category covering both lines
    expect((xml.match(/<cac:TaxSubtotal>/g) ?? []).length).toBe(1);
    expect(xml).toContain(`<cbc:TaxableAmount currencyID="SAR">1250.00</cbc:TaxableAmount>`);
    expect(xml).toContain(`<cbc:AllowanceChargeReason>discount</cbc:AllowanceChargeReason>`);
    expect(xml).toContain(`<cbc:AllowanceTotalAmount currencyID="SAR">50.00</cbc:AllowanceTotalAmount>`);
  });

  it("produces XML that the invoice hasher can process (round-trip)", () => {
    const xml = buildUblInvoiceXml(baseInput());
    const hash = computeInvoiceHash(xml);
    expect(Buffer.from(hash, "base64")).toHaveLength(32);
    // Hash must be stable
    expect(computeInvoiceHash(xml)).toBe(hash);
  });

  it("escapes special characters in free-text fields", () => {
    const xml = buildUblInvoiceXml(
      baseInput({
        lines: [{ ...baseInput().lines[0], description: `Cables <2mm> & "connectors"` }],
      }),
    );
    expect(xml).toContain("Cables &lt;2mm&gt; &amp; ");
    // Must still be parseable/hashable
    expect(() => computeInvoiceHash(xml)).not.toThrow();
  });
});
