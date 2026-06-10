-- 2026-06-10 — Railway decommission, step 1.
-- Lets the browser manage clients/members directly via the anon key + RLS,
-- replacing the Railway server's /api/clients* endpoints.
-- Applied to project ykuenmwfxecmmqichwit via the Supabase Management API.

-- ── clients: membership-gated direct access ─────────────────────────────
-- (RLS was already enabled; the table previously had zero policies.)
create policy "members can view their clients" on public.clients
  for select to authenticated
  using (id in (select client_id from public.client_users where user_id = auth.uid()));

create policy "members can update their clients" on public.clients
  for update to authenticated
  using (id in (select client_id from public.client_users where user_id = auth.uid()))
  with check (id in (select client_id from public.client_users where user_id = auth.uid()));

create policy "owners can delete their clients" on public.clients
  for delete to authenticated
  using (id in (select client_id from public.client_users where user_id = auth.uid() and role = 'owner'));

-- No INSERT policy on clients on purpose: creation goes through create_client()
-- so the owner membership row is written atomically with the client.

-- ── create_client: insert client + owner membership ─────────────────────
create or replace function public.create_client(p_name text, p_twilio_number text default null)
returns public.clients
language plpgsql security definer set search_path = public
as $$
declare v_client public.clients;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'name is required'; end if;
  insert into clients (name, twilio_number)
    values (btrim(p_name), nullif(btrim(coalesce(p_twilio_number, '')), ''))
    returning * into v_client;
  insert into client_users (client_id, user_id, role) values (v_client.id, auth.uid(), 'owner');
  return v_client;
end;
$$;

-- ── get_client_members: member list incl. emails (auth.users needs definer) ──
create or replace function public.get_client_members(p_client_id uuid)
returns table (id uuid, user_id uuid, role text, created_at timestamptz, email text)
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from client_users cu where cu.client_id = p_client_id and cu.user_id = auth.uid()) then
    raise exception 'Forbidden';
  end if;
  return query
    select cu.id, cu.user_id, cu.role, cu.created_at, u.email::text
    from client_users cu
    left join auth.users u on u.id = cu.user_id
    where cu.client_id = p_client_id
    order by cu.created_at;
end;
$$;

-- ── add_client_member: look up auth user by email, insert as member ─────
create or replace function public.add_client_member(p_client_id uuid, p_email text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_target uuid;
begin
  if not exists (select 1 from client_users cu where cu.client_id = p_client_id and cu.user_id = auth.uid()) then
    raise exception 'Forbidden';
  end if;
  select u.id into v_target from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  if v_target is null then raise exception 'No user found with that email'; end if;
  if exists (select 1 from client_users cu where cu.client_id = p_client_id and cu.user_id = v_target) then
    raise exception 'User is already a member';
  end if;
  insert into client_users (client_id, user_id, role) values (p_client_id, v_target, 'member');
end;
$$;

-- ── remove_client_member: owner-only ────────────────────────────────────
create or replace function public.remove_client_member(p_client_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from client_users cu where cu.client_id = p_client_id and cu.user_id = auth.uid() and cu.role = 'owner') then
    raise exception 'Forbidden - owner role required';
  end if;
  delete from client_users cu where cu.client_id = p_client_id and cu.user_id = p_user_id;
end;
$$;

-- ── lock RPCs to signed-in users ─────────────────────────────────────────
revoke all on function public.create_client(text, text) from public, anon;
revoke all on function public.get_client_members(uuid) from public, anon;
revoke all on function public.add_client_member(uuid, text) from public, anon;
revoke all on function public.remove_client_member(uuid, uuid) from public, anon;
grant execute on function public.create_client(text, text) to authenticated;
grant execute on function public.get_client_members(uuid) to authenticated;
grant execute on function public.add_client_member(uuid, text) to authenticated;
grant execute on function public.remove_client_member(uuid, uuid) to authenticated;
