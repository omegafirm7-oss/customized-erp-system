import { FbrRegistrationType, VatCategory } from "@prisma/client";

/**
 * Pakistan / FBR reference data. Sources: PRAL "Technical Specification for
 * DI API" v1.12 (7-Apr-2025) — §5 reference APIs, §9 sandbox scenarios.
 * Province names match FBR's provinces reference API (stateProvinceDesc);
 * the live list can be re-synced via FbrReferenceService once a token exists.
 */
export const PK_PROVINCES = [
  "BALOCHISTAN",
  "AZAD JAMMU AND KASHMIR",
  "CAPITAL TERRITORY",
  "KHYBER PAKHTUNKHWA",
  "PUNJAB",
  "SINDH",
  "GILGIT BALTISTAN",
] as const;

/** Seller business activities (spec §9 scenario matrix). */
export const FBR_BUSINESS_ACTIVITIES = [
  "Manufacturer",
  "Importer",
  "Distributor",
  "Wholesaler",
  "Exporter",
  "Retailer",
  "Service Provider",
  "Other",
] as const;

export const FBR_SECTORS = [
  "All Other Sectors",
  "Steel",
  "FMCG",
  "Textile",
  "Telecom",
  "Petroleum",
  "Electricity Distribution",
  "Gas Distribution",
  "Services",
  "Automobile",
  "CNG Stations",
  "Pharmaceuticals",
  "Wholesale / Retails",
] as const;

/** NTN is 7 digits (some FBR forms show 9 incl. check digits); CNIC is 13. */
export const NTN_CNIC_REGEX = /^(\d{7}|\d{9}|\d{13})$/;
/** HS code as DI expects it: "0101.2100". */
export const HS_CODE_REGEX = /^\d{4}\.\d{4}$/;

/** DI `saleType` text per tax category (spec §5.8 SaleTypeToRate / §9). */
export const FBR_SALE_TYPE_BY_CATEGORY: Partial<Record<VatCategory, string>> = {
  PK_STANDARD: "Goods at standard rate (default)",
  PK_REDUCED: "Goods at Reduced Rate",
  PK_THIRD_SCHEDULE: "3rd Schedule Goods",
  PK_SERVICES: "Services",
  EXEMPT: "Exempt goods",
  ZERO_RATED: "Goods at zero-rate",
};

export const FBR_SERVICES_SALE_TYPE = "Services";

export const FBR_DEFAULT_UOM = "Numbers, pieces, units";

/**
 * Sandbox scenario for a line (spec §9). Only sent to the sandbox endpoint;
 * production routing ignores scenarioId. Retailers selling to end consumers
 * use the SN026–SN028 retail variants.
 */
export function resolveScenarioId(params: {
  category: VatCategory;
  saleType: string;
  buyerRegistrationType: FbrRegistrationType;
  businessActivity: string | null;
}): string {
  const retailEndConsumer =
    params.businessActivity === "Retailer" && params.buyerRegistrationType === FbrRegistrationType.UNREGISTERED;
  if (params.saleType === FBR_SERVICES_SALE_TYPE) return "SN019";
  switch (params.category) {
    case VatCategory.PK_REDUCED:
      return retailEndConsumer ? "SN028" : "SN005";
    case VatCategory.PK_THIRD_SCHEDULE:
      return retailEndConsumer ? "SN027" : "SN008";
    case VatCategory.EXEMPT:
      return "SN006";
    case VatCategory.ZERO_RATED:
      return "SN007";
    default:
      if (retailEndConsumer) return "SN026";
      return params.buyerRegistrationType === FbrRegistrationType.REGISTERED ? "SN001" : "SN002";
  }
}

/** Base scenarios every non-sector-specific seller must pass (spec §9). */
export const FBR_BASE_SCENARIOS = ["SN001", "SN002", "SN005", "SN006", "SN007"] as const;

export const FBR_SCENARIO_DESCRIPTIONS: Record<string, string> = {
  SN001: "Goods at standard rate to registered buyers",
  SN002: "Goods at standard rate to unregistered buyers",
  SN005: "Reduced rate sale",
  SN006: "Exempt goods sale",
  SN007: "Zero rated sale",
  SN008: "Sale of 3rd schedule goods",
  SN019: "Services rendered or provided",
  SN026: "Sale to end consumer by retailers (standard rate)",
  SN027: "Sale to end consumer by retailers (3rd schedule)",
  SN028: "Sale to end consumer by retailers (reduced rate)",
};

/** FBR IMS PaymentMode codes. */
export const POS_PAYMENT_MODES = {
  CASH: 1,
  CARD: 2,
  GIFT_VOUCHER: 3,
  LOYALTY_CARD: 4,
  MIXED: 5,
  CHEQUE: 6,
} as const;

/** FBR IMS InvoiceType codes. */
export const POS_INVOICE_TYPES = {
  NEW: 1,
  DEBIT: 2,
  CREDIT: 3,
} as const;

/** FBR IMS PostData success response code. */
export const POS_SUCCESS_CODE = "100";

export const FBR_ENDPOINTS = {
  DI_POST: { SANDBOX: "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata_sb", PRODUCTION: "https://gw.fbr.gov.pk/di_data/v1/di/postinvoicedata" },
  DI_VALIDATE: {
    SANDBOX: "https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata_sb",
    PRODUCTION: "https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata",
  },
  REFERENCE_BASE: "https://gw.fbr.gov.pk",
  POS_POST: {
    SANDBOX: "https://esp.fbr.gov.pk:8244/FBR/v1/api/Live/PostData",
    PRODUCTION: "https://gw.fbr.gov.pk/imsp/v1/api/Live/PostData",
  },
} as const;
