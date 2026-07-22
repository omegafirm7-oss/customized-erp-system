import type {
  AccountClass,
  ControlAccountType,
  DocumentType,
  FiscalPeriodStatus,
  FiscalYearStatus,
  InvoiceStatus,
  ItemType,
  JournalEntryStatus,
  JournalSourceModule,
  NormalBalance,
  PartnerType,
  PaymentDirection,
  PaymentStatus,
  SalesDocumentKind,
  VatCategory,
} from "@erp/shared-constants";

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  activeCompanyId: string | null;
  roleId: string | null;
  permissions: string[];
}

export interface CompanyMembership {
  companyId: string;
  companyCode: string;
  companyName: string;
  roleName: string;
  isDefault: boolean;
}

export interface CompanySummary {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  countryCode: string;
  baseCurrency: string;
  taxRegistrationNumber: string | null;
  isActive: boolean;
}

export interface CreateCompanyRequest {
  code: string;
  legalName: string;
  tradeName?: string;
  countryCode: string;
  baseCurrency: string;
  taxRegistrationNumber?: string;
  crNumber?: string;
}

export interface FiscalPeriodSummary {
  id: string;
  periodNumber: number;
  startDate: string;
  endDate: string;
  status: FiscalPeriodStatus;
}

export interface FiscalYearSummary {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
  periods: FiscalPeriodSummary[];
}

export interface AccountSummary {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  accountClass: AccountClass;
  parentAccountId: string | null;
  isPostable: boolean;
  normalBalance: NormalBalance;
  controlAccountType: ControlAccountType | null;
  isActive: boolean;
}

export interface JournalEntryLineInput {
  accountId: string;
  debit: string;
  credit: string;
  description?: string;
  businessPartnerId?: string;
  costCenterId?: string;
}

export interface CreateJournalEntryRequest {
  postingDate: string;
  documentDate: string;
  currencyCode: string;
  memo?: string;
  lines: JournalEntryLineInput[];
}

export interface JournalEntryLineSummary {
  id: string;
  lineNumber: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string | null;
}

export interface JournalEntrySummary {
  id: string;
  entryNumber: string;
  postingDate: string;
  documentDate: string;
  status: JournalEntryStatus;
  sourceModule: JournalSourceModule;
  memo: string | null;
  reversalOfEntryId: string | null;
  reversedByEntryId: string | null;
  lines: JournalEntryLineSummary[];
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  openingBalance: string;
  debit: string;
  credit: string;
  closingBalance: string;
}

export interface TrialBalanceReport {
  asOfDate: string;
  rows: TrialBalanceRow[];
  totalDebit: string;
  totalCredit: string;
}

export interface BusinessPartnerSummary {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  partnerType: PartnerType;
  taxRegistrationNumber: string | null;
  isActive: boolean;
}

export interface ItemSummary {
  id: string;
  code: string;
  name: string;
  itemType: ItemType;
  vatCategory: VatCategory;
  isActive: boolean;
}

export interface DocumentTypeRef {
  documentType: DocumentType;
}

// ── Finance: invoices & payments ─────────────────────────────────────────

export interface InvoiceLineInput {
  itemId?: string;
  description: string;
  uomId?: string;
  quantity: string;
  unitPrice: string;
  discountAmount?: string;
  vatCategory?: VatCategory;
  accountId?: string;
}

export interface InvoiceLineSummary {
  id: string;
  lineNumber: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  netAmount: string;
  vatCategory: VatCategory;
  vatRate: string;
  vatAmount: string;
  grossAmount: string;
}

export interface SalesInvoiceSummary {
  id: string;
  invoiceNumber: string | null;
  documentKind: SalesDocumentKind;
  businessPartnerId: string;
  partnerName?: string;
  originalInvoiceId: string | null;
  status: InvoiceStatus;
  issueDateTime: string;
  postingDate: string;
  dueDate: string;
  currencyCode: string;
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
  paidAmount: string;
  openAmount: string;
  memo: string | null;
  lines: InvoiceLineSummary[];
}

export interface PurchaseInvoiceSummary {
  id: string;
  invoiceNumber: string | null;
  vendorInvoiceNumber: string;
  businessPartnerId: string;
  partnerName?: string;
  status: InvoiceStatus;
  postingDate: string;
  dueDate: string;
  currencyCode: string;
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
  paidAmount: string;
  openAmount: string;
  memo: string | null;
  lines: InvoiceLineSummary[];
}

export interface PaymentAllocationInput {
  invoiceId: string;
  amount: string;
}

export interface CreatePaymentRequest {
  businessPartnerId: string;
  paymentDate: string;
  bankCashAccountId: string;
  amount: string;
  reference?: string;
  memo?: string;
  allocations: PaymentAllocationInput[];
}

export interface PaymentSummary {
  id: string;
  paymentNumber: string | null;
  direction: PaymentDirection;
  businessPartnerId: string;
  partnerName?: string;
  paymentDate: string;
  currencyCode: string;
  amount: string;
  allocatedAmount: string;
  unallocatedAmount: string;
  reference: string | null;
  status: PaymentStatus;
}

// ── Finance: reports ─────────────────────────────────────────────────────

export interface AgingRow {
  businessPartnerId: string;
  partnerCode: string;
  partnerName: string;
  current: string;
  days1to30: string;
  days31to60: string;
  days61to90: string;
  days90plus: string;
  total: string;
}

export interface AgingReport {
  asOfDate: string;
  rows: AgingRow[];
  totals: Omit<AgingRow, "businessPartnerId" | "partnerCode" | "partnerName">;
}

export interface VatCategoryBreakdown {
  vatCategory: VatCategory;
  netAmount: string;
  vatAmount: string;
}

export interface VatReturnReport {
  fromDate: string;
  toDate: string;
  salesByCategory: VatCategoryBreakdown[];
  purchasesByCategory: VatCategoryBreakdown[];
  outputVat: string;
  inputVat: string;
  netVatPayable: string;
}
