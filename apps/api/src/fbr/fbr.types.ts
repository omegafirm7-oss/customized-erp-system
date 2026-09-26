/**
 * Wire formats for FBR Digital Invoicing (PRAL DI API v1.12) and FBR POS
 * Integration (IMS PostData). Field names are exactly what FBR expects —
 * including their casing — so do not "fix" them.
 */

export interface DiInvoiceItem {
  hsCode: string;
  productDescription: string;
  rate: string;
  uoM: string;
  quantity: number;
  totalValues: number;
  valueSalesExcludingST: number;
  fixedNotifiedValueOrRetailPrice: number;
  salesTaxApplicable: number;
  salesTaxWithheldAtSource: number;
  extraTax: number;
  furtherTax: number;
  sroScheduleNo: string;
  fedPayable: number;
  discount: number;
  saleType: string;
  sroItemSerialNo: string;
}

export interface DiInvoicePayload {
  invoiceType: "Sale Invoice" | "Debit Note";
  invoiceDate: string;
  sellerNTNCNIC: string;
  sellerBusinessName: string;
  sellerProvince: string;
  sellerAddress: string;
  buyerNTNCNIC: string;
  buyerBusinessName: string;
  buyerProvince: string;
  buyerAddress: string;
  buyerRegistrationType: "Registered" | "Unregistered";
  invoiceRefNo: string;
  /** Sandbox only — omitted for production. */
  scenarioId?: string;
  items: DiInvoiceItem[];
}

export interface DiItemStatus {
  itemSNo: string;
  statusCode: string;
  status: string;
  invoiceNo: string | null;
  errorCode: string;
  error: string;
}

export interface DiResponse {
  invoiceNumber?: string;
  dated: string;
  validationResponse: {
    statusCode: string;
    status: string;
    errorCode?: string;
    error: string;
    invoiceStatuses: DiItemStatus[] | null;
  };
}

export interface PosInvoiceItem {
  ItemCode: string;
  ItemName: string;
  Quantity: number;
  PCTCode: string;
  TaxRate: number;
  SaleValue: number;
  TotalAmount: number;
  TaxCharged: number;
  Discount: number;
  FurtherTax: number;
  InvoiceType: number;
  RefUSIN: string | null;
}

export interface PosInvoicePayload {
  InvoiceNumber: string;
  POSID: number;
  USIN: string;
  DateTime: string;
  BuyerNTN: string | null;
  BuyerCNIC: string | null;
  BuyerName: string | null;
  BuyerPhoneNumber: string | null;
  TotalBillAmount: number;
  TotalQuantity: number;
  TotalSaleValue: number;
  TotalTaxCharged: number;
  Discount: number;
  FurtherTax: number;
  PaymentMode: number;
  RefUSIN: string | null;
  InvoiceType: number;
  Items: PosInvoiceItem[];
}

export interface PosResponse {
  InvoiceNumber: string | null;
  Code: string;
  Response: string;
  Errors: string | null;
}

/**
 * Transport-level classification, mirroring ZatcaApiClient: callers drive
 * the submission state machine off this rather than try/catch.
 *  - ACCEPTED: FBR issued an invoice number
 *  - REJECTED: FBR validation failure — fix data, then retry manually
 *  - AUTH_FAILED: token missing/expired/IP not whitelisted (401/403)
 *  - TRANSIENT_FAILURE: 5xx / network / timeout — retried automatically
 */
export type FbrOutcome = "ACCEPTED" | "REJECTED" | "AUTH_FAILED" | "TRANSIENT_FAILURE";

export interface FbrCallResult<T> {
  outcome: FbrOutcome;
  httpStatus: number | null;
  body: T | null;
  fbrInvoiceNumber: string | null;
  errors: Array<{ code: string; message: string; itemSNo?: string }>;
}
