-- 2026-08-27 — Opt-out hardening. Supersedes parts of db/20260827_sms.sql (same day).
--
-- Found while confirming the workflow: the original opt-out was per-CONTACT and matched
-- only the exact carrier keywords. Two holes, both of which meant "STOP" did not reliably
-- stop.
--
--   1. 295 phone numbers in this database sit on more than one contact (one sits on four).
--      sms_record_inbound() opted out a single matched row (`limit 1`), so a STOP left up
--      to three other contacts textable AT THE NUMBER THAT JUST SAID STOP. Proven before
--      the fix: 4 contacts share a number, 4 sendable before STOP, 3 still sendable after.
--
--   2. The matcher required the whole message to be a keyword. "please stop texting me" —
--      how people actually write it — did not match, and neither did Twilio's own
--      carrier-level filter, so nothing anywhere would have stopped.
--
-- Fix: opt-outs attach to the NUMBER, in their own table, checked before the consent branch
-- and enforced again at write time. Detection gets a second, phrase-based tier.
--
-- Verified after (rolled back): same 4-contact number, DNC cleared and consent recorded so
-- opt-out was the only possible blocker — 4 sendable before, 0 after "please stop texting
-- me". Matcher checked against 23 stop phrasings (all caught) and 8 non-stop replies
-- including "Can you stop by the property tomorrow?" and "non-stop calls from you guys"
-- (none caught).

begin;

-- ── Opt-outs belong to the number ──────────────────────────────────────────────
-- Not to a contact row, because a contact row is the wrong grain: numbers are shared
-- between contacts, contacts get merged and re-imported, and an inbound can arrive from a
-- number that matches no contact at all. The obligation attaches to the person who asked.
--
-- Deliberately global rather than per-client. Cross-list "leakage" here means a second list
-- also stops texting someone who said stop, which is the correct outcome.
create table if not exists public.sms_opt_outs (
  phone        text primary key check (phone ~ '^[0-9]{10}$'),
  opted_out_at timestamptz not null default now(),
  source       text,
  matched_body text
);
alter table public.sms_opt_outs enable row level security;
-- RLS on with zero policies: only the SECURITY DEFINER functions below may touch this.
revoke all on public.sms_opt_outs from anon, authenticated;

-- Seed from anything already flagged on a contact so the two can never disagree.
-- (Zero rows at the time of writing — nothing had ever been texted.)
insert into public.sms_opt_outs (phone, opted_out_at, source)
select distinct public.sms_digits(p), coalesce(c.sms_opted_out_at, now()), 'backfill'
from public.property_crm_contacts c,
     lateral jsonb_array_elements_text(coalesce(c.phones,'[]'::jsonb)) p
where c.sms_status in ('do_not_contact','not_interested')
  and length(public.sms_digits(p)) = 10
on conflict (phone) do nothing;

-- ── Detection ──────────────────────────────────────────────────────────────────
-- Two tiers. The exact set is what carriers recognise, so Twilio blocks those at the number
-- level too and this is belt and braces. The phrase tier exists because people do not text
-- the magic word.
--
-- Tuned to over-match on purpose: a false positive costs one lead, a false negative is a
-- TCPA claim. Still best-effort — no matcher catches every phrasing. The real backstop is
-- that every send is manual, so a human reads the reply before anything else goes out.
create or replace function public.sms_is_stop(p_body text)
returns boolean
language sql immutable as $fn$
  select btrim(coalesce(p_body, '')) ~*
      '^\s*(stop|stopall|stop\s+all|unsubscribe|cancel|end|quit|revoke|optout|opt[\s-]?out)\s*[.!]*\s*$'
    or coalesce(p_body, '') ~*
      '(stop\s+(texting|messaging|contacting|calling|sending|msg)|quit\s+(texting|messaging)|unsubscribe|(remove|take)\s+me\s+(off|from)|delete\s+my\s+(number|info)|do\s*n[o'']?t\s+(text|contact|message|msg|call)\s+me|no\s+more\s+(text|message|msg)|leave\s+me\s+alone|lose\s+my\s+number)';
$fn$;
revoke execute on function public.sms_is_stop(text) from public, anon;
grant execute on function public.sms_is_stop(text) to authenticated;

-- Operator-initiated, for when someone asks to stop by phone, email, or in person. Scoped
-- to numbers the caller can already see, so it cannot be used to probe for other tenants'
-- data. Returns false rather than raising when the number isn't theirs.
create or replace function public.sms_opt_out_number(p_phone text, p_note text default 'manual')
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare v_digits text := public.sms_digits(p_phone);
begin
  if length(v_digits) <> 10 then return false; end if;
  if not exists (
    select 1 from public.property_crm_contacts c
    join public.client_users cu on cu.client_id = c.client_id and cu.user_id = auth.uid(),
    lateral jsonb_array_elements_text(coalesce(c.phones,'[]'::jsonb)) p
    where public.sms_digits(p) = v_digits
  ) then return false; end if;

  insert into public.sms_opt_outs (phone, source, matched_body)
  values (v_digits, 'manual', p_note)
  on conflict (phone) do nothing;

  update public.property_crm_contacts c
  set sms_status = 'do_not_contact', sms_opted_out_at = now(), updated_at = now()
  where exists (
    select 1 from jsonb_array_elements_text(coalesce(c.phones,'[]'::jsonb)) p
    where public.sms_digits(p) = v_digits
  );
  return true;
end;
$fn$;
revoke execute on function public.sms_opt_out_number(text, text) from public, anon;
grant execute on function public.sms_opt_out_number(text, text) to authenticated;

-- ── Inbound: suppress the number, stop every contact holding it ────────────────
-- Return type gains contacts_stopped, so the drop is required.
drop function if exists public.sms_record_inbound(text, text, text, text);

create function public.sms_record_inbound(
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
  -- FIRST, before any matching can fail. An inbound STOP from a number we cannot tie to a
  -- contact must still stop us texting that number.
  if v_stop then
    insert into public.sms_opt_outs (phone, source, matched_body)
    values (v_peer, 'sms_stop', left(coalesce(p_body,''), 200))
    on conflict (phone) do nothing;

    -- EVERY contact carrying this number, not just the first match.
    update public.property_crm_contacts c
    set sms_status = 'do_not_contact', sms_opted_out_at = now(), updated_at = now()
    where exists (
      select 1 from jsonb_array_elements_text(coalesce(c.phones,'[]'::jsonb)) p
      where public.sms_digits(p) = v_peer
    );
    get diagnostics v_n = row_count;
  end if;

  select cl.id into v_client from public.clients cl
  where public.sms_digits(cl.twilio_number) = public.sms_digits(p_to)
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

  -- No client and no contact: the suppression above still stands, we just have nowhere to
  -- file the body.
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

-- ── Precheck: number-level opt-out, above the consent branch ───────────────────
create or replace function public.sms_send_precheck(
  p_user uuid, p_contact_id bigint, p_phone text
)
returns table (allowed boolean, reason text, client_id uuid, to_number text, dnc text)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_contact  record;
  v_digits   text := public.sms_digits(p_phone);
  v_dnc      text;
  v_sent_24h int;
  v_cap      int;
begin
  -- Aliased to cid: the OUT parameter is also called client_id, and plpgsql resolves the
  -- bare name to the parameter, not the record field.
  select c.id, c.client_id as cid, c.phones, c.bad_phones, c.sms_status,
         c.sms_consent_at, c.sms_consent_note
    into v_contact
  from public.property_crm_contacts c
  where c.id = p_contact_id
    and c.client_id in (select cu.client_id from public.client_users cu where cu.user_id = p_user);

  if v_contact.id is null then
    return query select false, 'not_authorized'::text, null::uuid, null::text, null::text;
    return;
  end if;

  v_dnc := public.dnc_state(v_digits);

  if v_dnc = 'invalid' then
    return query select false, 'invalid_number'::text, v_contact.cid, v_digits, v_dnc;
    return;
  end if;

  if not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_contact.phones, '[]'::jsonb)) p
    where public.sms_digits(p) = v_digits
  ) then
    return query select false, 'phone_not_on_contact'::text, v_contact.cid, v_digits, v_dnc;
    return;
  end if;

  if exists (
    select 1 from jsonb_array_elements_text(coalesce(v_contact.bad_phones, '[]'::jsonb)) p
    where public.sms_digits(p) = v_digits
  ) then
    return query select false, 'bad_phone'::text, v_contact.cid, v_digits, v_dnc;
    return;
  end if;

  -- Checked at the NUMBER level and ABOVE the consent branch. Nothing below can reverse it:
  -- recorded consent does not resurrect someone who asked us to stop, and a second contact
  -- row carrying the same number does not get another go.
  if exists (select 1 from public.sms_opt_outs o where o.phone = v_digits) then
    return query select false, 'opted_out'::text, v_contact.cid, v_digits, v_dnc;
    return;
  end if;

  if v_contact.sms_status in ('do_not_contact', 'not_interested') then
    return query select false, 'opted_out'::text, v_contact.cid, v_digits, v_dnc;
    return;
  end if;

  if v_dnc <> 'clear'
     and not (v_contact.sms_consent_at is not null
              and coalesce(btrim(v_contact.sms_consent_note), '') <> '') then
    return query select false,
      (case when v_dnc = 'listed' then 'dnc_listed' else 'dnc_unscrubbed' end)::text,
      v_contact.cid, v_digits, v_dnc;
    return;
  end if;

  if not public.sms_within_quiet_hours(v_digits) then
    return query select false, 'quiet_hours'::text, v_contact.cid, v_digits, v_dnc;
    return;
  end if;

  select cl.sms_daily_cap into v_cap from public.clients cl where cl.id = v_contact.cid;
  select count(*) into v_sent_24h
  from public.sms_messages m
  where m.client_id = v_contact.cid
    and m.direction = 'outbound'
    and m.created_at > now() - interval '24 hours';

  if v_sent_24h >= coalesce(v_cap, 25) then
    return query select false, 'daily_cap'::text, v_contact.cid, v_digits, v_dnc;
    return;
  end if;

  return query select true, 'ok'::text, v_contact.cid, v_digits, v_dnc;
end;
$fn$;
revoke execute on function public.sms_send_precheck(uuid, bigint, text) from public, anon, authenticated;

-- ── Write-time backstop ────────────────────────────────────────────────────────
-- Even if a future caller skips the precheck, a suppressed number cannot be recorded as a
-- send. The Edge Function calls both, so this raises rather than returning a reason.
create or replace function public.sms_record_outbound(
  p_user uuid, p_contact_id bigint, p_phone text, p_from text, p_body text,
  p_sid text, p_status text, p_segments int, p_error text
)
returns bigint language plpgsql security definer set search_path = public as $fn$
declare v_id bigint; v_client uuid; v_digits text := public.sms_digits(p_phone);
begin
  select c.client_id into v_client
  from public.property_crm_contacts c
  where c.id = p_contact_id
    and c.client_id in (select cu.client_id from public.client_users cu where cu.user_id = p_user);
  if v_client is null then raise exception 'not authorized for contact %', p_contact_id; end if;

  if exists (select 1 from public.sms_opt_outs o where o.phone = v_digits) then
    raise exception 'number % has opted out', v_digits;
  end if;

  insert into public.sms_messages (
    client_id, contact_id, direction, peer_number, from_number, to_number,
    body, provider_sid, status, segments, error_code, sent_by
  ) values (
    v_client, p_contact_id, 'outbound', v_digits, p_from, v_digits,
    p_body, p_sid, coalesce(p_status, 'queued'), p_segments, p_error, p_user
  )
  on conflict (provider_sid) do update set status = excluded.status, error_code = excluded.error_code
  returning id into v_id;

  -- updated_at is client-set on this table (see CLAUDE.md) — bump it or upsertContact's
  -- optimistic-concurrency guard silently degrades.
  update public.property_crm_contacts
  set last_sms_at = now(), updated_at = now()
  where id = p_contact_id;

  return v_id;
end;
$fn$;
revoke execute on function public.sms_record_outbound(uuid, bigint, text, text, text, text, text, int, text) from public, anon, authenticated;

commit;
