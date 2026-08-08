-- Split into its own migration: Postgres forbids using a newly-added enum
-- value in the same transaction that adds it, and prisma migrate deploy
-- wraps each migration.sql in one transaction. The next migration's
-- numbering_series backfill needs SALES_QUOTATION/SALES_ORDER already
-- committed, hence this file exists purely to add the enum values first.
ALTER TYPE "DocumentType" ADD VALUE 'SALES_QUOTATION';
ALTER TYPE "DocumentType" ADD VALUE 'SALES_ORDER';
