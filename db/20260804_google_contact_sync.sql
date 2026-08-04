-- 2026-08-04 — Multi-user phone caller ID.
--
-- Turns the single-operator sync (scripts/phone-sync.mjs, one refresh token in repo
-- secrets) into a self-serve feature: each user connects their own Google account and a
-- nightly job syncs the contacts THEY can see into THEIR address book.
--
-- Design: scripts/PHONE_SYNC_MULTIUSER.md
--
-- Threat model for this file:
--   * A user's Google refresh token must never be readable by the browser — not even by
--     the user who owns it. They don't need it back; only the sync does.
--   * The Edge Function runs as service_role, which BYPASSES RLS. So the per-user contact
--     scoping cannot live in TypeScript — it lives in phone_sync_contacts_for() below,
--     which does the client_users join itself. That function is the only contact read the
--     sync is permitted to make.

-- ── Vault (encrypted at rest, so a DB dump doesn't leak Google tokens) ──────────
create extension if not exists supabase_vault with schema vault;

-- ── The connection table ───────────────────────────────────────────────────────
create table if not exists public.google_contact_sync (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  google_email    text        not null,
  -- Points into vault.secrets. The token itself is NEVER a column here.
  token_secret_id uuid        not null,
  -- Ordered client ids: earlier wins when the same owner appears in two lists
  -- (dedupeByPhone in src/lib/phoneSync.js). Must be stable between runs or the winner
  -- flips nightly and churns create/delete pairs.
  client_priority uuid[]      not null default '{}',
  enabled         boolean     not null default true,
  last_synced_at  timestamptz,
  last_error      text,
  last_stats      jsonb,
  created_at      timestamptz not null default now()
);

-- RLS on with ZERO policies: `authenticated` and `anon` get nothing, ever. All access is
-- through the SECURITY DEFINER functions below, which decide exactly which columns leave
-- the database. This is deliberate — do not add a "users can view their own row" policy,
-- because that would expose token_secret_id.
alter table public.google_contact_sync enable row level security;
revoke all on public.google_contact_sync from anon, authenticated;

-- ── What the UI is allowed to see about its own connection ─────────────────────
create or replace function public.get_my_contact_sync()
returns table (
  google_email text, enabled boolean,
  last_synced_at timestamptz, last_error text, last_stats jsonb
)
language sql security definer set search_path = public
as $$
  select g.google_email, g.enabled, g.last_synced_at, g.last_error, g.last_stats
  from public.google_contact_sync g
  where g.user_id = auth.uid();
$$;

-- Pause/resume without disconnecting (the token stays; the nightly job skips them).
create or replace function public.set_my_contact_sync_enabled(p_enabled boolean)
returns void
language sql security definer set search_path = public
as $$
  update public.google_contact_sync
  set enabled = p_enabled
  where user_id = auth.uid();
$$;

-- Reorder which list wins on a cross-list duplicate. Silently ignores ids the caller
-- isn't a member of, so it can't be used to probe for other tenants' client ids.
create or replace function public.set_my_contact_sync_priority(p_order uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.google_contact_sync g
  set client_priority = coalesce((
    select array_agg(o.id order by o.ord)
    from unnest(p_order) with ordinality as o(id, ord)
    where o.id in (select cu.client_id from public.client_users cu where cu.user_id = auth.uid())
  ), '{}')
  where g.user_id = auth.uid();
end;
$$;

-- ── Sync-side functions: service_role only ─────────────────────────────────────
-- Called by the Edge Function after a successful OAuth code exchange. Rotating an existing
-- connection replaces the vault secret in place rather than orphaning it.
create or replace function public.phone_sync_store_token(
  p_user uuid, p_email text, p_refresh_token text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_existing uuid;
  v_secret   uuid;
begin
  if p_user is null or coalesce(btrim(p_refresh_token), '') = '' then
    raise exception 'user and refresh token are required';
  end if;

  select token_secret_id into v_existing
  from public.google_contact_sync where user_id = p_user;

  if v_existing is not null then
    perform vault.update_secret(v_existing, p_refresh_token);
    v_secret := v_existing;
  else
    v_secret := vault.create_secret(
      p_refresh_token,
      'google_contacts_refresh_' || p_user::text,
      'Google Contacts refresh token for Taraform phone sync'
    );
  end if;

  insert into public.google_contact_sync (user_id, google_email, token_secret_id, client_priority)
  values (
    p_user, p_email, v_secret,
    -- Default priority: every list they belong to, oldest membership first. Stable, and
    -- reorderable later via set_my_contact_sync_priority().
    coalesce((select array_agg(cu.client_id order by cu.created_at)
              from public.client_users cu where cu.user_id = p_user), '{}')
  )
  on conflict (user_id) do update
    set google_email    = excluded.google_email,
        token_secret_id = excluded.token_secret_id,
        enabled         = true,
        last_error      = null;
end;
$$;

create or replace function public.phone_sync_read_token(p_user uuid)
returns text
language sql security definer set search_path = public
as $$
  select s.decrypted_secret
  from public.google_contact_sync g
  join vault.decrypted_secrets s on s.id = g.token_secret_id
  where g.user_id = p_user;
$$;

-- Disconnect. The Edge Function revokes the grant at Google BEFORE calling this —
-- dropping our copy alone would leave a live grant dangling on Google's side.
create or replace function public.phone_sync_forget(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_secret uuid;
begin
  select token_secret_id into v_secret
  from public.google_contact_sync where user_id = p_user;
  delete from public.google_contact_sync where user_id = p_user;
  if v_secret is not null then
    delete from vault.secrets where id = v_secret;
  end if;
end;
$$;

-- Fan-out list for pg_cron: one Edge Function invocation per connected user, rather than
-- one invocation looping over everyone (an Edge Function has a wall-clock cap, and a first
-- run of ~1,300 contacts is a dozen sequential People API round-trips).
create or replace function public.phone_sync_pending_users()
returns table (user_id uuid)
language sql security definer set search_path = public
as $$
  select g.user_id from public.google_contact_sync g where g.enabled;
$$;

-- THE tenancy boundary. The Edge Function bypasses RLS, so this function — not the
-- TypeScript — decides which contacts a given user may sync. Mirrors the membership rule
-- in db/20260610_clients_rls.sql. Any change here is a potential cross-tenant leak;
-- src/lib/rls.proof.test.js covers it.
create or replace function public.phone_sync_contacts_for(p_user uuid)
returns table (
  id bigint, client_id uuid, first_name text, last_name text,
  phones jsonb, bad_phones jsonb, county text, status text,
  tax_map_ids jsonb, acreage numeric
)
language sql security definer set search_path = public
as $$
  select c.id, c.client_id, c.first_name, c.last_name,
         c.phones, c.bad_phones, c.county, c.status,
         c.tax_map_ids, c.acreage
  from public.property_crm_contacts c
  where c.has_good_phone
    and c.client_id in (
      select cu.client_id from public.client_users cu where cu.user_id = p_user
    )
  order by c.id;
$$;

-- Client names for the organization field, scoped the same way.
create or replace function public.phone_sync_clients_for(p_user uuid)
returns table (id uuid, name text, priority int)
language sql security definer set search_path = public
as $$
  select cl.id, cl.name,
         coalesce(array_position(g.client_priority, cl.id), 2147483647) as priority
  from public.clients cl
  join public.client_users cu on cu.client_id = cl.id and cu.user_id = p_user
  left join public.google_contact_sync g on g.user_id = p_user
  order by priority, cl.name;
$$;

create or replace function public.phone_sync_record_result(
  p_user uuid, p_error text, p_stats jsonb
)
returns void
language sql security definer set search_path = public
as $$
  update public.google_contact_sync
  set last_error     = p_error,
      last_stats     = coalesce(p_stats, last_stats),
      last_synced_at = case when p_error is null then now() else last_synced_at end
  where user_id = p_user;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────────
-- User-facing: signed-in users only, and each is scoped to auth.uid() internally.
revoke all on function public.get_my_contact_sync() from public, anon;
revoke all on function public.set_my_contact_sync_enabled(boolean) from public, anon;
revoke all on function public.set_my_contact_sync_priority(uuid[]) from public, anon;
grant execute on function public.get_my_contact_sync() to authenticated;
grant execute on function public.set_my_contact_sync_enabled(boolean) to authenticated;
grant execute on function public.set_my_contact_sync_priority(uuid[]) to authenticated;

-- Sync-side: service_role ONLY. These take a user id as a parameter rather than reading
-- auth.uid(), so exposing any of them to `authenticated` would let any signed-in user read
-- any other user's contacts or Google token. They must never be granted to authenticated.
revoke all on function public.phone_sync_store_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.phone_sync_read_token(uuid) from public, anon, authenticated;
revoke all on function public.phone_sync_forget(uuid) from public, anon, authenticated;
revoke all on function public.phone_sync_pending_users() from public, anon, authenticated;
revoke all on function public.phone_sync_contacts_for(uuid) from public, anon, authenticated;
revoke all on function public.phone_sync_clients_for(uuid) from public, anon, authenticated;
revoke all on function public.phone_sync_record_result(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.phone_sync_store_token(uuid, text, text) to service_role;
grant execute on function public.phone_sync_read_token(uuid) to service_role;
grant execute on function public.phone_sync_forget(uuid) to service_role;
grant execute on function public.phone_sync_pending_users() to service_role;
grant execute on function public.phone_sync_contacts_for(uuid) to service_role;
grant execute on function public.phone_sync_clients_for(uuid) to service_role;
grant execute on function public.phone_sync_record_result(uuid, text, jsonb) to service_role;
