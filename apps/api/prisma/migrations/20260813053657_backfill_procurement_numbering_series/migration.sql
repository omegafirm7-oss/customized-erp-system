-- Backfill NumberingSeries rows for the two new document types
-- (PURCHASE_REQUISITION, GOODS_RECEIPT) for every existing company —
-- company-provisioning only seeds series at creation time, so companies
-- created before this feature need this data-only backfill.
INSERT INTO "numbering_series" ("id", "companyId", "documentType", "prefix", "nextNumber", "numberLength", "fiscalYearId", "isActive")
SELECT gen_random_uuid(), c."id", 'PURCHASE_REQUISITION', 'PR-', 1, 6, NULL, true
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" ns
  WHERE ns."companyId" = c."id" AND ns."documentType" = 'PURCHASE_REQUISITION' AND ns."fiscalYearId" IS NULL
);

INSERT INTO "numbering_series" ("id", "companyId", "documentType", "prefix", "nextNumber", "numberLength", "fiscalYearId", "isActive")
SELECT gen_random_uuid(), c."id", 'GOODS_RECEIPT', 'GRN-', 1, 6, NULL, true
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" ns
  WHERE ns."companyId" = c."id" AND ns."documentType" = 'GOODS_RECEIPT' AND ns."fiscalYearId" IS NULL
);
