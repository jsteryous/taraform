-- Close the cross-tenant INSERT hole on property_crm_contacts.
--
-- The table carried TWO permissive ALL policies, and Postgres ORs permissive
-- policies together:
--
--   1. "client members can access contacts"  -- client_id IN (my memberships)
--   2. "Users see only their contacts"       -- auth.uid() = user_id   <-- legacy
--
-- Policy 2 predates multi-tenancy. Its WITH CHECK is satisfied by ANY client_id
-- so long as user_id = auth.uid(), so any authenticated user could INSERT rows
-- into ANY client's list. Proven 2026-08-06 by role simulation (rolled back):
-- as the TRP owner against Personal List --
--   readable rows   = 0          (read isolation held)
--   update/delete   = blocked    (only their own just-inserted row)
--   INSERT          = ALLOWED    <-- the hole
--
-- Reachable from the internet: the anon key ships in the public bundle and the
-- client UUIDs are published in this public repo (CLAUDE.md, and
-- db/20260804_trp_live_deals_to_personal_list.sql).
--
-- Not a leak -- nobody could read or alter existing rows. A pollution vector.

begin;

-- 1. Adopt the pre-multi-tenancy orphans BEFORE dropping policy 2.
--
--    14 rows carry client_id IS NULL and are visible ONLY through the legacy
--    policy; dropping it first would make them invisible to everyone. They all
--    belong to the same owner account, created 2026-03-07..10, and are plainly
--    early test data: every one is status 'New Lead' with zero phones and zero
--    offers, including one named "Test Save" and a duplicated "Egerdahl Llc".
--
--    Adopted into Personal List rather than deleted -- there is currently no
--    backup to undo a delete with. To remove them later:
--      delete from property_crm_contacts where id in (
--        1772903272967, 1772903334672, 1772903376954, 1772903481820,
--        1773102199757, 1773103804861, 1773104703010, 1773104866124,
--        1773104947428, 1773104957895, 1773105014842, 1773105097142,
--        1773140645626, 1773140832827);
update property_crm_contacts
   set client_id = 'df98b2a7-741b-48bf-9715-53b897b7cfa7'  -- Personal List
 where client_id is null;

-- 2. Drop the legacy policy. Membership is now the single access rule.
drop policy if exists "Users see only their contacts" on property_crm_contacts;

-- 3. Make a tenant-less row unwritable. Both insert paths already set client_id
--    (src/lib/utils.js mapContactToDb, src/components/modals/ImportModal.jsx),
--    so this turns a silently-orphaned row into a loud failure.
alter table property_crm_contacts alter column client_id set not null;
alter table contact_offers        alter column client_id set not null;

commit;
