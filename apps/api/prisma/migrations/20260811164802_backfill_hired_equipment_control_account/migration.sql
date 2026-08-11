-- Backfill: existing companies' 5102 "Machinery & Equipment Rental (Project)"
-- account was seeded before HIRED_EQUIPMENT_EXPENSE existed as a control
-- account type. New companies get it directly from default-coa.ts; this
-- catches everyone provisioned before this migration. Only touches rows
-- that don't already have some other control account type set, so a company
-- that repurposed 5102 for something else is left alone.
UPDATE "accounts"
SET "controlAccountType" = 'HIRED_EQUIPMENT_EXPENSE'
WHERE "code" = '5102' AND "controlAccountType" IS NULL;
