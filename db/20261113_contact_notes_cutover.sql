-- Notes cutover (2026-11-13). Phase 2 of 2.
--
-- ORDER MATTERS: apply only once the app build that reads and writes contact_notes is
-- live. The previous build writes notes into activity_log and relies on last_note_at being
-- generated from it; this migration ends both.
--
-- After this, last_note_at and note_count on property_crm_contacts are maintained by a
-- trigger on contact_notes. That makes two triggers' worth of derived state in the schema
-- where there used to be a generated column, so: neither column is written by the app, and
-- the trigger deliberately does NOT touch updated_at. updated_at is the optimistic-
-- concurrency version the client asserts on save (see upsertContact); bumping it here
-- would make a teammate's note invalidate every open editor of that contact.

begin;

-- Catch notes written by the old build between phase 1 and the deploy.
insert into public.contact_notes (client_id, contact_id, author_id, body, created_at, legacy_id)
select c.client_id, c.id,
       (select cu.user_id from public.client_users cu
         where cu.client_id = c.client_id and cu.role = 'owner'
         order by cu.created_at limit 1),
       e->>'text',
       (coalesce(e->>'timestamp', e->>'createdAt'))::timestamptz,
       e->>'id'
from public.property_crm_contacts c,
     jsonb_array_elements(
       case when jsonb_typeof(c.activity_log) = 'array' then c.activity_log else '[]'::jsonb end
     ) as e
where (e->>'type' = 'note' or ((e->>'type' is null or e->>'type' = '') and coalesce(e->>'text', '') <> ''))
  and btrim(coalesce(e->>'text', '')) <> ''
  and coalesce(e->>'timestamp', e->>'createdAt') ~ '^\d{4}-\d{2}-\d{2}T'
on conflict (contact_id, legacy_id) do nothing;

-- last_note_at stops being generated from activity_log and becomes a plain column. The
-- index on (client_id, last_note_at) and every filter that reads it are unaffected.
alter table public.property_crm_contacts alter column last_note_at drop expression;

-- SECURITY DEFINER because it writes two columns on a row the note's author may be in the
-- middle of losing access to (a cascade from deleting the contact or the workspace), and
-- because it must not depend on the caller's RLS view to count correctly. It takes no
-- arguments and trusts nothing from the caller: both values are recomputed from the table.
create function public.contact_notes_rollup()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_contact bigint := coalesce(new.contact_id, old.contact_id);
begin
  update public.property_crm_contacts c
     set note_count   = (select count(*) from public.contact_notes n where n.contact_id = v_contact),
         last_note_at = (select max(n.created_at) from public.contact_notes n where n.contact_id = v_contact)
   where c.id = v_contact;
  return null;
end;
$$;

revoke all on function public.contact_notes_rollup() from public, anon, authenticated;

create trigger contact_notes_rollup
  after insert or delete on public.contact_notes
  for each row execute function public.contact_notes_rollup();

-- Recompute everything once, so the columns start from the table rather than from
-- whatever activity_log last said.
update public.property_crm_contacts c
   set note_count   = coalesce(n.cnt, 0),
       last_note_at = n.last_at
  from (select p.id, x.cnt, x.last_at
          from public.property_crm_contacts p
          left join (select contact_id, count(*)::int cnt, max(created_at) last_at
                       from public.contact_notes group by contact_id) x on x.contact_id = p.id) n
 where n.id = c.id
   and (c.note_count is distinct from coalesce(n.cnt, 0) or c.last_note_at is distinct from n.last_at);

-- The dashboard's activity card. Same signature, so CREATE OR REPLACE keeps its grants.
-- Still SECURITY INVOKER: RLS on contact_notes decides what the caller may count.
create or replace function public.note_activity(p_client_id uuid, p_since timestamptz)
returns table(contact_id bigint, note_at timestamptz)
language sql
stable
set search_path to ''
as $$
  select n.contact_id, n.created_at
    from public.contact_notes n
   where n.client_id = p_client_id
     and n.created_at >= p_since;
$$;

drop function public.compute_last_note_at(jsonb);

commit;
