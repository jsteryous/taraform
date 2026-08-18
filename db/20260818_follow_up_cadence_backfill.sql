-- 20260818_follow_up_cadence_backfill.sql
-- One-time catch-up for the call cadence added in src/lib/followUpCadence.js.
--
-- WHY THIS EXISTS
-- The app now writes follow_up_on every time a note (= a call) is logged: attempt 1 today,
-- then +3, +4, +7, +16, +30, then every 60 days. That only fires on the NEXT call, so
-- contacts already called once would have sat with no scheduled date, falling back to the
-- 90-day stale-note rule — which is the thing being replaced. Before this ran, the
-- follow-up queue for "Personal List" returned exactly 0 contacts: 495 had been called,
-- the oldest note was 69 days old, and the rule waits 90. The queue had never once fired.
--
-- SCOPE: contacts that have been called at least once, have no follow_up_on already, and
-- sit in a status the cadence schedules from. Everything else is left alone — a contact
-- with a hand-set date keeps it, an uncalled contact has no attempt to count from, and an
-- Offer Made / UC / Dead contact isn't on a call clock.
--
-- THIS IS NOT A SECOND IMPLEMENTATION. The gap table below is inlined for a single
-- backfill; the live cadence is src/lib/followUpCadence.js and nothing reads this file
-- again. If you change the cadence, change it there — do not "keep this in sync".
--
-- TIMEZONE: last_note_at is timestamptz, follow_up_on is a plain date meaning the
-- operator's local day. A call logged at 9pm ET is 01:00 UTC the next day, so the cast
-- goes through America/New_York rather than the session timezone.
--
-- updated_at IS BUMPED ON PURPOSE. upsertContact asserts the last-read updated_at as an
-- optimistic-concurrency precondition (see CLAUDE.md); leaving it stale would let a
-- browser tab that loaded these rows before the backfill overwrite the new dates without
-- noticing. Bumping it makes that a loud ContactConflictError instead. Reload any open
-- tab after running this.

BEGIN;

-- Exact-undo snapshot. This database has no backup at all (see the Tier 0 item in
-- CLAUDE.md), and a blanket "clear follow_up_on" rollback would also destroy hand-set
-- dates, so record the prior value of every row this touches. RLS is enabled with no
-- policies: PostgREST is public here (the anon key ships in the bundle), and a table with
-- RLS on and no policy returns zero rows to anon and authenticated alike.
CREATE TABLE IF NOT EXISTS follow_up_cadence_backfill_20260818 (
  id           bigint PRIMARY KEY,
  follow_up_on date,
  updated_at   timestamptz
);
ALTER TABLE follow_up_cadence_backfill_20260818 ENABLE ROW LEVEL SECURITY;

WITH
-- Statuses the cadence schedules from, per client, mirroring clientConfig.js cadence.statuses.
-- A client with no config->>'type' falls back to the land preset, same as resolveConfig().
cadence_status AS (
  SELECT c.id AS client_id, s.status
    FROM clients c
    CROSS JOIN LATERAL unnest(
      CASE coalesce(c.config->>'type', 'land')
        WHEN 'generic'    THEN ARRAY['New Lead', 'Contacted', 'Interested']
        WHEN 'restaurant' THEN ARRAY[]::text[]
        ELSE                   ARRAY['New Lead', 'Contacted', 'Hot Lead']
      END
    ) AS s(status)
),
target AS (
  SELECT p.id,
         -- Attempts so far. Same predicate as compute_last_note_at (db/20260713) and
         -- isNoteEntry in contactFilters.js: status_change and offer entries are an audit
         -- trail, not calls.
         (SELECT count(*)
            FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(p.activity_log) = 'array'
                        THEN p.activity_log ELSE '[]'::jsonb END) AS e
           WHERE e->>'type' = 'note'
              OR ((e->>'type' IS NULL OR e->>'type' = '') AND coalesce(e->>'text', '') <> '')
         ) AS attempts,
         (p.last_note_at AT TIME ZONE 'America/New_York')::date AS last_call_on
    FROM property_crm_contacts p
    JOIN cadence_status cs ON cs.client_id = p.client_id AND cs.status = p.status
   WHERE p.follow_up_on IS NULL
     AND p.last_note_at IS NOT NULL
)
, snapshot AS (
  INSERT INTO follow_up_cadence_backfill_20260818 (id, follow_up_on, updated_at)
  SELECT p.id, p.follow_up_on, p.updated_at
    FROM property_crm_contacts p JOIN target t ON t.id = p.id
   WHERE t.attempts >= 1
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
UPDATE property_crm_contacts p
   SET follow_up_on = t.last_call_on + (CASE t.attempts
         WHEN 1 THEN 3    -- day 0  -> day 3
         WHEN 2 THEN 4    -- day 3  -> day 7
         WHEN 3 THEN 7    -- day 7  -> day 14
         WHEN 4 THEN 16   -- day 14 -> day 30
         WHEN 5 THEN 30   -- day 30 -> day 60
         ELSE 60          -- attempt 6+: every 60 days, forever
       END),
       updated_at = now()
  FROM target t
 WHERE p.id = t.id
   AND t.attempts >= 1;

COMMIT;

-- Verify (expected on 2026-08-18: 262 scheduled for Personal List, 252 of them already due):
--   SELECT c.name,
--          count(*) FILTER (WHERE p.follow_up_on <= current_date) AS due_now,
--          count(*) FILTER (WHERE p.follow_up_on >  current_date) AS scheduled_ahead
--     FROM property_crm_contacts p JOIN clients c ON c.id = p.client_id
--    WHERE p.follow_up_on IS NOT NULL GROUP BY c.name ORDER BY 2 DESC;
--
-- Rollback (exact — restores the prior value row by row, hand-set dates included):
--   UPDATE property_crm_contacts p
--      SET follow_up_on = b.follow_up_on, updated_at = b.updated_at
--     FROM follow_up_cadence_backfill_20260818 b WHERE b.id = p.id;
--   DROP TABLE follow_up_cadence_backfill_20260818;
--
-- Drop the snapshot table once the new cadence has been worked for a week or two and
-- nobody wants it back.
