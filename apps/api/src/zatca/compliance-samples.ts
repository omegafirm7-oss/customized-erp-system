import { randomUUID } from "crypto";
import { VatCategory, ZatcaInvoiceKind } from "@prisma/client";
import { UblInvoiceInput, UblSeller } from "./ubl/ubl-types";

/**
 * Synthetic sample documents for ZATCA's onboarding compliance checks.
 * With CSR functionality map "1100" (standard + simplified), six documents
 * must pass /compliance/invoices before a production CSID is granted:
 * {standard, simplified} × {invoice 388, credit note 381, debit note 383}.
 * These are compliance-API artifacts only — never persisted as accounting
 * documents (the ERP does not issue debit notes).
 */

const SAMPLE_BUYER = {
  name: "Sample Buyer LLC",
  vatNumber: "311111111111113",
  additionalIdScheme: null,
  additionalIdNumber: null,
  streetName: "Prince Sultan Road",
  buildingNumber: "5678",
  district: "As Sulimaniyah",
  city: "Riyadh",
  postalCode: "12233",
  countryCode: "SA",
};

export interface ComplianceSampleSpec {
  label: string;
  kind: ZatcaInvoiceKind;
  invoiceTypeCode: "388" | "381" | "383";
}

export const COMPLIANCE_SAMPLE_SPECS: ComplianceSampleSpec[] = [
  { label: "standard-invoice", kind: ZatcaInvoiceKind.STANDARD, invoiceTypeCode: "388" },
  { label: "standard-credit-note", kind: ZatcaInvoiceKind.STANDARD, invoiceTypeCode: "381" },
  { label: "standard-debit-note", kind: ZatcaInvoiceKind.STANDARD, invoiceTypeCode: "383" },
  { label: "simplified-invoice", kind: ZatcaInvoiceKind.SIMPLIFIED, invoiceTypeCode: "388" },
  { label: "simplified-credit-note", kind: ZatcaInvoiceKind.SIMPLIFIED, invoiceTypeCode: "381" },
  { label: "simplified-debit-note", kind: ZatcaInvoiceKind.SIMPLIFIED, invoiceTypeCode: "383" },
];

export function buildComplianceSampleInput(
  spec: ComplianceSampleSpec,
  seller: UblSeller,
  icv: number,
  previousInvoiceHash: string,
): UblInvoiceInput {
  const now = new Date();
  const issueDate = now.toISOString().slice(0, 10);
  const issueTime = now.toISOString().slice(11, 19);
  const isNote = spec.invoiceTypeCode !== "388";

  return {
    kind: spec.kind,
    invoiceTypeCode: spec.invoiceTypeCode,
    invoiceNumber: `CMP-${spec.label}-${icv}`,
    uuid: randomUUID(),
    issueDate,
    issueTime,
    icv,
    previousInvoiceHash,
    currencyCode: "SAR",
    billingReferenceId: isNote ? `CMP-ref-${icv}` : null,
    instructionNote: isNote ? "Compliance check sample" : null,
    paymentMeansCode: spec.kind === ZatcaInvoiceKind.SIMPLIFIED ? "10" : "30",
    deliveryDate: issueDate,
    seller,
    buyer: spec.kind === ZatcaInvoiceKind.STANDARD ? SAMPLE_BUYER : { ...SAMPLE_BUYER, vatNumber: null, name: "Walk-in Customer" },
    lines: [
      {
        lineNumber: 1,
        description: "Compliance check item",
        quantity: "1",
        unitCode: "PCE",
        unitPrice: "100.00",
        discountAmount: "0",
        netAmount: "100.00",
        vatCategory: VatCategory.STANDARD_15,
        vatRate: "15.00",
        vatAmount: "15.00",
        grossAmount: "115.00",
        vatExemptionReasonCode: null,
        vatExemptionReasonText: null,
      },
    ],
    netTotal: "100.00",
    vatTotal: "15.00",
    grossTotal: "115.00",
    totalDiscount: "0",
    vatTotalSar: "15.00",
  };
}
