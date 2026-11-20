-- The team's warmest familiarity on each contact, as a column the list can filter on.
--
-- contact_familiarity holds one row per teammate per contact. The list is paged and
-- filtered server-side (applyContactFilters), so "show me the people we know well" has
-- to be a predicate on property_crm_contacts itself. Same shape as note_count: a
-- SECURITY DEFINER rollup trigger keeps it in step, and the app never writes it
-- (absent from mapContactToDb). It deliberately does NOT touch updated_at — that is the
-- version upsertContact asserts, and a teammate marking "Know" must not make every open
-- editor of that contact conflict.
--
--   0 = nobody on the team has met them, 1 = met, 2 = know, 3 = know well

begin;

alter table public.property_crm_contacts
  add column familiarity_level smallint not null default 0;

create function public.contact_familiarity_rollup()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_contact bigint := coalesce(new.contact_id, old.contact_id);
begin
  update public.property_crm_contacts c
     set familiarity_level = coalesce((
           select max(case f.level when 'know_well' then 3 when 'know' then 2 when 'met' then 1 else 0 end)
             from public.contact_familiarity f where f.contact_id = v_contact), 0)
   where c.id = v_contact;
  -- A level that moved from one contact to another (not possible through the grants, but
  -- cheap to be right about) recomputes the old one too.
  if tg_op = 'UPDATE' and old.contact_id is distinct from new.contact_id then
    update public.property_crm_contacts c
       set familiarity_level = coalesce((
             select max(case f.level when 'know_well' then 3 when 'know' then 2 when 'met' then 1 else 0 end)
               from public.contact_familiarity f where f.contact_id = old.contact_id), 0)
     where c.id = old.contact_id;
  end if;
  return null;
end;
$$;

revoke all on function public.contact_familiarity_rollup() from public, anon, authenticated;

create trigger contact_familiarity_rollup
  after insert or update or delete on public.contact_familiarity
  for each row execute function public.contact_familiarity_rollup();

-- Start from the table.
update public.property_crm_contacts c
   set familiarity_level = x.lvl
  from (select contact_id,
               max(case level when 'know_well' then 3 when 'know' then 2 when 'met' then 1 else 0 end) lvl
          from public.contact_familiarity group by contact_id) x
 where x.contact_id = c.id;

commit;
