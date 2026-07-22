-- Fixes prevent_posted_journal_entry_mutation() to deny-by-default: the only
-- permitted mutation of a Posted journal entry is the status transition to
-- REVERSED. The original version only guarded a few named "core" fields
-- (postingDate/currencyCode/companyId) and missed others (e.g. memo),
-- letting same-status field tampering through. Caught by the e2e test
-- "posts a balanced entry ... and makes it immutable".
CREATE OR REPLACE FUNCTION prevent_posted_journal_entry_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'POSTED' AND NEW."status" IS DISTINCT FROM 'REVERSED' THEN
    RAISE EXCEPTION 'Posted journal entries are immutable except for reversal (entry %)', OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;