-- 20260713_filter_columns.sql
-- Move phone-quality and note-recency filtering server-side.
--
-- Why: "has phone" and the note-activity filter can't be expressed through PostgREST's
--   generic query params (jsonb element comparison; normalized-phone membership; "age of
--   most recent note"). We had been filtering these in JS after the fetch, which made the
--   result count / pagination / CSV export drift from the actual filter. These two STORED
--   generated columns make both predicates first-class + indexable, so applyContactFilters
--   filters them at the DB — one source of truth, accurate counts. Mirrors the existing
--   phones_digits generated column (db/20260622_phone_search.sql).
--
-- The functions replicate the JS exactly so the client-side drift re-check
-- (contactMatchesFilters) agrees with the server on a fresh load:
--   * has_good_phone: a contact "has a phone" iff some number isn't struck through.
--     bad_phones stores normalizePhone() = last 10 digits; a phone is good when its last
--     10 digits aren't in bad_phones. (src/lib/utils.js normalizePhone, contactFilters.js
--     hasGoodPhone.)
--   * last_note_at: max timestamp among activity_log entries that are notes — type 'note',
--     or untyped-with-text (legacy). (contactFilters.js matchesNoteActivity.)
--
-- jsonb_typeof guards keep the one-time table rewrite from failing on any non-array row.

BEGIN;

CREATE OR REPLACE FUNCTION compute_has_good_phone(phones jsonb, bad_phones jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(phones) = 'array' THEN phones ELSE '[]'::jsonb END
    ) AS p
    WHERE right(regexp_replace(p, '[^0-9]', '', 'g'), 10) <> ''
      AND NOT (
        CASE WHEN jsonb_typeof(bad_phones) = 'array' THEN bad_phones ELSE '[]'::jsonb END
        ? right(regexp_replace(p, '[^0-9]', '', 'g'), 10)
      )
  );
$$;

CREATE OR REPLACE FUNCTION compute_last_note_at(activity_log jsonb)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT max((coalesce(e->>'timestamp', e->>'createdAt'))::timestamptz)
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(activity_log) = 'array' THEN activity_log ELSE '[]'::jsonb END
  ) AS e
  WHERE (
      e->>'type' = 'note'
      OR ((e->>'type' IS NULL OR e->>'type' = '') AND coalesce(e->>'text', '') <> '')
    )
    -- Guard the cast: only ISO-8601-ish strings (what the app writes via toISOString()).
    AND coalesce(e->>'timestamp', e->>'createdAt') ~ '^\d{4}-\d{2}-\d{2}T';
$$;

ALTER TABLE property_crm_contacts
  ADD COLUMN IF NOT EXISTS has_good_phone boolean
    GENERATED ALWAYS AS (compute_has_good_phone(phones, bad_phones)) STORED,
  ADD COLUMN IF NOT EXISTS last_note_at timestamptz
    GENERATED ALWAYS AS (compute_last_note_at(activity_log)) STORED;

CREATE INDEX IF NOT EXISTS idx_pcc_client_has_good_phone
  ON property_crm_contacts (client_id, has_good_phone);
CREATE INDEX IF NOT EXISTS idx_pcc_client_last_note_at
  ON property_crm_contacts (client_id, last_note_at);

COMMIT;

-- Rollback:
--   DROP INDEX IF EXISTS idx_pcc_client_last_note_at;
--   DROP INDEX IF EXISTS idx_pcc_client_has_good_phone;
--   ALTER TABLE property_crm_contacts DROP COLUMN IF EXISTS last_note_at;
--   ALTER TABLE property_crm_contacts DROP COLUMN IF EXISTS has_good_phone;
--   DROP FUNCTION IF EXISTS compute_last_note_at(jsonb);
--   DROP FUNCTION IF EXISTS compute_has_good_phone(jsonb, jsonb);
