-- 2026-08-04 — Nightly schedule for the multi-user phone sync.
--
-- Run this AFTER db/20260804_google_contact_sync.sql and after both Edge Functions are
-- deployed. It replaces .github/workflows/sync-contacts.yml for hosted users; that
-- workflow stays as the single-operator fallback.
--
-- Fan-out, not a loop: one Edge Function invocation per connected user. An Edge Function
-- has a wall-clock cap, and a first run of ~1,300 contacts is a dozen sequential People API
-- round-trips — one invocation covering everybody would eventually time out mid-run. Per
-- user, each is independently retryable and one expired token can't abort everyone else.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- ── Config ─────────────────────────────────────────────────────────────────────
-- The service_role key lives in Vault, not in the function body — cron job definitions are
-- readable by anyone with DB access, and a key pasted inline would leak into cron.job.
--
-- RUN THESE TWO ONCE, by hand, with your real values:
--
--   select vault.create_secret('https://ykuenmwfxecmmqichwit.supabase.co', 'phone_sync_project_url');
--   select vault.create_secret('<service_role_key>', 'phone_sync_service_key');

create or replace function public.phone_sync_dispatch()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_url  text;
  v_key  text;
  v_user record;
  v_n    int := 0;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'phone_sync_project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'phone_sync_service_key';
  if v_url is null or v_key is null then
    raise exception 'phone_sync_project_url / phone_sync_service_key missing from vault';
  end if;

  for v_user in select user_id from public.phone_sync_pending_users() loop
    -- Fire and forget: pg_net queues the request and returns immediately, so one slow
    -- user can't hold the transaction open. Failures land in each user's last_error,
    -- which the Settings UI shows; net._http_response has the transport-level detail.
    perform net.http_post(
      url     := v_url || '/functions/v1/phone-sync-run',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || v_key
                 ),
      body    := jsonb_build_object('user_id', v_user.user_id),
      timeout_milliseconds := 120000
    );
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.phone_sync_dispatch() from public, anon, authenticated;

-- ── Schedule ───────────────────────────────────────────────────────────────────
-- 08:00 UTC = 4am ET. Exact time doesn't matter; nothing downstream waits on it.
select cron.unschedule('phone-sync-nightly')
where exists (select 1 from cron.job where jobname = 'phone-sync-nightly');

select cron.schedule('phone-sync-nightly', '0 8 * * *', $$select public.phone_sync_dispatch()$$);

-- Useful checks:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select user_id, last_synced_at, last_error from google_contact_sync;
