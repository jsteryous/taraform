-- Familiarity: three levels, not four. "Know" is gone.
--
-- Haven't met / Met / Know well. In practice "Met" and "Know" meant the same thing, so the
-- 16 rows at "Know" become "Met", and Met takes over Know's weight everywhere:
--   * warmth: anyone on the team having met them makes the contact warm (was Know+)
--   * intro:  a connection or colleague anyone has met is a way in (was Know+)
--   * common: shared groups only (Met used to land here)
-- familiarity_level keeps its numbers (1 = met, 3 = know well); 2 simply no longer occurs,
-- so the list filter and every stored value stay valid.
--
-- The UPDATE goes through contact_familiarity_stamp, which keeps user_id/contact_id/
-- client_id on update, and contact_familiarity_rollup, which recomputes familiarity_level.
-- contact_ways_in keeps its name, argument and return type, so CREATE OR REPLACE keeps the
-- grants; restated anyway, and checked after applying (CLAUDE.md).

begin;

update public.contact_familiarity set level = 'met' where level = 'know';

alter table public.contact_familiarity drop constraint contact_familiarity_level_check;
alter table public.contact_familiarity
  add constraint contact_familiarity_level_check check (level in ('met', 'know_well'));

create or replace function public.contact_familiarity_rollup()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare v_contact bigint := coalesce(new.contact_id, old.contact_id);
begin
  update public.property_crm_contacts c
     set familiarity_level = coalesce((
           select max(case f.level when 'know_well' then 3 when 'met' then 1 else 0 end)
             from public.contact_familiarity f where f.contact_id = v_contact), 0)
   where c.id = v_contact;
  if tg_op = 'UPDATE' and old.contact_id is distinct from new.contact_id then
    update public.property_crm_contacts c
       set familiarity_level = coalesce((
             select max(case f.level when 'know_well' then 3 when 'met' then 1 else 0 end)
               from public.contact_familiarity f where f.contact_id = old.contact_id), 0)
     where c.id = old.contact_id;
  end if;
  return null;
end;
$$;

revoke all on function public.contact_familiarity_rollup() from public, anon, authenticated;

create or replace function public.contact_ways_in(p_contact_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  with
  fam as (
    select f.user_id, f.level, f.updated_at
      from public.contact_familiarity f
     where f.contact_id = p_contact_id
  ),
  conn as (
    select cc.id,
           case when cc.a_id = p_contact_id then cc.b_id else cc.a_id end as other_id,
           cc.description, cc.referred_by, cc.unsure, cc.source_note_id,
           cc.created_by, cc.created_at
      from public.contact_connections cc
     where cc.a_id = p_contact_id or cc.b_id = p_contact_id
  ),
  conn_full as (
    select c.*, o.first_name, o.last_name, n.body as note_body,
           k.known_by, coalesce(k.best, 0) as best
      from conn c
      join public.property_crm_contacts o on o.id = c.other_id
      left join public.contact_notes n on n.id = c.source_note_id
      left join lateral (
        select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'level', f.level)
                         order by case f.level when 'know_well' then 3 else 1 end desc, f.user_id) as known_by,
               max(case f.level when 'know_well' then 3 else 1 end) as best
          from public.contact_familiarity f
         where f.contact_id = c.other_id
      ) k on true
  ),
  -- People linked to a company this person is linked to. Derived, never stored: working
  -- at the same place is a path, not a connection (PLAN.md, "What not to infer"), and a
  -- link removed from the company page drops out here with nothing to clean up. Anyone
  -- already joined by a real connection shows there instead.
  coll as (
    select distinct on (o.id)
           o.id as other_id, o.first_name, o.last_name,
           co.id as company_id, co.first_name as company_name, l2.title
      from public.contact_links l1
      join public.contact_links l2 on l2.company_id = l1.company_id and l2.person_id <> l1.person_id
      join public.property_crm_contacts o  on o.id  = l2.person_id
      join public.property_crm_contacts co on co.id = l1.company_id
     where l1.person_id = p_contact_id
       and not exists (select 1 from conn c where c.other_id = o.id)
     order by o.id, l2.created_at
  ),
  coll_full as (
    select c.*, k.known_by, coalesce(k.best, 0) as best
      from coll c
      left join lateral (
        select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'level', f.level)
                         order by case f.level when 'know_well' then 3 else 1 end desc, f.user_id) as known_by,
               max(case f.level when 'know_well' then 3 else 1 end) as best
          from public.contact_familiarity f
         where f.contact_id = c.other_id
      ) k on true
  ),
  grp as (
    select g.id, g.name, g.kind, m.source_note_id
      from public.contact_group_members m
      join public.contact_groups g on g.id = m.group_id
     where m.contact_id = p_contact_id
  ),
  grp_full as (
    select g.*,
           coalesce((select jsonb_agg(t.user_id order by t.created_at)
                       from public.contact_group_members t
                      where t.group_id = g.id and t.user_id is not null), '[]'::jsonb) as teammates,
           coalesce((select jsonb_agg(jsonb_build_object(
                              'contact_id', o.id, 'first_name', o.first_name,
                              'last_name', o.last_name, 'known_by', k.known_by)
                            order by o.last_name, o.first_name)
                       from public.contact_group_members cm
                       join public.property_crm_contacts o on o.id = cm.contact_id
                       join lateral (
                         select jsonb_agg(jsonb_build_object('user_id', f.user_id, 'level', f.level)
                                          order by case f.level when 'know_well' then 3 else 1 end desc) as known_by
                           from public.contact_familiarity f
                          where f.contact_id = o.id and f.level in ('met', 'know_well')
                       ) k on k.known_by is not null
                      where cm.group_id = g.id and cm.contact_id <> p_contact_id), '[]'::jsonb) as known_contacts
      from grp g
  )
  select jsonb_build_object(
    'warmth', case
      when exists (select 1 from fam) then 'warm'
      when exists (select 1 from conn_full where best >= 1)
        or exists (select 1 from coll_full where best >= 1) then 'intro'
      when exists (select 1 from grp_full
                    where teammates <> '[]'::jsonb or known_contacts <> '[]'::jsonb) then 'common'
      else 'cold' end,
    'familiarity', coalesce((select jsonb_agg(jsonb_build_object(
                     'user_id', user_id, 'level', level, 'updated_at', updated_at)
                     order by case level when 'know_well' then 3 else 1 end desc, updated_at) from fam), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object(
                     'id', id, 'contact_id', other_id, 'first_name', first_name,
                     'last_name', last_name, 'description', description,
                     'referred_by', referred_by, 'unsure', unsure,
                     'source_note_id', source_note_id, 'note_body', note_body,
                     'created_by', created_by, 'created_at', created_at,
                     'known_by', coalesce(known_by, '[]'::jsonb))
                     order by best desc, unsure, created_at) from conn_full), '[]'::jsonb),
    'colleagues', coalesce((select jsonb_agg(jsonb_build_object(
                    'contact_id', other_id, 'first_name', first_name, 'last_name', last_name,
                    'company_id', company_id, 'company_name', company_name, 'title', title,
                    'known_by', coalesce(known_by, '[]'::jsonb))
                    order by best desc, last_name, first_name) from coll_full), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
                'id', id, 'name', name, 'kind', kind, 'source_note_id', source_note_id,
                'teammates', teammates, 'known_contacts', known_contacts)
                order by jsonb_array_length(teammates) + jsonb_array_length(known_contacts) desc, name)
                from grp_full), '[]'::jsonb)
  )
  where exists (select 1 from public.property_crm_contacts c where c.id = p_contact_id);
$$;

revoke all on function public.contact_ways_in(bigint) from public, anon;
grant execute on function public.contact_ways_in(bigint) to authenticated;

commit;
