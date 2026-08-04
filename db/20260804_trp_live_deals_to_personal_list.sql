-- 2026-08-04 — One-off DATA backfill (no schema change). ALREADY APPLIED to prod.
--
-- Copied Table Rock Partners' live deals into "Personal List" so the user can work them
-- from the list they actually use (see the active-client-list convention). Copies, NOT
-- moves: the TRP originals are untouched, so these parcels now exist in both lists.
--
-- Scope: status in ('Offer Made','UC') — 31 in TRP, of which 2 were skipped because a
-- Personal List row already existed at the same county + tax_map_id (Linda Boles,
-- Aiken 289-00-03-021; Andrea Black, Lexington 009900-01-173). Net: 29 contacts, 30 offers.
--
-- Decisions baked in:
--   * Status carried over verbatim, so the list reads "Offer Made" / "UC" at a glance.
--   * contact_offers rows copied too, so the Offers tab shows the amount + offer status.
--     Side effect: Personal List's dashboard "lifetime offers written" now includes these.
--   * follow_up_on staggered ~10/day across Aug 5-7 (UC first, then Offer Made by
--     descending amount). A manual follow_up_on always wins over status in isFollowUpDue,
--     which matters here: 'Offer Made'/'UC' are NOT in followUp.statuses, so without a date
--     these would never surface in the queue.
--   * Dedup key is county + tax_map_ids containment (tax map IDs are unique per county,
--     not globally — see src/lib/CLAUDE.md).
--   * No provenance key in custom_fields: ContactDetail renders unknown custom_fields keys
--     as ad-hoc inputs, so a marker would show as visible junk. The offer copy instead
--     joins new->source on county + parcel, verified unique across the 29 beforehand.
--
-- Note: TRP has zero contacts at status 'Hot Lead' (and no follow_up_on values), so the
-- "hot leads" half of the original request had an empty source set.

with live as (
  select p.* from property_crm_contacts p
  where p.client_id='f3a69c31-8e40-4ea0-865a-d8bd9214376d' and p.status in ('Offer Made','UC')
    and not exists (
      select 1 from property_crm_contacts pl
      where pl.client_id='df98b2a7-741b-48bf-9715-53b897b7cfa7'
        and pl.county is not distinct from p.county
        and pl.tax_map_ids ?| (select coalesce(array_agg(x #>> '{}'),'{}') from jsonb_array_elements(p.tax_map_ids) x))
),
ranked as (
  select l.*, (row_number() over (
    order by (l.status='UC') desc,
      (select max(nullif(regexp_replace(o.amount,'[^0-9.]','','g'),'')::numeric) from contact_offers o where o.contact_id=l.id) desc nulls last
  ) - 1)::int rn
  from live l
),
ins as (
  -- id omitted on purpose: DB-owned sequence (db/20260613_id_defaults.sql).
  insert into property_crm_contacts
    (client_id, user_id, first_name, last_name, phones, email, county, owner_address,
     property_addresses, tax_map_ids, acreage, status, notes, activity_log,
     lead_source, contact_method, custom_fields, bad_phones, verified_phones, follow_up_on)
  select 'df98b2a7-741b-48bf-9715-53b897b7cfa7', r.user_id, r.first_name, r.last_name, r.phones,
     r.email, r.county, r.owner_address, r.property_addresses, r.tax_map_ids, r.acreage,
     r.status, r.notes, r.activity_log, r.lead_source, r.contact_method, r.custom_fields,
     r.bad_phones, r.verified_phones, current_date + 1 + (r.rn/10)
  from ranked r
  returning id, county, tax_map_ids
)
insert into contact_offers (contact_id, client_id, amount, status, notes, created_at)
select ins.id, 'df98b2a7-741b-48bf-9715-53b897b7cfa7', o.amount, o.status, o.notes, o.created_at
from ins
join ranked r on r.county is not distinct from ins.county and r.tax_map_ids->>0 = ins.tax_map_ids->>0
join contact_offers o on o.contact_id = r.id;

-- Rollback (the insert landed on a contiguous id range; offers first, no cascade):
--   delete from contact_offers
--    where contact_id between 1775839989228 and 1775839989256;
--   delete from property_crm_contacts
--    where client_id='df98b2a7-741b-48bf-9715-53b897b7cfa7'
--      and id between 1775839989228 and 1775839989256;
