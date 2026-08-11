export enum AccountClass {
  ASSET = "ASSET",
  LIABILITY = "LIABILITY",
  EQUITY = "EQUITY",
  REVENUE = "REVENUE",
  EXPENSE = "EXPENSE",
}

export enum NormalBalance {
  DEBIT = "DEBIT",
  CREDIT = "CREDIT",
}

export enum ControlAccountType {
  AR = "AR",
  AP = "AP",
  INVENTORY = "INVENTORY",
  BANK = "BANK",
  CASH = "CASH",
  VAT_OUTPUT = "VAT_OUTPUT",
  VAT_INPUT = "VAT_INPUT",
  COGS = "COGS",
  INVENTORY_ADJUSTMENT = "INVENTORY_ADJUSTMENT",
  CONTRACT_ASSET = "CONTRACT_ASSET",
  CONTRACT_LIABILITY = "CONTRACT_LIABILITY",
  CONTRACT_REVENUE = "CONTRACT_REVENUE",
  EMPLOYEE_LOANS = "EMPLOYEE_LOANS",
  SALARIES_PAYABLE = "SALARIES_PAYABLE",
  GOSI_PAYABLE = "GOSI_PAYABLE",
  EOSB_PROVISION = "EOSB_PROVISION",
  LEAVE_PROVISION = "LEAVE_PROVISION",
  SALARY_EXPENSE = "SALARY_EXPENSE",
  PROJECT_SALARY_EXPENSE = "PROJECT_SALARY_EXPENSE",
  GOSI_EXPENSE = "GOSI_EXPENSE",
  EOSB_EXPENSE = "EOSB_EXPENSE",
  LEAVE_EXPENSE = "LEAVE_EXPENSE",
  MANPOWER_REVENUE = "MANPOWER_REVENUE",
  EQUIPMENT_REVENUE = "EQUIPMENT_REVENUE",
  DISPOSAL_GAIN_LOSS = "DISPOSAL_GAIN_LOSS",
  EQUIPMENT_ASSET = "EQUIPMENT_ASSET",
  ACCUM_DEPRECIATION = "ACCUM_DEPRECIATION",
  DEPRECIATION_EXPENSE = "DEPRECIATION_EXPENSE",
  ALLOWANCE_EXPENSE = "ALLOWANCE_EXPENSE",
  FOOD_EXPENSE = "FOOD_EXPENSE",
}

export enum FiscalYearStatus {
  OPEN = "OPEN",
  CLOSED = "CLOSED",
}

export enum FiscalPeriodStatus {
  OPEN = "OPEN",
  SOFT_CLOSED = "SOFT_CLOSED",
  CLOSED = "CLOSED",
}

export enum JournalEntryStatus {
  DRAFT = "DRAFT",
  POSTED = "POSTED",
  REVERSED = "REVERSED",
}

export enum JournalSourceModule {
  MANUAL = "MANUAL",
  AR = "AR",
  AP = "AP",
  INVENTORY = "INVENTORY",
  PAYROLL = "PAYROLL",
  PROJECTS = "PROJECTS",
  EQUIPMENT = "EQUIPMENT",
}

export enum EmployeeStatus {
  ACTIVE = "ACTIVE",
  TERMINATED = "TERMINATED",
}

export enum ContractType {
  UNLIMITED = "UNLIMITED",
  LIMITED = "LIMITED",
}

export enum PayrollRunStatus {
  DRAFT = "DRAFT",
  POSTED = "POSTED",
  REVERSED = "REVERSED",
}

export enum LoanStatus {
  ACTIVE = "ACTIVE",
  SETTLED = "SETTLED",
  CANCELLED = "CANCELLED",
}

/** Wage basis used for EOSB and leave provisions (Saudi Labor Law "wage"
 * is the full last wage; some firms provision on basic+housing only). */
export enum EosbBasis {
  BASIC_ONLY = "BASIC_ONLY",
  BASIC_HOUSING = "BASIC_HOUSING",
  FULL_GROSS = "FULL_GROSS",
}

export enum SettlementReason {
  RESIGNATION = "RESIGNATION",
  TERMINATION_BY_EMPLOYER = "TERMINATION_BY_EMPLOYER",
  CONTRACT_END = "CONTRACT_END",
}

export enum SettlementStatus {
  POSTED = "POSTED",
  REVERSED = "REVERSED",
}

export enum ManpowerContractStatus {
  ACTIVE = "ACTIVE",
  CLOSED = "CLOSED",
}

export enum RateBasis {
  HOURLY = "HOURLY",
  DAILY = "DAILY",
  MONTHLY = "MONTHLY",
}

export enum TimesheetStatus {
  DRAFT = "DRAFT",
  APPROVED = "APPROVED",
  INVOICED = "INVOICED",
}

export enum TimesheetDayType {
  WORKED = "WORKED",
  REST = "REST",
  ABSENT = "ABSENT",
  UNPAID_LEAVE = "UNPAID_LEAVE",
  ANNUAL_LEAVE = "ANNUAL_LEAVE",
}

/** Informal, manually-settled cash paid to an employee outside payroll —
 * distinct from EmployeeLoan (formal, installment-scheduled advances). */
export enum EmployeePaymentCategory {
  ALLOWANCE = "ALLOWANCE",
  ADVANCE = "ADVANCE",
  OTHER = "OTHER",
}

export enum EquipmentStatus {
  ACTIVE = "ACTIVE",
  DISPOSED = "DISPOSED",
}

/** Billable = anything except BREAKDOWN (idle units kept on site still bill). */
export enum UsageDayType {
  ON_RENT = "ON_RENT",
  IDLE = "IDLE",
  BREAKDOWN = "BREAKDOWN",
}

export enum ProjectStatus {
  PLANNED = "PLANNED",
  ACTIVE = "ACTIVE",
  COMPLETED = "COMPLETED",
  CLOSED = "CLOSED",
}

export enum RecognitionMethod {
  POINT_IN_TIME = "POINT_IN_TIME",
  OVER_TIME = "OVER_TIME",
}

export enum DocumentType {
  JOURNAL_ENTRY = "JOURNAL_ENTRY",
  SALES_INVOICE = "SALES_INVOICE",
  CREDIT_NOTE = "CREDIT_NOTE",
  PURCHASE_INVOICE = "PURCHASE_INVOICE",
  GOODS_RECEIPT = "GOODS_RECEIPT",
  GOODS_ISSUE = "GOODS_ISSUE",
  INCOMING_PAYMENT = "INCOMING_PAYMENT",
  OUTGOING_PAYMENT = "OUTGOING_PAYMENT",
  STOCK_TRANSFER = "STOCK_TRANSFER",
  STOCK_ADJUSTMENT = "STOCK_ADJUSTMENT",
  PAYROLL_RUN = "PAYROLL_RUN",
  EMPLOYEE_LOAN = "EMPLOYEE_LOAN",
  FINAL_SETTLEMENT = "FINAL_SETTLEMENT",
  DEPRECIATION_RUN = "DEPRECIATION_RUN",
  EMPLOYEE_PAYMENT = "EMPLOYEE_PAYMENT",
}

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  POSTED = "POSTED",
  PARTIALLY_PAID = "PARTIALLY_PAID",
  PAID = "PAID",
  CANCELLED = "CANCELLED",
}

export enum SalesDocumentKind {
  INVOICE = "INVOICE",
  CREDIT_NOTE = "CREDIT_NOTE",
}

export enum PaymentDirection {
  INCOMING = "INCOMING",
  OUTGOING = "OUTGOING",
}

export enum PaymentStatus {
  POSTED = "POSTED",
  CANCELLED = "CANCELLED",
}

export enum PartnerType {
  CUSTOMER = "CUSTOMER",
  VENDOR = "VENDOR",
  BOTH = "BOTH",
}

export enum ItemType {
  INVENTORY = "INVENTORY",
  SERVICE = "SERVICE",
  NON_INVENTORY = "NON_INVENTORY",
}

export enum VatCategory {
  STANDARD_15 = "STANDARD_15",
  ZERO_RATED = "ZERO_RATED",
  EXEMPT = "EXEMPT",
}

/**
 * Current KSA VAT rates by category, percent. Documents snapshot the rate
 * per line at creation time — a future rate change here must never alter
 * amounts on existing invoices.
 */
export const VAT_RATES: Record<VatCategory, number> = {
  [VatCategory.STANDARD_15]: 15,
  [VatCategory.ZERO_RATED]: 0,
  [VatCategory.EXEMPT]: 0,
};

/** ZATCA invoice type codes (UBL InvoiceTypeCode). DEBIT_NOTE is used only
 * for the synthetic onboarding compliance samples — the ERP does not issue
 * debit notes as accounting documents. */
export const ZATCA_INVOICE_TYPE_CODES = {
  INVOICE: "388",
  CREDIT_NOTE: "381",
  DEBIT_NOTE: "383",
} as const;

/** KSA-2 invoice subtype codes (InvoiceTypeCode/@name, 7 chars NNPNESB). */
export const ZATCA_TRANSACTION_TYPE_CODES = {
  STANDARD: "0100000",
  SIMPLIFIED: "0200000",
} as const;

export enum ZatcaEnvironment {
  SANDBOX = "SANDBOX",
  SIMULATION = "SIMULATION",
  PRODUCTION = "PRODUCTION",
}

export enum ZatcaDeviceStatus {
  CREATED = "CREATED",
  COMPLIANCE_CSID_ISSUED = "COMPLIANCE_CSID_ISSUED",
  COMPLIANCE_CHECKED = "COMPLIANCE_CHECKED",
  ACTIVE = "ACTIVE",
  FAILED = "FAILED",
  REVOKED = "REVOKED",
}

export enum ZatcaInvoiceKind {
  STANDARD = "STANDARD",
  SIMPLIFIED = "SIMPLIFIED",
}

export enum ZatcaSubmissionType {
  CLEARANCE = "CLEARANCE",
  REPORTING = "REPORTING",
}

export enum ZatcaSubmissionStatus {
  PENDING = "PENDING",
  CLEARED = "CLEARED",
  REPORTED = "REPORTED",
  REJECTED = "REJECTED",
  FAILED = "FAILED",
}

/**
 * VAT exemption reason codes (VATEX-SA-*) required on zero-rated and exempt
 * invoice lines. Subset of the ZATCA catalog covering common cases; extend
 * as needed.
 */
export const VATEX_CODES = {
  // Exempt (category E)
  "VATEX-SA-29": "Financial services",
  "VATEX-SA-29-7": "Life insurance services",
  "VATEX-SA-30": "Real estate transactions",
  // Zero-rated (category Z)
  "VATEX-SA-32": "Export of goods",
  "VATEX-SA-33": "Export of services",
  "VATEX-SA-34-1": "International transport of goods",
  "VATEX-SA-34-2": "International transport of passengers",
  "VATEX-SA-35": "Medicines and medical equipment",
  "VATEX-SA-36": "Qualifying metals (investment)",
} as const;

export type VatexCode = keyof typeof VATEX_CODES;

export enum CompanyUserStatus {
  ACTIVE = "ACTIVE",
  INVITED = "INVITED",
  SUSPENDED = "SUSPENDED",
}

export enum AuditAction {
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
  POST = "POST",
  REVERSE = "REVERSE",
  CLOSE = "CLOSE",
}

export const SYSTEM_ROLES = {
  ADMINISTRATOR: "Administrator",
  ACCOUNTANT: "Accountant",
  VIEWER: "Viewer",
} as const;

export const PERMISSIONS = {
  IAM_USER_INVITE: "iam.user.invite",
  IAM_USER_MANAGE: "iam.user.manage",
  IAM_ROLE_MANAGE: "iam.role.manage",
  COMPANY_MANAGE: "companies.company.manage",
  PERIOD_CLOSE: "gl.period.close",
  PERIOD_POST_SOFT_CLOSED: "gl.period.post_softclosed",
  COA_ACCOUNT_MANAGE: "coa.account.manage",
  JOURNAL_CREATE: "gl.journal.create",
  JOURNAL_POST: "gl.journal.post",
  JOURNAL_REVERSE: "gl.journal.reverse",
  JOURNAL_VIEW: "gl.journal.view",
  PARTNER_CUSTOMER_MANAGE: "partners.customer.manage",
  PARTNER_VENDOR_MANAGE: "partners.vendor.manage",
  ITEM_MANAGE: "items.item.manage",
  REPORTS_VIEW: "reports.view",
  AR_INVOICE_CREATE: "ar.invoice.create",
  AR_INVOICE_POST: "ar.invoice.post",
  AR_INVOICE_CANCEL: "ar.invoice.cancel",
  AR_INVOICE_VIEW: "ar.invoice.view",
  AR_QUOTATION_MANAGE: "ar.quotation.manage",
  AR_QUOTATION_VIEW: "ar.quotation.view",
  AR_ORDER_MANAGE: "ar.order.manage",
  AR_ORDER_VIEW: "ar.order.view",
  AP_INVOICE_CREATE: "ap.invoice.create",
  AP_INVOICE_POST: "ap.invoice.post",
  AP_INVOICE_CANCEL: "ap.invoice.cancel",
  AP_INVOICE_VIEW: "ap.invoice.view",
  AP_QUOTATION_MANAGE: "ap.quotation.manage",
  AP_QUOTATION_VIEW: "ap.quotation.view",
  AP_ORDER_MANAGE: "ap.order.manage",
  AP_ORDER_VIEW: "ap.order.view",
  PAYMENT_CREATE: "payments.payment.create",
  PAYMENT_CANCEL: "payments.payment.cancel",
  PAYMENT_VIEW: "payments.payment.view",
  ZATCA_DEVICE_MANAGE: "zatca.device.manage",
  ZATCA_SUBMISSION_VIEW: "zatca.submission.view",
  ZATCA_SUBMISSION_RETRY: "zatca.submission.retry",
  INVENTORY_STOCK_VIEW: "inventory.stock.view",
  INVENTORY_TRANSFER_CREATE: "inventory.transfer.create",
  INVENTORY_ADJUSTMENT_CREATE: "inventory.adjustment.create",
  PROJECT_MANAGE: "projects.project.manage",
  PROJECT_VIEW: "projects.project.view",
  PROJECT_REVREC_RUN: "projects.revrec.run",
  HR_EMPLOYEE_MANAGE: "hr.employee.manage",
  HR_EMPLOYEE_VIEW: "hr.employee.view",
  HR_PAYROLL_RUN: "hr.payroll.run",
  HR_SETTINGS_MANAGE: "hr.settings.manage",
  MANPOWER_CONTRACT_MANAGE: "manpower.contract.manage",
  MANPOWER_CONTRACT_VIEW: "manpower.contract.view",
  MANPOWER_TIMESHEET_MANAGE: "manpower.timesheet.manage",
  MANPOWER_BILLING_GENERATE: "manpower.billing.generate",
  EQUIPMENT_MANAGE: "equipment.manage",
  EQUIPMENT_VIEW: "equipment.view",
  EQUIPMENT_BILLING_GENERATE: "equipment.billing.generate",
  EQUIPMENT_DEPRECIATION_RUN: "equipment.depreciation.run",
  HIRED_EQUIPMENT_CONTRACT_MANAGE: "hired-equipment.contract.manage",
  HIRED_EQUIPMENT_CONTRACT_VIEW: "hired-equipment.contract.view",
  HIRED_EQUIPMENT_TIMESHEET_MANAGE: "hired-equipment.timesheet.manage",
  HIRED_EQUIPMENT_BILLING_GENERATE: "hired-equipment.billing.generate",
  CRM_LEAD_MANAGE: "crm.lead.manage",
  CRM_LEAD_VIEW: "crm.lead.view",
  CRM_OPPORTUNITY_MANAGE: "crm.opportunity.manage",
  CRM_OPPORTUNITY_VIEW: "crm.opportunity.view",
  CRM_CONTACT_MANAGE: "crm.contact.manage",
  CRM_ACTIVITY_MANAGE: "crm.activity.manage",
  SETTINGS_TEMPLATES_MANAGE: "settings.templates.manage",
  SETTINGS_ACTIVITY_LOG_VIEW: "settings.activity-log.view",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Premium modules a client company may or may not be entitled to. Distinct
// from PERMISSIONS.*'s module prefix (which is just a UI grouping label for
// the role editor) — this is a tenant-level entitlement toggled per company
// by the platform admin, checked by ModuleEntitlementGuard.
export const MODULE_KEYS = {
  PURCHASE: "purchase",
  CRM: "crm",
  SALES: "sales",
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];
