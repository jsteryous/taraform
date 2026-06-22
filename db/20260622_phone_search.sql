-- 20260622_phone_search.sql
-- Make phone search format-agnostic.
--
-- Problem: `phones` is a jsonb array of FORMATTED strings ("(864) 555-1234" —
--   ImportModal + ContactDetail both run input through formatPhone before saving).
--   The list search matched it with exact JSON containment (phones.cs.["value"]),
--   so a number was only found when typed character-for-character including the
--   parens. Hyphens / no-hyphens / digits-only all missed.
--
-- Fix: a STORED generated column holding the digit-only form of every number in
--   the array, separated by spaces so a partial ilike can't match ACROSS two
--   different numbers (query is digits-only, the column keeps a gap between
--   numbers). e.g. ["(864) 555-1234","(803) 111-2222"] -> " 8645551234 8031112222 ".
--   The app then searches phones_digits.ilike.%<digits>% — any format the user
--   types (or the last 4 digits) finds the contact.
--
-- Generated + STORED: auto-populates every existing row and stays in sync on
--   write, so no backfill and no app-side save changes. regexp_replace is
--   immutable, which a generated column requires.
--
-- Trigram GIN index so the leading-wildcard ilike stays index-backed as the table
--   grows (pg_trgm ships with Supabase).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE property_crm_contacts
  ADD COLUMN IF NOT EXISTS phones_digits text
  GENERATED ALWAYS AS (regexp_replace((phones)::text, '[^0-9]+', ' ', 'g')) STORED;

CREATE INDEX IF NOT EXISTS idx_property_crm_contacts_phones_digits
  ON property_crm_contacts USING gin (phones_digits gin_trgm_ops);

COMMIT;

-- Rollback:
--   DROP INDEX IF EXISTS idx_property_crm_contacts_phones_digits;
--   ALTER TABLE property_crm_contacts DROP COLUMN IF EXISTS phones_digits;
