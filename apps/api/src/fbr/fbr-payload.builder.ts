import { FbrRegistrationType, Prisma, VatCategory } from "@prisma/client";
import {
  FBR_DEFAULT_UOM,
  FBR_SALE_TYPE_BY_CATEGORY,
  HS_CODE_REGEX,
  NTN_CNIC_REGEX,
  POS_INVOICE_TYPES,
  resolveScenarioId,
} from "./fbr-constants";
import { DiInvoiceItem, DiInvoicePayload, PosInvoiceItem, PosInvoicePayload } from "./fbr.types";

/**
 * Pure mapping from a posted ERP sales document to the FBR wire formats —
 * no I/O, unit-tested against the samples in the PRAL DI spec v1.12.
 * Amounts are converted to PKR with the invoice's posting exchange rate
 * (FBR only accepts rupee values).
 */

export interface FbrSourceLine {
  itemCode: string | null;
  description: string;
  hsCode: string | null;
  fbrUom: string | null;
  fbrSaleType: string | null;
  sroScheduleNo: string | null;
  sroItemSerialNo: string | null;
  quantity: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  vatCategory: VatCategory;
  vatRate: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  furtherTaxAmount: Prisma.Decimal;
  grossAmount: Prisma.Decimal;
  retailValue: Prisma.Decimal | null;
}

export interface FbrSource {
  isReturn: boolean;
  invoiceNumber: string;
  postingDate: Date;
  issueDateTime: Date;
  exchangeRate: Prisma.Decimal;
  seller: {
    ntn: string | null;
    legalName: string;
    province: string | null;
    address: string | null;
    businessActivity: string | null;
  };
  buyer: {
    ntnCnic: string | null;
    name: string;
    province: string | null;
    address: string | null;
    registrationType: FbrRegistrationType | null;
    phone?: string | null;
  };
  /** For returns: the original invoice's FBR invoice number (DI) / USIN (POS). */
  originalFbrInvoiceNumber?: string | null;
  originalUsin?: string | null;
  lines: FbrSourceLine[];
}

const toNumber = (value: Prisma.Decimal, rate: Prisma.Decimal, dp = 2) => value.mul(rate).toDecimalPlaces(dp).toNumber();

function effectiveRegistrationType(source: FbrSource): FbrRegistrationType {
  return source.buyer.registrationType === FbrRegistrationType.REGISTERED
    ? FbrRegistrationType.REGISTERED
    : FbrRegistrationType.UNREGISTERED;
}

export function saleTypeFor(line: Pick<FbrSourceLine, "fbrSaleType" | "vatCategory">): string {
  return line.fbrSaleType || FBR_SALE_TYPE_BY_CATEGORY[line.vatCategory] || FBR_SALE_TYPE_BY_CATEGORY.PK_STANDARD!;
}

/** DI `rate` string: "18%", "5%", "12.5%", "Exempt". */
export function rateStringFor(line: Pick<FbrSourceLine, "vatCategory" | "vatRate">): string {
  if (line.vatCategory === VatCategory.EXEMPT) return "Exempt";
  return `${line.vatRate.toDecimalPlaces(2).toNumber()}%`;
}

/**
 * Master-data problems that would make FBR reject the document. Checked
 * BEFORE posting so users fix data up front instead of accumulating
 * unreportable posted invoices.
 */
export function findFbrDataProblems(source: FbrSource, channel: "DI" | "POS"): string[] {
  const problems: string[] = [];
  if (channel === "DI") {
    if (!source.seller.ntn || !NTN_CNIC_REGEX.test(source.seller.ntn)) problems.push("Company NTN is missing or invalid (Settings → Company)");
    if (!source.seller.province) problems.push("Company province is missing (Settings → Company)");
    if (!source.buyer.province) problems.push(`Customer ${source.buyer.name} has no province`);
    if (effectiveRegistrationType(source) === FbrRegistrationType.REGISTERED && !source.buyer.ntnCnic) {
      problems.push(`Registered customer ${source.buyer.name} has no NTN/CNIC`);
    }
    if (source.isReturn && !source.originalFbrInvoiceNumber) {
      problems.push("The original invoice has no FBR invoice number yet — report it to FBR before issuing a return");
    }
  }
  if (source.buyer.ntnCnic && !NTN_CNIC_REGEX.test(source.buyer.ntnCnic)) {
    problems.push(`Customer ${source.buyer.name} NTN/CNIC must be 7 or 13 digits`);
  }
  source.lines.forEach((line, index) => {
    if (!line.hsCode || !HS_CODE_REGEX.test(line.hsCode)) {
      problems.push(`Line ${index + 1} (${line.itemCode ?? line.description}): HS code missing or not "####.####" — set it on the item`);
    }
  });
  return problems;
}

export function buildDiPayload(source: FbrSource, opts: { sandbox: boolean }): DiInvoicePayload {
  const rate = source.exchangeRate;
  const registrationType = effectiveRegistrationType(source);
  const items: DiInvoiceItem[] = source.lines.map((line) => ({
    hsCode: line.hsCode ?? "",
    productDescription: line.description,
    rate: rateStringFor(line),
    uoM: line.fbrUom || FBR_DEFAULT_UOM,
    quantity: line.quantity.toDecimalPlaces(4).toNumber(),
    // "Total Sales Value (Including Tax)" per spec field table.
    totalValues: toNumber(line.grossAmount, rate),
    valueSalesExcludingST: toNumber(line.netAmount, rate),
    fixedNotifiedValueOrRetailPrice: line.retailValue ? toNumber(line.retailValue, rate) : 0,
    salesTaxApplicable: toNumber(line.vatAmount.sub(line.furtherTaxAmount), rate),
    salesTaxWithheldAtSource: 0,
    extraTax: 0,
    furtherTax: toNumber(line.furtherTaxAmount, rate),
    sroScheduleNo: line.sroScheduleNo ?? "",
    fedPayable: 0,
    discount: toNumber(line.discountAmount, rate),
    saleType: saleTypeFor(line),
    sroItemSerialNo: line.sroItemSerialNo ?? "",
  }));

  const payload: DiInvoicePayload = {
    // DI v1.12 has two document types: Sale Invoice and Debit Note. ERP
    // credit notes (returns/adjustments) go as a note referencing the
    // original FBR invoice number — confirm with the sandbox.
    invoiceType: source.isReturn ? "Debit Note" : "Sale Invoice",
    invoiceDate: source.postingDate.toISOString().slice(0, 10),
    sellerNTNCNIC: source.seller.ntn ?? "",
    sellerBusinessName: source.seller.legalName,
    sellerProvince: source.seller.province ?? "",
    sellerAddress: source.seller.address ?? "",
    buyerNTNCNIC: source.buyer.ntnCnic ?? "",
    buyerBusinessName: source.buyer.name,
    buyerProvince: source.buyer.province ?? "",
    buyerAddress: source.buyer.address ?? "",
    buyerRegistrationType: registrationType === FbrRegistrationType.REGISTERED ? "Registered" : "Unregistered",
    invoiceRefNo: source.isReturn ? source.originalFbrInvoiceNumber ?? "" : "",
    items,
  };
  if (opts.sandbox && source.lines.length > 0) {
    payload.scenarioId = resolveScenarioId({
      category: source.lines[0].vatCategory,
      saleType: saleTypeFor(source.lines[0]),
      buyerRegistrationType: registrationType,
      businessActivity: source.seller.businessActivity,
    });
  }
  return payload;
}

/** IMS DateTime: "yyyy-MM-dd HH:mm:ss" in Pakistan Standard Time (UTC+5, no DST). */
export function formatPkDateTime(date: Date): string {
  const pkt = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return pkt.toISOString().replace("T", " ").slice(0, 19);
}

export function buildPosPayload(
  source: FbrSource,
  opts: { posId: number; paymentMode: number },
): PosInvoicePayload {
  const rate = source.exchangeRate;
  const invoiceType = source.isReturn ? POS_INVOICE_TYPES.CREDIT : POS_INVOICE_TYPES.NEW;
  const refUsin = source.isReturn ? source.originalUsin ?? null : null;
  const ntnCnic = source.buyer.ntnCnic ?? null;

  const items: PosInvoiceItem[] = source.lines.map((line) => ({
    ItemCode: line.itemCode ?? "",
    ItemName: line.description,
    Quantity: line.quantity.toDecimalPlaces(4).toNumber(),
    PCTCode: (line.hsCode ?? "").replace(".", ""),
    TaxRate: line.vatRate.toDecimalPlaces(2).toNumber(),
    SaleValue: toNumber(line.netAmount, rate),
    TotalAmount: toNumber(line.grossAmount, rate),
    TaxCharged: toNumber(line.vatAmount.sub(line.furtherTaxAmount), rate),
    Discount: toNumber(line.discountAmount, rate),
    FurtherTax: toNumber(line.furtherTaxAmount, rate),
    InvoiceType: invoiceType,
    RefUSIN: refUsin,
  }));

  const sum = (pick: (i: PosInvoiceItem) => number) =>
    new Prisma.Decimal(items.reduce((s, i) => s.add(pick(i)), new Prisma.Decimal(0))).toDecimalPlaces(2).toNumber();

  return {
    InvoiceNumber: "",
    POSID: opts.posId,
    USIN: source.invoiceNumber,
    DateTime: formatPkDateTime(source.issueDateTime),
    BuyerNTN: ntnCnic && ntnCnic.length !== 13 ? ntnCnic : null,
    BuyerCNIC: ntnCnic && ntnCnic.length === 13 ? ntnCnic : null,
    BuyerName: source.buyer.name,
    BuyerPhoneNumber: source.buyer.phone ?? null,
    TotalBillAmount: sum((i) => i.TotalAmount),
    TotalQuantity: sum((i) => i.Quantity),
    TotalSaleValue: sum((i) => i.SaleValue),
    TotalTaxCharged: sum((i) => i.TaxCharged),
    Discount: sum((i) => i.Discount),
    FurtherTax: sum((i) => i.FurtherTax),
    PaymentMode: opts.paymentMode,
    RefUSIN: refUsin,
    InvoiceType: invoiceType,
    Items: items,
  };
}
