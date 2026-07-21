-- 20260721_verified_phones.sql
-- Let a user mark a phone number as "verified" (confirmed working) — the opposite
-- of bad_phones (db/20260613_bad_phones.sql). Replaces the SMS quick-action button
-- in the contact card's phone row, since SMS is no longer a Taraform feature
-- (Railway/Twilio decommissioned 2026-06-10).
--
-- Same design as bad_phones: a sibling jsonb column holding NORMALIZED digits
-- (normalizePhone) of each flagged number, rather than restructuring `phones`
-- into objects. A number is verified when normalizePhone(phone) is in
-- verified_phones. The two sets are mutually exclusive at the app layer
-- (marking one clears the other for that number) but nothing here enforces
-- that in SQL — same as bad_phones.

BEGIN;

ALTER TABLE property_crm_contacts
  ADD COLUMN IF NOT EXISTS verified_phones jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;

-- Rollback:
--   ALTER TABLE property_crm_contacts DROP COLUMN IF EXISTS verified_phones;
