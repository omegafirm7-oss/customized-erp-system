-- Backfill numbering series for the new purchasing-cycle document types
-- (Purchase Quotation / Purchase Order) for every existing company, same
-- idempotent pattern as every prior DocumentType addition in this project.
INSERT INTO "numbering_series" ("id", "companyId", "documentType", "prefix", "nextNumber", "numberLength", "fiscalYearId", "isActive")
SELECT gen_random_uuid(), c."id", dt."documentType"::"DocumentType", dt."prefix", 1, 6, NULL, true
FROM "companies" c
CROSS JOIN (VALUES
  ('PURCHASE_QUOTATION', 'PQ-'),
  ('PURCHASE_ORDER', 'PO-')
) AS dt("documentType", "prefix")
WHERE NOT EXISTS (
  SELECT 1 FROM "numbering_series" ns
  WHERE ns."companyId" = c."id" AND ns."documentType" = dt."documentType"::"DocumentType" AND ns."fiscalYearId" IS NULL
);
