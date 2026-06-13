-- 20260613_bad_phones.sql
-- Let a user mark a phone number as "no good" (wrong/disconnected) without
-- deleting it — the number still shows, struck through, so it isn't re-dialed
-- or re-entered as a fresh lead.
--
-- Design: a sibling jsonb column rather than restructuring `phones`.
--   `phones` is a jsonb array of plain strings reused by search + the has/missing
--   filters via JSON containment (phones.cs.["value"]), by ImportModal,
--   AddContactModal, ContactCard, etc. Turning it into [{number,bad}] objects
--   would ripple through all of that and every existing row. Instead `bad_phones`
--   holds the NORMALIZED digits (normalizePhone) of each flagged number; the UI
--   strikes a phone when normalizePhone(phone) is in bad_phones. Storing digits
--   (not the formatted string) keeps the flag stable if the number is reformatted.
--
-- jsonb (not text[]) to match the other array-ish columns on this table; default
-- '[]' so existing rows + mapDbContact's `|| []` agree.

BEGIN;

ALTER TABLE property_crm_contacts
  ADD COLUMN IF NOT EXISTS bad_phones jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;

-- Rollback:
--   ALTER TABLE property_crm_contacts DROP COLUMN IF EXISTS bad_phones;
