-- Per-person switch for automatic follow-ups (2026-11-13). Additive; safe to apply before
-- the app build that uses it.
--
-- Logging a note schedules the next call (lib/followUpCadence.js). In a shared workspace
-- not everyone wants that, so each member gets their own on/off per workspace, on by
-- default. It lives on the membership row because it is exactly that: one person's
-- preference in one workspace.
--
-- A membership row is otherwise read-only to its owner — it also holds `role`, and an
-- UPDATE policy on client_users would let anyone promote themselves to owner. So the
-- switch is set through a function that can change this one column on the caller's own
-- row and nothing else.

begin;

alter table public.client_users add column auto_follow_up boolean not null default true;

create function public.set_auto_follow_up(p_client_id uuid, p_on boolean)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.client_users
     set auto_follow_up = coalesce(p_on, true)
   where client_id = p_client_id and user_id = auth.uid();
  if not found then raise exception 'Forbidden'; end if;
  return coalesce(p_on, true);
end;
$$;

-- A new function is executable by PUBLIC until told otherwise.
revoke all on function public.set_auto_follow_up(uuid, boolean) from public, anon;
grant execute on function public.set_auto_follow_up(uuid, boolean) to authenticated;

commit;
