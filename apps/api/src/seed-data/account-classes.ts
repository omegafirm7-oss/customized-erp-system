import { AccountClassCode, Ifrs18Category } from "@prisma/client";

export const ACCOUNT_CLASSES: Array<{ code: AccountClassCode; name: string }> = [
  { code: "ASSET", name: "Assets" },
  { code: "LIABILITY", name: "Liabilities" },
  { code: "EQUITY", name: "Equity" },
  { code: "REVENUE", name: "Revenue" },
  { code: "EXPENSE", name: "Expenses" },
];

export const ACCOUNT_SUB_CLASSES: Array<{
  code: string;
  name: string;
  classCode: AccountClassCode;
  isCurrent?: boolean;
  ifrs18Category?: Ifrs18Category;
  sortOrder: number;
}> = [
  { code: "CURRENT_ASSET", name: "Current Assets", classCode: "ASSET", isCurrent: true, sortOrder: 1 },
  { code: "NON_CURRENT_ASSET", name: "Non-Current Assets", classCode: "ASSET", isCurrent: false, sortOrder: 2 },
  { code: "CURRENT_LIABILITY", name: "Current Liabilities", classCode: "LIABILITY", isCurrent: true, sortOrder: 1 },
  {
    code: "NON_CURRENT_LIABILITY",
    name: "Non-Current Liabilities",
    classCode: "LIABILITY",
    isCurrent: false,
    sortOrder: 2,
  },
  { code: "SHARE_CAPITAL", name: "Share Capital", classCode: "EQUITY", sortOrder: 1 },
  { code: "RETAINED_EARNINGS", name: "Retained Earnings", classCode: "EQUITY", sortOrder: 2 },
  { code: "RESERVES", name: "Reserves", classCode: "EQUITY", sortOrder: 3 },
  { code: "OPERATING_REVENUE", name: "Operating Revenue", classCode: "REVENUE", ifrs18Category: "OPERATING", sortOrder: 1 },
  { code: "OTHER_INCOME", name: "Other Income", classCode: "REVENUE", ifrs18Category: "OPERATING", sortOrder: 2 },
  {
    code: "INVESTING_INCOME",
    name: "Investing Income",
    classCode: "REVENUE",
    ifrs18Category: "INVESTING",
    sortOrder: 3,
  },
  { code: "COST_OF_SALES", name: "Cost of Sales", classCode: "EXPENSE", ifrs18Category: "OPERATING", sortOrder: 1 },
  {
    code: "OPERATING_EXPENSE",
    name: "Operating Expenses",
    classCode: "EXPENSE",
    ifrs18Category: "OPERATING",
    sortOrder: 2,
  },
  { code: "FINANCE_COST", name: "Finance Costs", classCode: "EXPENSE", ifrs18Category: "FINANCING", sortOrder: 3 },
  { code: "TAX_EXPENSE", name: "Tax Expense", classCode: "EXPENSE", ifrs18Category: "INCOME_TAX", sortOrder: 4 },
];
