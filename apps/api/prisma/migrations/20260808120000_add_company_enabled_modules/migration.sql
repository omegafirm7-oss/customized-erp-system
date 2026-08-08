-- Per-client module entitlement: which premium modules (purchase/crm/sales)
-- a company is allowed to use. Platform admins bypass this check entirely.
ALTER TABLE "companies" ADD COLUMN "enabledModules" TEXT[] NOT NULL DEFAULT '{}';

-- Grandfather every existing company into "purchase" — it's already live in
-- production for Red Dune/DEMOCO and must not disappear. "crm"/"sales" stay
-- off by default; the platform admin turns them on per client explicitly.
UPDATE "companies" SET "enabledModules" = ARRAY['purchase'];
