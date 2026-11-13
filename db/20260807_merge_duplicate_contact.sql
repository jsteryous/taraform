-- 2026-08-07 — Merge two cards for one owner in Personal List.
--
-- REDACTED COPY. This repo is public, so the owners' names, phone numbers, parcel ids,
-- addresses and deal figures that the applied statement carried are replaced with
-- placeholders below. The contact ids and the reasoning are unchanged. This file records
-- what was done and why; it is not re-runnable as written.
--
-- Found while auditing phone-number collisions after a lead looked un-noted. Six numbers
-- in Personal List were shared across 8 cards; on inspection only this pair was one
-- person. The rest are distinct owners whose skip-traced numbers happen to overlap
-- (adjacent parcels, family landlines) and were LEFT ALONE:
--
--   - two owners of adjacent parcels with mailing addresses in different states, sharing
--     three numbers;
--   - two relatives with parcels in different counties, sharing one number that is in
--     one of their verified_phones;
--   - two cards on the same parcel (the same tax map id written with and without
--     punctuation) where the operator's own note says which person the shared number
--     belongs to. Left as two cards by explicit decision.
--
-- The merged pair is one owner holding two parcels in the same county. The schema already
-- models that (tax_map_ids is a jsonb array), so the two cards collapse into one.
--
--   survivor 1775240891697  (the smaller parcel)
--   absorbed 1775240891696  (the larger parcel)
--
-- Neither card had contact_offers rows, and contact_offers is the only FK to
-- property_crm_contacts, so the delete cascades to nothing.
--
-- has_good_phone / last_note_at / phones_digits are GENERATED ALWAYS — never set them.
-- updated_at IS set explicitly: no trigger maintains it, and upsertContact's
-- optimistic-concurrency guard asserts the last-read value (see CLAUDE.md).

begin;

with b as (
  select owner_address, activity_log
  from property_crm_contacts
  where id = 1775240891696
),
merged as (
  update property_crm_contacts a
     set tax_map_ids = '["<survivor parcel id>","<absorbed parcel id>"]'::jsonb,
         phones      = '["<the union of both cards'' phones, 4 numbers>"]'::jsonb,
         -- The absorbed card's owner_address is the second parcel's address;
         -- owner_address holds only one string, so park it here rather than lose it.
         property_addresses = jsonb_build_array(b.owner_address),
         -- keep the real note, drop the survivor's auto-generated acreage note
         activity_log = b.activity_log,
         acreage = '<sum of the two parcels>',
         updated_at = now()
    from b
   where a.id = 1775240891697
  returning a.id
)
delete from property_crm_contacts where id = 1775240891696;

commit;
