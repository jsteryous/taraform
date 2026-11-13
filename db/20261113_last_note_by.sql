-- Whose follow-up is it? (2026-11-13)
--
-- The follow-up queue was one list per workspace, which is right for a workspace with one
-- member and wrong for a shared one: every teammate saw every teammate's calls. The queue
-- and the dashboard are now per person, and "mine" needs a definition the server can
-- filter on.
--
-- A note is a call, and logging one is what schedules the next (lib/followUpCadence.js),
-- so the follow-up belongs to whoever wrote the contact's latest note. last_note_by is
-- that author, rolled up by the same trigger that maintains note_count and last_note_at.
-- A contact nobody has noted yet falls back to user_id (the last person to save it, i.e.
-- whoever set the date or the status) — that fallback lives in applyContactFilters.
--
-- Not a security boundary: every member can still read and edit every contact. It only
-- routes a contact into one person's queue. Additive, safe under the previous app build.

begin;

alter table public.property_crm_contacts
  add column last_note_by uuid references auth.users(id) on delete set null;

-- CREATE OR REPLACE, not drop + create: keeps the existing grants (see CLAUDE.md, "Recreating
-- a SECURITY DEFINER function drops its REVOKEs"). Still does not touch updated_at.
create or replace function public.contact_notes_rollup()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_contact bigint := coalesce(new.contact_id, old.contact_id);
begin
  update public.property_crm_contacts c
     set note_count   = (select count(*) from public.contact_notes n where n.contact_id = v_contact),
         last_note_at = (select max(n.created_at) from public.contact_notes n where n.contact_id = v_contact),
         last_note_by = (select n.author_id from public.contact_notes n where n.contact_id = v_contact
                          order by n.created_at desc, n.id desc limit 1)
   where c.id = v_contact;
  return null;
end;
$$;

update public.property_crm_contacts c
   set last_note_by = (select n.author_id from public.contact_notes n where n.contact_id = c.id
                        order by n.created_at desc, n.id desc limit 1)
 where c.note_count > 0;

commit;
