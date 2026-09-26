/**
 * Country-aware tax categories + Pakistan (FBR) reference lists for the UI.
 * Mirrors apps/api/src/finance/invoice-math.ts and fbr/fbr-constants.ts —
 * hand-mirrored rather than imported, per the codebase convention
 * (@erp/shared-constants is CJS and not importable by Vite at runtime).
 * The server recomputes every amount; UI previews are indicative.
 */

export type TaxCategory = "STANDARD_15" | "ZERO_RATED" | "EXEMPT" | "PK_STANDARD" | "PK_REDUCED" | "PK_THIRD_SCHEDULE" | "PK_SERVICES";

export interface TaxOption {
  value: TaxCategory;
  /** Short label for invoice line dropdowns. */
  short: string;
  /** Longer label for item master / reports. */
  label: string;
}

const SA_OPTIONS: TaxOption[] = [
  { value: "STANDARD_15", short: "15%", label: "Standard 15%" },
  { value: "ZERO_RATED", short: "0% (zero)", label: "Zero-rated" },
  { value: "EXEMPT", short: "Exempt", label: "Exempt" },
];

const PK_OPTIONS: TaxOption[] = [
  { value: "PK_STANDARD", short: "18%", label: "Standard 18% (goods)" },
  { value: "PK_SERVICES", short: "Services", label: "Services (provincial / ICT rate)" },
  { value: "PK_REDUCED", short: "Reduced", label: "Reduced rate (8th Sch. / SRO)" },
  { value: "PK_THIRD_SCHEDULE", short: "3rd Sch.", label: "Third Schedule (18% of retail price)" },
  { value: "ZERO_RATED", short: "0% (zero)", label: "Zero-rated (5th Schedule)" },
  { value: "EXEMPT", short: "Exempt", label: "Exempt (6th Schedule)" },
];

export function taxOptionsFor(countryCode: string | null | undefined): TaxOption[] {
  return countryCode === "PK" ? PK_OPTIONS : SA_OPTIONS;
}

export function defaultTaxCategory(countryCode: string | null | undefined): TaxCategory {
  return countryCode === "PK" ? "PK_STANDARD" : "STANDARD_15";
}

/** Rate for previews; PK_REDUCED uses the item's own rate (0 if unknown). */
export function previewRate(category: string, itemReducedRate?: string | number | null, servicesRate = 15): number {
  switch (category) {
    case "STANDARD_15":
      return 15;
    case "PK_STANDARD":
    case "PK_THIRD_SCHEDULE":
      return 18;
    case "PK_REDUCED":
      return Number(itemReducedRate ?? 0) || 0;
    case "PK_SERVICES":
      return Number(itemReducedRate ?? 0) || servicesRate;
    default:
      return 0;
  }
}

export const TAX_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  [...SA_OPTIONS, ...PK_OPTIONS].map((o) => [o.value, o.label]),
);

export const PK_PROVINCES = [
  "BALOCHISTAN",
  "AZAD JAMMU AND KASHMIR",
  "CAPITAL TERRITORY",
  "KHYBER PAKHTUNKHWA",
  "PUNJAB",
  "SINDH",
  "GILGIT BALTISTAN",
] as const;

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

export const NTN_CNIC_PATTERN = "^(\\d{7}|\\d{9}|\\d{13})$";
export const HS_CODE_PATTERN = "^\\d{4}\\.\\d{4}$";
