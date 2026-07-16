-- 20260716_note_activity.sql
-- Dashboard activity tracking: count notes logged per period.
--
-- Why an RPC: notes live inside the activity_log jsonb array on each contact, and
--   PostgREST can't unnest jsonb — so "how many notes were written since <date>" isn't
--   expressible through query params. This function returns one row per note entry
--   (contact_id + timestamp) since p_since; the client buckets them into today/7d/30d
--   (src/lib/activityStats.js summarizeNoteActivity).
--
-- The note predicate + timestamp handling replicate compute_last_note_at
--   (db/20260713_filter_columns.sql) exactly: an entry is a note when type = 'note',
--   or it's untyped-with-text (legacy). Keep the three in sync: this function,
--   compute_last_note_at, and matchesNoteActivity (src/lib/contactFilters.js).
--
-- SECURITY INVOKER (the default): the inner select runs under the caller's RLS,
--   so members only count notes on their own clients' contacts and anon gets zero rows.
--   The last_note_at >= p_since prefilter rides the idx_pcc_client_last_note_at index
--   so we only unnest contacts that actually have a recent note.

BEGIN;

CREATE OR REPLACE FUNCTION note_activity(p_client_id uuid, p_since timestamptz)
RETURNS TABLE (contact_id bigint, note_at timestamptz)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT c.id, (coalesce(e->>'timestamp', e->>'createdAt'))::timestamptz
  FROM public.property_crm_contacts c,
       jsonb_array_elements(
         CASE WHEN jsonb_typeof(c.activity_log) = 'array' THEN c.activity_log ELSE '[]'::jsonb END
       ) AS e
  WHERE c.client_id = p_client_id
    AND c.last_note_at >= p_since
    AND (
      e->>'type' = 'note'
      OR ((e->>'type' IS NULL OR e->>'type' = '') AND coalesce(e->>'text', '') <> '')
    )
    -- Guard the cast: only ISO-8601-ish strings (what the app writes via toISOString()).
    AND coalesce(e->>'timestamp', e->>'createdAt') ~ '^\d{4}-\d{2}-\d{2}T'
    AND (coalesce(e->>'timestamp', e->>'createdAt'))::timestamptz >= p_since;
$$;

COMMIT;

-- Rollback:
--   DROP FUNCTION IF EXISTS note_activity(uuid, timestamptz);
