-- 20260724_follow_up.sql
-- Manual follow-up date for the follow-up queue.
--
-- "Due for follow-up" is derived at read time (applyContactFilters in
-- src/lib/contactFilters.js): due when follow_up_on has arrived, or — with no manual
-- date set — when the contact sits in an auto-eligible status (client config, default
-- 'Contacted') with no note in the last N days (default 90, via the last_note_at
-- generated column from db/20260713_filter_columns.sql). The predicate depends on
-- now(), so it can't be a STORED generated column; it lives in the query instead.
-- No queue table, no scheduled job, nothing to keep in sync.
--
-- `date` (not timestamptz) on purpose: the user picks a day ("call them March 3rd"),
-- and "due" means "today or earlier" with no timezone off-by-one at midnight.
--
-- Clearing rules live in the app (ContactDetail): logging a note while the date is
-- today-or-past clears it; a future date survives interim notes.

BEGIN;

ALTER TABLE property_crm_contacts
  ADD COLUMN IF NOT EXISTS follow_up_on date;

-- Partial: most rows never get a manual date, so keep the index tiny.
CREATE INDEX IF NOT EXISTS idx_pcc_client_follow_up_on
  ON property_crm_contacts (client_id, follow_up_on)
  WHERE follow_up_on IS NOT NULL;

COMMIT;

-- Rollback:
--   DROP INDEX IF EXISTS idx_pcc_client_follow_up_on;
--   ALTER TABLE property_crm_contacts DROP COLUMN IF EXISTS follow_up_on;
