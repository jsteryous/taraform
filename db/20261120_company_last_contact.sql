-- A company's last contact includes its people's notes (2026-11-20).
--
-- Notes are written on people ("with Anthony Gallo"), so a company's own last_note_at
-- stayed null after you'd met half its staff, and the Dashboard's visit-day card called
-- it "never contacted". Meeting someone at a company is contacting the company.
--
-- For a company, last_note_at / last_note_by now mean the latest note on the company
-- itself OR on any person linked to it (contact_links). note_count stays the company's
-- own: it counts call attempts for the follow-up cadence, and follow-ups live on people
-- now (the app no longer queues or schedules companies), so it is not the company's
-- business how often its people were called.
--
-- Kept current from both directions: a note added/edited/deleted on a person refreshes
-- every company they're linked to, and a link added or removed refreshes that company.
-- Neither path touches updated_at (see CLAUDE.md: it is upsertContact's version).

begin;

create or replace function public.company_last_contact_refresh(p_company bigint)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.property_crm_contacts c
     set (last_note_at, last_note_by) = (
           select n.created_at, n.author_id
             from public.contact_notes n
            where n.contact_id = p_company
               or n.contact_id in (select l.person_id from public.contact_links l where l.company_id = p_company)
            order by n.created_at desc, n.id desc
            limit 1)
   where c.id = p_company and c.kind = 'company';
$$;

revoke all on function public.company_last_contact_refresh(bigint) from public, anon, authenticated;

-- CREATE OR REPLACE keeps the existing grants (none to anon/authenticated).
create or replace function public.contact_notes_rollup()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_contact bigint := coalesce(new.contact_id, old.contact_id);
        v_company bigint;
begin
  update public.property_crm_contacts c
     set note_count   = (select count(*) from public.contact_notes n where n.contact_id = v_contact),
         last_note_at = (select max(n.created_at) from public.contact_notes n where n.contact_id = v_contact),
         last_note_by = (select n.author_id from public.contact_notes n where n.contact_id = v_contact
                          order by n.created_at desc, n.id desc limit 1)
   where c.id = v_contact;
  -- A company: widen to its people. A person: refresh every company they're at.
  perform public.company_last_contact_refresh(v_contact);
  for v_company in select l.company_id from public.contact_links l where l.person_id = v_contact loop
    perform public.company_last_contact_refresh(v_company);
  end loop;
  return null;
end;
$$;

create function public.contact_links_last_contact()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.company_last_contact_refresh(new.company_id); end if;
  if tg_op in ('DELETE', 'UPDATE') and old.company_id is distinct from new.company_id then
    perform public.company_last_contact_refresh(old.company_id);
  end if;
  return null;
end;
$$;

revoke all on function public.contact_links_last_contact() from public, anon, authenticated;

create trigger contact_links_last_contact
  after insert or update or delete on public.contact_links
  for each row execute function public.contact_links_last_contact();

-- Backfill every company.
select public.company_last_contact_refresh(c.id)
  from public.property_crm_contacts c where c.kind = 'company';

commit;
