-- Workspaces stop being self-serve (2026-11-13).
--
-- ORDER MATTERS: apply only once the app build without the "Add New Client" form is live.
--
-- Two changes, both because the app is becoming one team's shared CRM (PLAN.md) rather
-- than something anyone can start their own space in:
--
-- 1. create_client() is dropped. Until now any signed-in account could call it and become
--    owner of a new workspace, and signup is open to the internet. Nobody creates
--    workspaces from the app any more, the operator included. No INSERT policy exists on
--    `clients`, so with the function gone there is no path left for `authenticated` to
--    make one. A new workspace is made by hand — snippet at the foot of this file.
--
--    This does not affect adding teammates: add_client_member() resolves an existing
--    account by email, so the invitee still signs up first and an owner still adds them.
--    A signed-up account with no memberships now sees "you're not in a workspace yet".
--
-- 2. Updating a workspace becomes owner-only. The old policy let ANY member rename the
--    workspace or rewrite its statuses, fields and tabs. Harmless while every workspace
--    had one member; in a shared one it means any teammate can change the layout for
--    everyone. Delete was already owner-only.

begin;

drop function public.create_client(text);

drop policy "members can update their clients" on public.clients;

create policy "owners can update their clients" on public.clients
  for update to authenticated
  using (id in (select cu.client_id from public.client_users cu
                 where cu.user_id = auth.uid() and cu.role = 'owner'))
  with check (id in (select cu.client_id from public.client_users cu
                      where cu.user_id = auth.uid() and cu.role = 'owner'));

commit;

-- To create a workspace (run as postgres in the SQL editor; replace both values):
--
--   with c as (
--     insert into public.clients (name) values ('Workspace name') returning id
--   )
--   insert into public.client_users (client_id, user_id, role)
--   select c.id, u.id, 'owner' from c, auth.users u where u.email = 'owner@example.com';
