-- Manual follow-up migration (apply as a second Prisma migration after the
-- initial schema migration exists — see README "Database setup" section):
--
--   pnpm --filter @erp/api exec prisma migrate dev --create-only --name add_gl_constraints
--   (paste this file's contents into the generated migration.sql)
--   pnpm --filter @erp/api exec prisma migrate dev
--
-- These are DB-level defense-in-depth constraints backing the application-layer
-- checks in gl-posting.service.ts. Not expressible directly in schema.prisma.

-- A journal entry line cannot be both a debit and a credit, and amounts cannot
-- be negative (a reversal is a new line with debit/credit swapped, never a
-- negative amount).
ALTER TABLE "journal_entry_lines"
  ADD CONSTRAINT "journal_entry_lines_debit_credit_check"
  CHECK (
    "debit" >= 0 AND "credit" >= 0
    AND NOT ("debit" > 0 AND "credit" > 0)
  );

-- Once a journal entry is Posted, it becomes immutable at the DB level too.
-- The ONLY permitted mutation is the status transition POSTED -> REVERSED
-- (which is all gl-posting.service.ts's reverseEntry() ever does to the
-- original entry) — any other change to any field, including a same-status
-- update, is rejected. This protects against direct DB access bypassing the
-- API; an earlier version of this trigger only guarded a few named "core"
-- fields (postingDate/currencyCode/companyId) and missed others like memo —
-- fixed to deny-by-default instead of enumerating an incomplete allowlist.
CREATE OR REPLACE FUNCTION prevent_posted_journal_entry_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'POSTED' AND NEW."status" IS DISTINCT FROM 'REVERSED' THEN
    RAISE EXCEPTION 'Posted journal entries are immutable except for reversal (entry %)', OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_posted_journal_entry_mutation
  BEFORE UPDATE ON "journal_entries"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_posted_journal_entry_mutation();

-- Posted journal entry lines cannot be deleted or altered directly either;
-- only whole-entry reversal is allowed. Deletes of lines belonging to a
-- Posted entry are blocked (Draft entries can still have their lines edited
-- freely by the application).
CREATE OR REPLACE FUNCTION prevent_posted_journal_entry_line_mutation()
RETURNS TRIGGER AS $$
DECLARE
  entry_status "JournalEntryStatus";
BEGIN
  SELECT "status" INTO entry_status FROM "journal_entries" WHERE "id" = COALESCE(OLD."journalEntryId", NEW."journalEntryId");

  IF entry_status = 'POSTED' THEN
    RAISE EXCEPTION 'Cannot modify lines of a posted journal entry (entry %)', COALESCE(OLD."journalEntryId", NEW."journalEntryId");
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_posted_journal_entry_line_update
  BEFORE UPDATE OR DELETE ON "journal_entry_lines"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_posted_journal_entry_line_mutation();
