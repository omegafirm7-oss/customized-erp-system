import { create } from "xmlbuilder2";
import type { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import { VatCategory, ZatcaInvoiceKind } from "@prisma/client";
import { UblInvoiceInput } from "./ubl-types";

/**
 * ZATCA UBL 2.1 invoice XML builder (KSA profile). Emits the UNSIGNED
 * document; the XAdES signature block and QR document reference are spliced
 * in afterwards at fixed anchors (see xades.ts) so the invoice hash computed
 * over this output remains valid.
 *
 * Credit and debit notes are emitted as <Invoice> with InvoiceTypeCode
 * 381/383 per the ZATCA KSA profile — not as UBL <CreditNote> documents.
 */

const UN_ECE_5305_BY_CATEGORY: Record<VatCategory, string> = {
  STANDARD_15: "S",
  ZERO_RATED: "Z",
  EXEMPT: "E",
};

const TRANSACTION_CODE_BY_KIND: Record<ZatcaInvoiceKind, string> = {
  STANDARD: "0100000",
  SIMPLIFIED: "0200000",
};

function money(value: string): string {
  // ZATCA amounts: max 2 decimals
  return Number(value).toFixed(2);
}

function quantity(value: string): string {
  return Number(value).toString();
}

export function buildUblInvoiceXml(input: UblInvoiceInput): string {
  const doc = create({ version: "1.0", encoding: "UTF-8" }).ele("Invoice", {
    xmlns: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    "xmlns:cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "xmlns:cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    "xmlns:ext": "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  });

  doc.ele("cbc:ProfileID").txt("reporting:1.0");
  doc.ele("cbc:ID").txt(input.invoiceNumber);
  doc.ele("cbc:UUID").txt(input.uuid);
  doc.ele("cbc:IssueDate").txt(input.issueDate);
  doc.ele("cbc:IssueTime").txt(input.issueTime);
  doc
    .ele("cbc:InvoiceTypeCode", { name: TRANSACTION_CODE_BY_KIND[input.kind] })
    .txt(input.invoiceTypeCode);
  doc.ele("cbc:DocumentCurrencyCode").txt(input.currencyCode);
  doc.ele("cbc:TaxCurrencyCode").txt("SAR");

  if (input.billingReferenceId) {
    doc
      .ele("cac:BillingReference")
      .ele("cac:InvoiceDocumentReference")
      .ele("cbc:ID")
      .txt(input.billingReferenceId);
  }

  addDocumentReference(doc, "ICV", String(input.icv), null);
  addDocumentReference(doc, "PIH", null, input.previousInvoiceHash);

  // Seller (AccountingSupplierParty)
  const supplierParty = doc.ele("cac:AccountingSupplierParty").ele("cac:Party");
  if (input.seller.crNumber) {
    supplierParty.ele("cac:PartyIdentification").ele("cbc:ID", { schemeID: "CRN" }).txt(input.seller.crNumber);
  }
  const sellerAddress = supplierParty.ele("cac:PostalAddress");
  sellerAddress.ele("cbc:StreetName").txt(input.seller.streetName);
  sellerAddress.ele("cbc:BuildingNumber").txt(input.seller.buildingNumber);
  sellerAddress.ele("cbc:CitySubdivisionName").txt(input.seller.district);
  sellerAddress.ele("cbc:CityName").txt(input.seller.city);
  sellerAddress.ele("cbc:PostalZone").txt(input.seller.postalCode);
  sellerAddress.ele("cac:Country").ele("cbc:IdentificationCode").txt(input.seller.countryCode);
  const sellerTaxScheme = supplierParty.ele("cac:PartyTaxScheme");
  sellerTaxScheme.ele("cbc:CompanyID").txt(input.seller.vatNumber);
  sellerTaxScheme.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");
  supplierParty.ele("cac:PartyLegalEntity").ele("cbc:RegistrationName").txt(input.seller.legalName);

  // Buyer (AccountingCustomerParty) — full party detail for standard invoices;
  // simplified (B2C) invoices carry a minimal customer block.
  const customerParty = doc.ele("cac:AccountingCustomerParty").ele("cac:Party");
  if (input.kind === ZatcaInvoiceKind.STANDARD && input.buyer) {
    if (!input.buyer.vatNumber && input.buyer.additionalIdNumber) {
      customerParty
        .ele("cac:PartyIdentification")
        .ele("cbc:ID", { schemeID: input.buyer.additionalIdScheme ?? "OTH" })
        .txt(input.buyer.additionalIdNumber);
    }
    const buyerAddress = customerParty.ele("cac:PostalAddress");
    buyerAddress.ele("cbc:StreetName").txt(input.buyer.streetName ?? "");
    buyerAddress.ele("cbc:BuildingNumber").txt(input.buyer.buildingNumber ?? "");
    buyerAddress.ele("cbc:CitySubdivisionName").txt(input.buyer.district ?? "");
    buyerAddress.ele("cbc:CityName").txt(input.buyer.city ?? "");
    buyerAddress.ele("cbc:PostalZone").txt(input.buyer.postalCode ?? "");
    buyerAddress.ele("cac:Country").ele("cbc:IdentificationCode").txt(input.buyer.countryCode ?? "SA");
    if (input.buyer.vatNumber) {
      const buyerTaxScheme = customerParty.ele("cac:PartyTaxScheme");
      buyerTaxScheme.ele("cbc:CompanyID").txt(input.buyer.vatNumber);
      buyerTaxScheme.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");
    }
    customerParty.ele("cac:PartyLegalEntity").ele("cbc:RegistrationName").txt(input.buyer.name);
  } else if (input.buyer) {
    customerParty.ele("cac:PartyLegalEntity").ele("cbc:RegistrationName").txt(input.buyer.name);
  }

  if (input.deliveryDate) {
    doc.ele("cac:Delivery").ele("cbc:ActualDeliveryDate").txt(input.deliveryDate);
  }

  const paymentMeans = doc.ele("cac:PaymentMeans");
  paymentMeans.ele("cbc:PaymentMeansCode").txt(input.paymentMeansCode);
  if (input.instructionNote) {
    paymentMeans.ele("cbc:InstructionNote").txt(input.instructionNote);
  }

  // TaxTotal #1: with subtotals grouped by category
  const taxTotal = doc.ele("cac:TaxTotal");
  taxTotal.ele("cbc:TaxAmount", { currencyID: input.currencyCode }).txt(money(input.vatTotal));

  const byCategory = new Map<string, { taxable: number; vat: number; rate: string; category: VatCategory; exemptionCode: string | null; exemptionText: string | null }>();
  for (const line of input.lines) {
    const key = `${line.vatCategory}:${line.vatRate}`;
    const existing = byCategory.get(key);
    if (existing) {
      existing.taxable += Number(line.netAmount);
      existing.vat += Number(line.vatAmount);
    } else {
      byCategory.set(key, {
        taxable: Number(line.netAmount),
        vat: Number(line.vatAmount),
        rate: line.vatRate,
        category: line.vatCategory,
        exemptionCode: line.vatExemptionReasonCode,
        exemptionText: line.vatExemptionReasonText,
      });
    }
  }
  for (const group of byCategory.values()) {
    const subtotal = taxTotal.ele("cac:TaxSubtotal");
    subtotal.ele("cbc:TaxableAmount", { currencyID: input.currencyCode }).txt(group.taxable.toFixed(2));
    subtotal.ele("cbc:TaxAmount", { currencyID: input.currencyCode }).txt(group.vat.toFixed(2));
    const category = subtotal.ele("cac:TaxCategory");
    category.ele("cbc:ID").txt(UN_ECE_5305_BY_CATEGORY[group.category]);
    category.ele("cbc:Percent").txt(Number(group.rate).toFixed(2));
    if (group.category !== VatCategory.STANDARD_15) {
      if (group.exemptionCode) {
        category.ele("cbc:TaxExemptionReasonCode").txt(group.exemptionCode);
      }
      if (group.exemptionText) {
        category.ele("cbc:TaxExemptionReason").txt(group.exemptionText);
      }
    }
    category.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");
  }

  // TaxTotal #2: bare VAT amount in SAR (BR-KSA-EN16931-08)
  doc.ele("cac:TaxTotal").ele("cbc:TaxAmount", { currencyID: "SAR" }).txt(money(input.vatTotalSar));

  const monetaryTotal = doc.ele("cac:LegalMonetaryTotal");
  monetaryTotal.ele("cbc:LineExtensionAmount", { currencyID: input.currencyCode }).txt(money(input.netTotal));
  monetaryTotal.ele("cbc:TaxExclusiveAmount", { currencyID: input.currencyCode }).txt(money(input.netTotal));
  monetaryTotal.ele("cbc:TaxInclusiveAmount", { currencyID: input.currencyCode }).txt(money(input.grossTotal));
  monetaryTotal.ele("cbc:AllowanceTotalAmount", { currencyID: input.currencyCode }).txt(money(input.totalDiscount));
  monetaryTotal.ele("cbc:PrepaidAmount", { currencyID: input.currencyCode }).txt("0.00");
  monetaryTotal.ele("cbc:PayableAmount", { currencyID: input.currencyCode }).txt(money(input.grossTotal));

  for (const line of input.lines) {
    const invoiceLine = doc.ele("cac:InvoiceLine");
    invoiceLine.ele("cbc:ID").txt(String(line.lineNumber));
    invoiceLine.ele("cbc:InvoicedQuantity", { unitCode: line.unitCode }).txt(quantity(line.quantity));
    invoiceLine.ele("cbc:LineExtensionAmount", { currencyID: input.currencyCode }).txt(money(line.netAmount));

    const lineTaxTotal = invoiceLine.ele("cac:TaxTotal");
    lineTaxTotal.ele("cbc:TaxAmount", { currencyID: input.currencyCode }).txt(money(line.vatAmount));
    lineTaxTotal.ele("cbc:RoundingAmount", { currencyID: input.currencyCode }).txt(money(line.grossAmount));

    const item = invoiceLine.ele("cac:Item");
    item.ele("cbc:Name").txt(line.description);
    const classified = item.ele("cac:ClassifiedTaxCategory");
    classified.ele("cbc:ID").txt(UN_ECE_5305_BY_CATEGORY[line.vatCategory]);
    classified.ele("cbc:Percent").txt(Number(line.vatRate).toFixed(2));
    classified.ele("cac:TaxScheme").ele("cbc:ID").txt("VAT");

    const price = invoiceLine.ele("cac:Price");
    price.ele("cbc:PriceAmount", { currencyID: input.currencyCode }).txt(Number(line.unitPrice).toFixed(2));
    if (Number(line.discountAmount) > 0) {
      const allowance = price.ele("cac:AllowanceCharge");
      allowance.ele("cbc:ChargeIndicator").txt("false");
      allowance.ele("cbc:AllowanceChargeReason").txt("discount");
      allowance.ele("cbc:Amount", { currencyID: input.currencyCode }).txt(money(line.discountAmount));
    }
  }

  return doc.end({ prettyPrint: false });
}

function addDocumentReference(doc: XMLBuilder, id: "ICV" | "PIH" | "QR", uuidValue: string | null, embedded: string | null) {
  const ref = doc.ele("cac:AdditionalDocumentReference");
  ref.ele("cbc:ID").txt(id);
  if (uuidValue !== null) {
    ref.ele("cbc:UUID").txt(uuidValue);
  }
  if (embedded !== null) {
    ref
      .ele("cac:Attachment")
      .ele("cbc:EmbeddedDocumentBinaryObject", { mimeCode: "text/plain" })
      .txt(embedded);
  }
}
