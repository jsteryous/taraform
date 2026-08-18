-- 20260818_clear_stopped_lead_dates.sql
-- Retire scheduled calls on leads that have stopped.
--
-- WHY: the cadence writes follow_up_on on every logged call, so a contact called and then
-- marked Dead/Pass kept a live-looking date in its follow-up field. applyContactFilters
-- already hid those from the queue via followUp.excludeStatuses, so nothing surfaced
-- wrongly — but the contact still READ as if it were on the cadence, with no way to tell
-- a retired date from a real appointment. The app now clears it on the status change
-- (clearOnStatusChange in src/lib/followUpCadence.js); this catches up the rows that
-- already got into that state.
--
-- Offer Rejected/NFS joins Dead/Pass and Closed in excludeStatuses in the same change. It
-- had been missing, which was a genuine hole: unlike the other two it was NOT excluded
-- from the queue, so an NFS contact with a scheduled date would have surfaced as a call.
--
-- SCOPE: only the stop statuses. Offer Made is deliberately NOT included — an offer out is
-- an active deal and its follow-up date is a real appointment (5 such rows, left alone).
--
-- updated_at is bumped for the same reason as the backfill: upsertContact asserts it as a
-- concurrency precondition, so a stale tab must fail loudly rather than overwrite silently.

BEGIN;

UPDATE property_crm_contacts
   SET follow_up_on = NULL, updated_at = now()
 WHERE follow_up_on IS NOT NULL
   AND status IN ('Dead/Pass', 'Closed', 'Offer Rejected/NFS',  -- land preset
                  'Dead', 'Converted',                          -- generic preset
                  'Inactive');                                  -- restaurant preset

COMMIT;

-- Verify (expect 0):
--   SELECT count(*) FROM property_crm_contacts WHERE follow_up_on IS NOT NULL
--    AND status IN ('Dead/Pass','Closed','Offer Rejected/NFS','Dead','Converted','Inactive');
--
-- Rollback — the full set this cleared, captured 2026-08-18 before the update:
--   UPDATE property_crm_contacts AS p SET follow_up_on = v.d
--     FROM (VALUES
--       (1775240891706, DATE '2026-08-22'),  -- Tamil Perry            Dead/Pass
--       (1775240891708, DATE '2026-08-22'),  -- Siedah Tate            Dead/Pass
--       (1775839988892, DATE '2026-08-22'),  -- William Joseph Merrell Dead/Pass
--       (1775839988918, DATE '2026-07-05'),  -- Konstantinos Holevas   Dead/Pass
--       (1775839988965, DATE '2026-08-25'),  -- Sanchez Torres         Offer Rejected/NFS
--       (1775839989110, DATE '2026-10-22')   -- Eva Sorley             Offer Rejected/NFS
--     ) AS v(id, d) WHERE p.id = v.id;
