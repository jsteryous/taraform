-- Remove texting entirely (2026-11-13).
--
-- The SMS build of 2026-08-27/28 never sent or received a message: no client ever had a
-- number, no DNC area code was ever loaded, and the provider keys were never set. The app
-- is moving to a shared relationship CRM where texting has no place, so it goes rather
-- than sitting dormant behind a publicly reachable webhook.
--
-- Checked immediately before writing this, on production:
--   sms_messages, sms_opt_outs, sms_unrouted, dnc_numbers, dnc_area_codes  -> 0 rows each
--   clients.sms_number / sms_help_text                                     -> all null
--   contacts: last_sms_at, sms_message_count, sms_consent_*, sms_opted_out_at -> all empty
--   contacts.sms_status -> 'eligible' on every row but one: id 1772646524479 was
--     'interested', a leftover from the Railway-era server. That value is the only data
--     this migration destroys, and this comment is now its record.
--
-- ORDER MATTERS: apply only AFTER the app build without texting is live. The previous
-- build selects sms_status in its contact list query and calls create_client with
-- p_sms_number, so dropping these first breaks the deployed site.
--
-- The earlier migrations (20260827_sms*.sql, 20260827_telnyx.sql, 20260828_sms_inbox.sql)
-- stay in db/ as the history of what was applied. To bring texting back, start from them
-- and from git history before this commit.
--
-- Not touched: referral_leads.sms_consent* (belongs to the separate marketing project) and
-- property_crm_contacts.opt_out_at (legacy, origin unclear, not provably SMS).

begin;

-- No CASCADE on purpose: if anything unexpected still depends on these, fail and look.
drop table public.sms_messages;
drop table public.sms_unrouted;
drop table public.sms_opt_outs;
drop table public.dnc_numbers;
drop table public.dnc_area_codes;

-- Functions after the tables: a column default or index on those tables may call one
-- (sms_digits), while function bodies are not tracked dependencies of the tables.
drop function if exists public.sms_send_precheck(uuid, bigint, text);
drop function if exists public.sms_check_number(bigint, text);
drop function if exists public.sms_record_outbound(uuid, bigint, text, text, text, text, text, integer, text);
drop function if exists public.sms_record_inbound(text, text, text, text);
drop function if exists public.sms_record_help_reply(text, text, text, text);
drop function if exists public.sms_update_status(text, text, text);
drop function if exists public.sms_inbox(uuid, integer);
drop function if exists public.sms_unread_count(uuid);
drop function if exists public.sms_mark_read(bigint[]);
drop function if exists public.sms_mark_thread_read(text);
drop function if exists public.sms_opt_out_number(text, text);
drop function if exists public.sms_within_quiet_hours(text, timestamptz);
drop function if exists public.sms_is_stop(text);
drop function if exists public.sms_is_help(text);
drop function if exists public.dnc_state(text);
drop function if exists public.sms_digits(text);

-- create_client took the number as a second argument. Changing a signature means
-- DROP + CREATE, and that resets EXECUTE to PUBLIC (see CLAUDE.md), so the grants are
-- restated here and must be re-checked with has_function_privilege afterwards.
drop function public.create_client(text, text);

create function public.create_client(p_name text)
returns public.clients
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_client public.clients;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'name is required'; end if;
  insert into clients (name) values (btrim(p_name)) returning * into v_client;
  insert into client_users (client_id, user_id, role) values (v_client.id, auth.uid(), 'owner');
  return v_client;
end;
$$;

revoke all on function public.create_client(text) from public, anon;
grant execute on function public.create_client(text) to authenticated, service_role;

alter table public.clients
  drop column sms_number,
  drop column sms_daily_cap,
  drop column sms_help_text;

-- Dropping sms_status also drops property_crm_contacts_sms_status_check.
alter table public.property_crm_contacts
  drop column sms_status,
  drop column last_sms_at,
  drop column sms_message_count,
  drop column sms_consent_at,
  drop column sms_consent_note,
  drop column sms_opted_out_at;

commit;

-- Verify afterwards:
--   select has_function_privilege('anon', 'public.create_client(text)', 'execute');  -- false
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname ~ '^(sms_|dnc_)';                      -- 0
