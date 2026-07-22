-- Finance-phase DB constraints + backfill for pre-existing companies.
-- Applied as a Prisma migration via the create-only + paste pattern
-- (same as gl-constraints.sql). Idempotent where it touches data.

-- ── CHECK constraints ────────────────────────────────────────────────────

-- A payment allocation targets exactly one invoice (sales XOR purchase)
-- and must be a positive amount.
ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_target_xor_check"
  CHECK (("salesInvoiceId" IS NULL) <> ("purchaseInvoiceId" IS NULL));

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "payment_allocations_amount_positive_check"
  CHECK ("allocatedAmount" > 0);

-- Invoice settlement fields can never go negative, and totals are non-negative.
ALTER TABLE "sales_invoices"
  ADD CONSTRAINT "sales_invoices_settlement_check"
  CHECK ("paidAmount" >= 0 AND "openAmount" >= 0 AND "netTotal" >= 0 AND "vatTotal" >= 0 AND "grossTotal" >= 0);

ALTER TABLE "purchase_invoices"
  ADD CONSTRAINT "purchase_invoices_settlement_check"
  CHECK ("paidAmount" >= 0 AND "openAmount" >= 0 AND "netTotal" >= 0 AND "vatTotal" >= 0 AND "grossTotal" >= 0);

-- Payment amounts: positive amount, allocation split always sums to amount.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check"
  CHECK ("amount" > 0 AND "allocatedAmount" >= 0 AND "unallocatedAmount" >= 0
         AND "allocatedAmount" + "unallocatedAmount" = "amount");

-- ── Backfill for companies created before this phase ─────────────────────

-- 1. Flag each company's existing 2200 (VAT Payable) as the VAT_OUTPUT
--    control account.
UPDATE "accounts"
SET "controlAccountType" = 'VAT_OUTPUT'
WHERE "code" = '2200' AND "controlAccountType" IS NULL;

-- 2. Insert 1150 "VAT Receivable (Input VAT)" per company where missing.
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '1150', 'VAT Receivable (Input VAT)',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'ASSET'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'CURRENT_ASSET'),
  (SELECT a."id" FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '1000'),
  true, 'DEBIT', 'VAT_INPUT', true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '1150'
);

-- 3. Insert 5850 "Foreign Exchange Gain/Loss" per company where missing.
INSERT INTO "accounts" (
  "id", "companyId", "code", "name", "accountClassId", "accountSubClassId",
  "parentAccountId", "isPostable", "normalBalance", "controlAccountType",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), c."id", '5850', 'Foreign Exchange Gain/Loss',
  (SELECT "id" FROM "account_classes" WHERE "code" = 'EXPENSE'),
  (SELECT "id" FROM "account_sub_classes" WHERE "code" = 'FINANCE_COST'),
  NULL,
  true, 'DEBIT', NULL, true, now(), now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."companyId" = c."id" AND a."code" = '5850'
);

-- 4. Insert the five new numbering series per company where missing.
INSERT INTO "numbering_series" ("id", "companyId", "documentType", "prefix", "nextNumber", "numberLength", "fiscalYearId", "isActive")
SELECT gen_random_uuid(), c."id", dt."documentType"::"DocumentType", dt."prefix", 1, 6, NULL, true
FROM "companies" c
CROSS JOIN (VALUES
  ('SALES_INVOICE', 'INV-'),
  ('CREDIT_NOTE', 'CN-'),
  ('PURCHASE_INVOICE', 'PINV-'),
  ('INCOMING_PAYMENT', 'RCT-'),
  ('OUTGOING_PAYMENT', 'PAY-')
) AS dt("documentType", "prefix")
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" ns
  WHERE ns."companyId" = c."id"
    AND ns."documentType" = dt."documentType"::"DocumentType"
    AND ns."fiscalYearId" IS NULL
);
