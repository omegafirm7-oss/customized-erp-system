import { VatCategory, ZatcaInvoiceKind } from "@prisma/client";

/** All data the UBL builder needs, decoupled from Prisma entities so the
 * builder is a pure function and compliance samples can be synthesized. */

export interface UblSeller {
  legalName: string;
  vatNumber: string;
  crNumber: string | null;
  streetName: string;
  buildingNumber: string;
  district: string;
  city: string;
  postalCode: string;
  countryCode: string;
}

export interface UblBuyer {
  name: string;
  vatNumber: string | null;
  additionalIdScheme: string | null;
  additionalIdNumber: string | null;
  streetName: string | null;
  buildingNumber: string | null;
  district: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
}

export interface UblLine {
  lineNumber: number;
  description: string;
  quantity: string;
  unitCode: string;
  unitPrice: string;
  discountAmount: string;
  netAmount: string;
  vatCategory: VatCategory;
  vatRate: string;
  vatAmount: string;
  grossAmount: string;
  vatExemptionReasonCode: string | null;
  vatExemptionReasonText: string | null;
}

export interface UblInvoiceInput {
  kind: ZatcaInvoiceKind;
  /** "388" invoice, "381" credit note, "383" debit note (compliance samples only) */
  invoiceTypeCode: string;
  invoiceNumber: string;
  uuid: string;
  issueDate: string; // YYYY-MM-DD
  issueTime: string; // HH:mm:ss
  icv: number;
  previousInvoiceHash: string;
  currencyCode: string;
  /** For credit/debit notes: the referenced original invoice number + reason */
  billingReferenceId: string | null;
  instructionNote: string | null;
  paymentMeansCode: string;
  deliveryDate: string | null; // YYYY-MM-DD
  seller: UblSeller;
  buyer: UblBuyer | null;
  lines: UblLine[];
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
  totalDiscount: string;
  /** VAT total expressed in SAR (functional currency) for the second TaxTotal */
  vatTotalSar: string;
}
