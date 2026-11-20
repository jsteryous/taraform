-- Company address + server-side geocoding (2026-11-20). Design: PLAN.md "Call days".
--
-- The address is the record; coordinates are derived from it and never typed. A company
-- gets one `address` line. `geo_*` columns are owned by the server:
--
--   * A trigger clears the coordinates and marks the row 'pending' whenever the address
--     changes, so a pin can never sit at an old address — whatever wrote the address
--     (the app, an import, a script, the table editor).
--   * The same trigger puts back any geo_* value a client tries to write. Only
--     geocode_record() may set them, and it says so with a transaction-local flag.
--   * pg_cron runs geocode_dispatch() every 10 minutes; it calls the `geocode-run` Edge
--     Function only when something is pending, and that function asks the US Census
--     geocoder (free, results may be stored) and writes back through geocode_record().
--
-- None of this touches updated_at: it is the version upsertContact asserts (see CLAUDE.md),
-- and a geocode finishing must not make an open editor of the company conflict.
--
-- geo_status: null (no address) | 'pending' | 'found' | 'not_found'.

begin;

alter table public.property_crm_contacts
  add column address     text,
  add column geo_lat     double precision,
  add column geo_lng     double precision,
  add column geo_status  text check (geo_status in ('pending', 'found', 'not_found')),
  add column geo_matched text,         -- the address as the geocoder understood it
  add column geo_at      timestamptz;  -- when the current geo_status was decided

create index property_crm_contacts_geo_pending_idx
  on public.property_crm_contacts (id) where geo_status = 'pending';

create function public.contact_geo_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  -- geocode_record() sets this for its own UPDATE only.
  if current_setting('taraform.geocoding', true) = 'on' then
    return new;
  end if;

  new.address := nullif(btrim(new.address), '');

  if tg_op = 'INSERT' or new.address is distinct from old.address then
    new.geo_lat := null; new.geo_lng := null; new.geo_matched := null; new.geo_at := null;
    new.geo_status := case when new.address is null then null else 'pending' end;
  else
    new.geo_lat := old.geo_lat; new.geo_lng := old.geo_lng; new.geo_matched := old.geo_matched;
    new.geo_at := old.geo_at; new.geo_status := old.geo_status;
  end if;
  return new;
end;
$$;

create trigger contact_geo_guard
  before insert or update on public.property_crm_contacts
  for each row execute function public.contact_geo_guard();

-- ── Service side (the Edge Function) ────────────────────────────────────────────

-- Oldest-first batch of addresses waiting for coordinates.
create function public.geocode_pending(p_limit int default 40)
returns table (id bigint, address text)
language sql security definer set search_path to ''
as $$
  select c.id, c.address
  from public.property_crm_contacts c
  where c.geo_status = 'pending'
  order by c.id
  limit greatest(1, least(p_limit, 200));
$$;

-- Writes one result. Applies only if the address is still the one that was looked up, so
-- an edit made while the lookup was in flight wins and stays pending for the next run.
create function public.geocode_record(
  p_id bigint, p_address text, p_lat double precision, p_lng double precision, p_matched text
)
returns boolean
language plpgsql security definer set search_path to ''
as $$
declare
  v_n int;
begin
  perform set_config('taraform.geocoding', 'on', true);
  update public.property_crm_contacts c
     set geo_lat     = p_lat,
         geo_lng     = p_lng,
         geo_matched = case when p_lat is null then null else p_matched end,
         geo_status  = case when p_lat is null then 'not_found' else 'found' end,
         geo_at      = now()
   where c.id = p_id and c.address = p_address and c.geo_status = 'pending';
  get diagnostics v_n = row_count;
  perform set_config('taraform.geocoding', 'off', true);
  return v_n > 0;
end;
$$;

-- pg_cron entry point. Makes no HTTP call when nothing is pending, so running it every
-- 10 minutes costs nothing on a quiet day. Reuses the service key the phone sync already
-- keeps in Vault (db/20260804_phone_sync_cron.sql).
create function public.geocode_dispatch()
returns boolean
language plpgsql security definer set search_path to ''
as $$
declare
  v_key text;
begin
  if not exists (select 1 from public.property_crm_contacts where geo_status = 'pending') then
    return false;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'phone_sync_service_key';
  if v_key is null then
    raise exception 'phone_sync_service_key missing from vault — see db/20260804_phone_sync_cron.sql';
  end if;
  perform net.http_post(
    url     := 'https://ykuenmwfxecmmqichwit.supabase.co/functions/v1/geocode-run',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  return true;
end;
$$;

-- service_role only. geocode_record takes any id: granted to `authenticated` it would let
-- anyone move any workspace's pins. Restate on every DROP + CREATE (see CLAUDE.md).
revoke all on function public.geocode_pending(int) from public, anon, authenticated;
revoke all on function public.geocode_record(bigint, text, double precision, double precision, text) from public, anon, authenticated;
revoke all on function public.geocode_dispatch() from public, anon, authenticated;
grant execute on function public.geocode_pending(int) to service_role;
grant execute on function public.geocode_record(bigint, text, double precision, double precision, text) to service_role;
grant execute on function public.geocode_dispatch() to service_role;

select cron.schedule('geocode-pending', '*/10 * * * *', 'select public.geocode_dispatch()');

commit;
