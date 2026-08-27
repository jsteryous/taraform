-- 2026-08-27 — Provider switch: Twilio → Telnyx, and the column rename that follows.
--
-- Why: at ~600 messages/month the price difference between the two is about $3, so cost did
-- not decide it. Telnyx has a smoother 10DLC registration and answers support tickets at
-- small spend, which is where the previous Twilio attempt fell over.
--
-- Worth recording, because it was the reason for that attempt being abandoned: the "$1.50
-- per text" seen last time was NOT a provider rate — US A2P is under a cent per segment on
-- either. It was carrier penalty fees for sending on an unregistered 10DLC campaign, levied
-- by T-Mobile/AT&T directly. Switching providers does not avoid that. Registering before
-- sending does.
--
-- Nothing about the compliance layer changes. sms_send_precheck, dnc_state,
-- sms_within_quiet_hours, sms_is_stop and sms_opt_outs are provider-agnostic by design —
-- the vendor surface is one fetch in sms-send and one signature check in sms-inbound.

begin;

-- clients.twilio_number outlived the vendor by two migrations (Railway → direct Supabase →
-- Telnyx). Renamed rather than left misleading: a name that lies about which system owns a
-- value is exactly what made google_contact_sync vs phone_sync_* worth a paragraph in
-- CLAUDE.md.
alter table public.clients rename column twilio_number to sms_number;

-- CREATE OR REPLACE cannot rename an argument, so the RPC has to be dropped first.
drop function if exists public.create_client(text, text);

create function public.create_client(p_name text, p_sms_number text default null)
returns public.clients
language plpgsql security definer set search_path = public
as $$
declare v_client public.clients;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'name is required'; end if;
  insert into clients (name, sms_number)
    values (btrim(p_name), nullif(btrim(coalesce(p_sms_number, '')), ''))
    returning * into v_client;
  insert into client_users (client_id, user_id, role) values (v_client.id, auth.uid(), 'owner');
  return v_client;
end;
$$;
-- Default PUBLIC execute grant has to go explicitly; revoking from anon/authenticated by
-- name leaves it standing.
revoke execute on function public.create_client(text, text) from public, anon;
grant execute on function public.create_client(text, text) to authenticated;

-- Inbound routing follows the rename. Body is otherwise identical to
-- db/20260827_sms_optout_hardening.sql.
create or replace function public.sms_record_inbound(
  p_from text, p_to text, p_body text, p_sid text
)
returns table (contact_id bigint, opted_out boolean, contacts_stopped int)
language plpgsql security definer set search_path = public as $fn$
declare
  v_client  uuid;
  v_contact bigint;
  v_peer    text := public.sms_digits(p_from);
  v_stop    boolean := public.sms_is_stop(p_body);
  v_n       int := 0;
begin
  if v_stop then
    insert into public.sms_opt_outs (phone, source, matched_body)
    values (v_peer, 'sms_stop', left(coalesce(p_body,''), 200))
    on conflict (phone) do nothing;
    update public.property_crm_contacts c
    set sms_status = 'do_not_contact', sms_opted_out_at = now(), updated_at = now()
    where exists (
      select 1 from jsonb_array_elements_text(coalesce(c.phones,'[]'::jsonb)) p
      where public.sms_digits(p) = v_peer
    );
    get diagnostics v_n = row_count;
  end if;

  select cl.id into v_client from public.clients cl
  where public.sms_digits(cl.sms_number) = public.sms_digits(p_to)
  limit 1;

  select c.id into v_contact
  from public.property_crm_contacts c
  where (v_client is null or c.client_id = v_client)
    and exists (
      select 1 from jsonb_array_elements_text(coalesce(c.phones,'[]'::jsonb)) p
      where public.sms_digits(p) = v_peer
    )
  order by c.updated_at desc nulls last
  limit 1;

  if v_client is null then
    select c.client_id into v_client from public.property_crm_contacts c where c.id = v_contact;
  end if;
  if v_client is null then
    return query select null::bigint, v_stop, v_n;
    return;
  end if;

  insert into public.sms_messages (
    client_id, contact_id, direction, peer_number, from_number, to_number, body, provider_sid, status
  ) values (
    v_client, v_contact, 'inbound', v_peer, public.sms_digits(p_from), public.sms_digits(p_to),
    p_body, p_sid, 'received'
  )
  on conflict (provider_sid) do nothing;

  return query select v_contact, v_stop, v_n;
end;
$fn$;
revoke execute on function public.sms_record_inbound(text, text, text, text) from public, anon, authenticated;

-- NOTE: at the time of this migration Table Rock still held +18644775752 in sms_number, a
-- dead Twilio number. Cleared immediately after by db/20260827_clear_stale_sms_number.sql,
-- so no client has a number set — Personal List needs the new Telnyx one before anything
-- can send.

commit;
