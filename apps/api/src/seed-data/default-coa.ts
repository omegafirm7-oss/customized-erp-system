import type { ControlAccountType, ProjectCostCategory } from "@prisma/client";

export interface DefaultCoaEntry {
  code: string;
  name: string;
  subClassCode: string;
  parentCode?: string;
  isPostable: boolean;
  normalBalance: "DEBIT" | "CREDIT";
  // Typed off the Prisma enum so new control-account types can never drift
  // out of sync with the schema (same fix as coa.service.ts in Phase 5).
  controlAccountType?: ControlAccountType;
  // Project Intelligence dashboard bucket — see ProjectCostCategory in
  // schema.prisma. Undefined means uncategorized (shown as "Other").
  costCategory?: ProjectCostCategory;
}

/**
 * Default IFRS-aligned chart of accounts, cloned into every new company at
 * creation time (see companies.service.ts). Numeric ranges: 1000s Assets,
 * 2000s Liabilities, 3000s Equity, 4000s Revenue, 5000s Expenses — mirrors
 * SAP B1's "template on company creation" pattern. Header (non-postable)
 * accounts group leaf accounts for statement presentation; only leaf
 * accounts are postable.
 */
export const DEFAULT_COA_TEMPLATE: DefaultCoaEntry[] = [
  // Assets
  { code: "1000", name: "Current Assets", subClassCode: "CURRENT_ASSET", isPostable: false, normalBalance: "DEBIT" },
  { code: "1100", name: "Cash and Cash Equivalents", subClassCode: "CURRENT_ASSET", parentCode: "1000", isPostable: false, normalBalance: "DEBIT" },
  { code: "1110", name: "Petty Cash", subClassCode: "CURRENT_ASSET", parentCode: "1100", isPostable: true, normalBalance: "DEBIT", controlAccountType: "CASH" },
  { code: "1120", name: "Bank Accounts", subClassCode: "CURRENT_ASSET", parentCode: "1100", isPostable: true, normalBalance: "DEBIT", controlAccountType: "BANK" },
  { code: "1200", name: "Trade Receivables", subClassCode: "CURRENT_ASSET", parentCode: "1000", isPostable: false, normalBalance: "DEBIT" },
  { code: "1210", name: "Accounts Receivable - Trade", subClassCode: "CURRENT_ASSET", parentCode: "1200", isPostable: true, normalBalance: "DEBIT", controlAccountType: "AR" },
  { code: "1300", name: "Inventory", subClassCode: "CURRENT_ASSET", parentCode: "1000", isPostable: false, normalBalance: "DEBIT" },
  { code: "1310", name: "Inventory - Trading Goods", subClassCode: "CURRENT_ASSET", parentCode: "1300", isPostable: true, normalBalance: "DEBIT", controlAccountType: "INVENTORY" },
  { code: "1400", name: "Prepaid Expenses", subClassCode: "CURRENT_ASSET", parentCode: "1000", isPostable: true, normalBalance: "DEBIT" },
  { code: "1160", name: "Employee Loans & Advances", subClassCode: "CURRENT_ASSET", parentCode: "1000", isPostable: true, normalBalance: "DEBIT", controlAccountType: "EMPLOYEE_LOANS" },
  { code: "1150", name: "VAT Receivable (Input VAT)", subClassCode: "CURRENT_ASSET", parentCode: "1000", isPostable: true, normalBalance: "DEBIT", controlAccountType: "VAT_INPUT" },
  { code: "1450", name: "Contract Asset (WIP)", subClassCode: "CURRENT_ASSET", parentCode: "1000", isPostable: true, normalBalance: "DEBIT", controlAccountType: "CONTRACT_ASSET" },

  { code: "1500", name: "Non-Current Assets", subClassCode: "NON_CURRENT_ASSET", isPostable: false, normalBalance: "DEBIT" },
  { code: "1510", name: "Property, Plant & Equipment", subClassCode: "NON_CURRENT_ASSET", parentCode: "1500", isPostable: false, normalBalance: "DEBIT" },
  { code: "1511", name: "Land & Buildings", subClassCode: "NON_CURRENT_ASSET", parentCode: "1510", isPostable: true, normalBalance: "DEBIT" },
  { code: "1512", name: "Furniture, Fixtures & Equipment", subClassCode: "NON_CURRENT_ASSET", parentCode: "1510", isPostable: true, normalBalance: "DEBIT", controlAccountType: "EQUIPMENT_ASSET" },
  { code: "1519", name: "Accumulated Depreciation - PPE", subClassCode: "NON_CURRENT_ASSET", parentCode: "1510", isPostable: true, normalBalance: "CREDIT", controlAccountType: "ACCUM_DEPRECIATION" },
  { code: "1520", name: "Intangible Assets", subClassCode: "NON_CURRENT_ASSET", parentCode: "1500", isPostable: true, normalBalance: "DEBIT" },

  // Liabilities
  { code: "2000", name: "Current Liabilities", subClassCode: "CURRENT_LIABILITY", isPostable: false, normalBalance: "CREDIT" },
  { code: "2100", name: "Trade Payables", subClassCode: "CURRENT_LIABILITY", parentCode: "2000", isPostable: false, normalBalance: "CREDIT" },
  { code: "2110", name: "Accounts Payable - Trade", subClassCode: "CURRENT_LIABILITY", parentCode: "2100", isPostable: true, normalBalance: "CREDIT", controlAccountType: "AP" },
  { code: "2200", name: "VAT Payable", subClassCode: "CURRENT_LIABILITY", parentCode: "2000", isPostable: true, normalBalance: "CREDIT", controlAccountType: "VAT_OUTPUT" },
  { code: "2300", name: "Accrued Expenses", subClassCode: "CURRENT_LIABILITY", parentCode: "2000", isPostable: true, normalBalance: "CREDIT" },
  { code: "2310", name: "Accrued Salaries Payable", subClassCode: "CURRENT_LIABILITY", parentCode: "2000", isPostable: true, normalBalance: "CREDIT", controlAccountType: "SALARIES_PAYABLE" },
  { code: "2320", name: "GOSI Payable", subClassCode: "CURRENT_LIABILITY", parentCode: "2000", isPostable: true, normalBalance: "CREDIT", controlAccountType: "GOSI_PAYABLE" },
  { code: "2340", name: "Leave Provision", subClassCode: "CURRENT_LIABILITY", parentCode: "2000", isPostable: true, normalBalance: "CREDIT", controlAccountType: "LEAVE_PROVISION" },
  { code: "2400", name: "Contract Liability (Progress Billings)", subClassCode: "CURRENT_LIABILITY", parentCode: "2000", isPostable: true, normalBalance: "CREDIT", controlAccountType: "CONTRACT_LIABILITY" },

  { code: "2500", name: "Non-Current Liabilities", subClassCode: "NON_CURRENT_LIABILITY", isPostable: false, normalBalance: "CREDIT" },
  { code: "2510", name: "Long-Term Loans", subClassCode: "NON_CURRENT_LIABILITY", parentCode: "2500", isPostable: true, normalBalance: "CREDIT" },
  { code: "2520", name: "End-of-Service Benefits Provision", subClassCode: "NON_CURRENT_LIABILITY", parentCode: "2500", isPostable: true, normalBalance: "CREDIT", controlAccountType: "EOSB_PROVISION" },

  // Equity
  { code: "3100", name: "Share Capital", subClassCode: "SHARE_CAPITAL", isPostable: true, normalBalance: "CREDIT" },
  { code: "3200", name: "Retained Earnings", subClassCode: "RETAINED_EARNINGS", isPostable: true, normalBalance: "CREDIT" },
  { code: "3300", name: "Reserves", subClassCode: "RESERVES", isPostable: true, normalBalance: "CREDIT" },

  // Revenue
  { code: "4100", name: "Sales Revenue", subClassCode: "OPERATING_REVENUE", isPostable: true, normalBalance: "CREDIT" },
  { code: "4200", name: "Service Revenue", subClassCode: "OPERATING_REVENUE", isPostable: true, normalBalance: "CREDIT" },
  { code: "4300", name: "Contract Revenue (POC)", subClassCode: "OPERATING_REVENUE", isPostable: true, normalBalance: "CREDIT", controlAccountType: "CONTRACT_REVENUE" },
  { code: "4400", name: "Manpower Rental Revenue", subClassCode: "OPERATING_REVENUE", isPostable: true, normalBalance: "CREDIT", controlAccountType: "MANPOWER_REVENUE" },
  { code: "4500", name: "Equipment Rental Revenue", subClassCode: "OPERATING_REVENUE", isPostable: true, normalBalance: "CREDIT", controlAccountType: "EQUIPMENT_REVENUE" },
  { code: "4900", name: "Other Income", subClassCode: "OTHER_INCOME", isPostable: true, normalBalance: "CREDIT" },
  { code: "4950", name: "Gain/Loss on Asset Disposal", subClassCode: "INVESTING_INCOME", isPostable: true, normalBalance: "CREDIT", controlAccountType: "DISPOSAL_GAIN_LOSS" },

  // Expenses
  { code: "5100", name: "Cost of Goods Sold", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", controlAccountType: "COGS" },
  // Direct project/site costs for a contracting business — these ARE cost
  // of sales (unlike a trading company where COGS is only merchandise
  // resold), since they're incurred specifically to execute a revenue-
  // generating contract. See project_expense_coa_and_import memory.
  { code: "5101", name: "Direct Materials", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", costCategory: "MATERIAL" },
  { code: "5102", name: "Machinery & Equipment Rental (Project)", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", costCategory: "MACHINERY", controlAccountType: "HIRED_EQUIPMENT_EXPENSE" },
  { code: "5103", name: "Fuel & Lubricants (Project)", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", costCategory: "MACHINERY" },
  { code: "5104", name: "Site Tools & Consumables", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", costCategory: "MATERIAL" },
  { code: "5105", name: "Safety Gear & PPEs", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", costCategory: "MATERIAL" },
  { code: "5106", name: "Site Facilities (Office/Container/Shelter/Water)", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", costCategory: "MATERIAL" },
  { code: "5107", name: "Site Transportation", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", costCategory: "MACHINERY" },
  { code: "5108", name: "Site Welfare (Food & Petty Cash)", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", costCategory: "MATERIAL" },
  { code: "5109", name: "Printing & Engineering (Project)", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", costCategory: "MATERIAL" },
  { code: "5110", name: "Site Office Supplies", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", costCategory: "MATERIAL" },
  { code: "5112", name: "Project Salaries & Wages", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", controlAccountType: "PROJECT_SALARY_EXPENSE", costCategory: "LABOR" },
  { code: "5150", name: "Inventory Adjustment Gain/Loss", subClassCode: "COST_OF_SALES", isPostable: true, normalBalance: "DEBIT", controlAccountType: "INVENTORY_ADJUSTMENT" },
  { code: "5200", name: "Salaries & Wages", subClassCode: "OPERATING_EXPENSE", isPostable: true, normalBalance: "DEBIT", controlAccountType: "SALARY_EXPENSE", costCategory: "LABOR" },
  { code: "5210", name: "Rent Expense", subClassCode: "OPERATING_EXPENSE", isPostable: true, normalBalance: "DEBIT" },
  { code: "5250", name: "GOSI Expense", subClassCode: "OPERATING_EXPENSE", isPostable: true, normalBalance: "DEBIT", controlAccountType: "GOSI_EXPENSE", costCategory: "LABOR" },
  { code: "5260", name: "End-of-Service Benefits Expense", subClassCode: "OPERATING_EXPENSE", isPostable: true, normalBalance: "DEBIT", controlAccountType: "EOSB_EXPENSE", costCategory: "LABOR" },
  { code: "5270", name: "Leave Expense", subClassCode: "OPERATING_EXPENSE", isPostable: true, normalBalance: "DEBIT", controlAccountType: "LEAVE_EXPENSE", costCategory: "LABOR" },
  { code: "5215", name: "Employee Allowances Expense", subClassCode: "OPERATING_EXPENSE", isPostable: true, normalBalance: "DEBIT", controlAccountType: "ALLOWANCE_EXPENSE", costCategory: "LABOR" },
  { code: "5216", name: "Employee Food Expense", subClassCode: "OPERATING_EXPENSE", isPostable: true, normalBalance: "DEBIT", controlAccountType: "FOOD_EXPENSE", costCategory: "LABOR" },
  { code: "5220", name: "Utilities Expense", subClassCode: "OPERATING_EXPENSE", isPostable: true, normalBalance: "DEBIT" },
  { code: "5230", name: "Depreciation Expense", subClassCode: "OPERATING_EXPENSE", isPostable: true, normalBalance: "DEBIT", controlAccountType: "DEPRECIATION_EXPENSE" },
  { code: "5240", name: "Office & Administrative Expense", subClassCode: "OPERATING_EXPENSE", isPostable: true, normalBalance: "DEBIT" },
  { code: "5800", name: "Finance Costs", subClassCode: "FINANCE_COST", isPostable: true, normalBalance: "DEBIT" },
  { code: "5850", name: "Foreign Exchange Gain/Loss", subClassCode: "FINANCE_COST", isPostable: true, normalBalance: "DEBIT" },
  { code: "5900", name: "Tax Expense", subClassCode: "TAX_EXPENSE", isPostable: true, normalBalance: "DEBIT" },
];
