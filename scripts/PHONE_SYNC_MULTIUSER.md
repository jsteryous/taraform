# Caller ID for every user — self-serve, automatic, $0

> **Status: deployed and verified 2026-08-05.** Schema, RPCs, both Edge Functions, the
> nightly cron job and both secrets are live on project `ykuenmwfxecmmqichwit`. The
> cron→function auth path was proved end to end (service_role key → 500 "No Google
> connection"; anon key → 403). Nobody has connected a Google account yet, so the nightly
> run currently has zero users to process.
>
> This is the multi-user version of `PHONE_SYNC.md`. That one serves a single operator —
> one Google refresh token and one Supabase login in **repo** secrets. This one lets any
> user click **Connect Google Contacts** in Settings and get nightly caller ID for the
> contacts *they* can see.

An incoming call shows `John Parker (Offer Made)` on the native call screen, and the synced
contact card links back to the record in Taraform.

## How it works

```
Browser (GitHub Pages, no secrets)
  "Connect Google Contacts"
  → GIS initCodeClient: access_type=offline + prompt=consent
  → auth code  ──POST──►  Edge Function  google-contacts-connect
                            ├ exchanges code + client_secret (server-side only)
                            └ vault.create_secret(refresh_token) → google_contact_sync row

pg_cron  (nightly 08:00 UTC)  → phone_sync_dispatch()
  → one net.http_post per connected user → Edge Function  phone-sync-run
       ├ vault → refresh token → Google access token
       ├ phone_sync_contacts_for(uid)   ← membership join in SQL, not TypeScript
       ├ _shared/phoneSync.js           ← same logic as the single-operator runner
       └ People API batchCreate / batchUpdate / batchDelete
```

### Why the browser can't do it alone

The tempting design is a pure client-side sync using GIS's *token model* — no client
secret, no refresh token, nothing stored. It was rejected because
`requestAccessToken()` must be driven by a user gesture: there is no silent background
renewal, so that design can only ever produce a "Sync now" button someone has to remember
to press. Unattended means acting while the user is asleep, which means a refresh token at
rest and a scheduler. The design work is entirely in *where* the token lives.

### Token custody

| Decision | Rationale |
| --- | --- |
| Refresh token in **Supabase Vault**, never a column | Encrypted at rest, so it isn't plaintext in a backup or `pg_dump`. The `google_contact_sync` row holds only the vault secret's uuid. |
| `google_contact_sync` has RLS on and **zero policies** | Users never need their token back. The UI reads `get_my_contact_sync()`, which returns five safe columns and cannot return `token_secret_id`. |
| **Disconnect** revokes at Google *before* deleting the row | Dropping our copy alone would leave a live grant dangling on the user's Google account. |
| Scheduler inside Supabase (pg_cron), not GitHub Actions | The alternative is CI holding a `service_role` key that can read every user's token — a new trust boundary outside the database. |
| The client secret lives only in the Edge Function | The browser gets an authorization *code*, never a token. An intercepted code is useless without the secret. |

### The multi-tenancy boundary

Edge Functions run as `service_role`, which **bypasses RLS**. So the scoping rule is not in
TypeScript — `phone-sync-run` never touches `property_crm_contacts` directly. It calls
`phone_sync_contacts_for(uid)`, which does the `client_users` join itself, mirroring the
policies in `db/20260610_clients_rls.sql`.

Every `phone_sync_*` function is `revoke`d from `authenticated` and granted only to
`service_role`. They take a user id as a *parameter* rather than reading `auth.uid()`, so
granting any of them to `authenticated` would let any signed-in user read any tenant's
contacts — or lift another user's refresh token out of Vault. `src/lib/rls.proof.test.js`
probes exactly that.

### Fan out, don't loop

`phone_sync_dispatch()` fires one Edge Function invocation **per user**. Functions have a
wall-clock cap and a first run of ~1,300 contacts is a dozen sequential People API
round-trips, so one invocation covering everybody would time out mid-run. Per user, each is
independently retryable and one expired token can't abort everyone else's sync.

Interrupted runs are safe regardless: the sync is a reconcile, not an append, so a run that
dies halfway is simply finished by the next one.

## Deploying it

Nothing below has been run yet. Steps 1–3 are enough to test with your own account; 4 turns
on the nightly schedule; 5 exposes it to everyone else.

### 1. Google Cloud

The existing project from `PHONE_SYNC.md` works — add a second OAuth client to it.

1. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
2. **Authorized JavaScript origins:** `https://taraform.org` and `http://localhost:5173`.
   No redirect URI is needed — the GIS popup uses `postmessage`.
3. Save the client ID and secret.
4. The consent screen must be **In production** (not Testing) or refresh tokens expire
   after 7 days and every user's sync dies silently the following week.

### 2. Database

Apply in order:

```
db/20260804_google_contact_sync.sql     # table, Vault wiring, RPCs, grants
```

### 3. Edge Functions

```bash
npm run sync:edge                        # regenerate _shared/ from src/lib
supabase functions deploy google-contacts-connect --project-ref ykuenmwfxecmmqichwit
supabase functions deploy phone-sync-run        --project-ref ykuenmwfxecmmqichwit
```

**Deploy with the CLI, not by pasting file contents into an API call.** The CLI uploads the
real `_shared/` files, so what runs is byte-identical to what's committed. Hand-transcribing
them re-introduces exactly the drift `edgeShared.test.js` exists to catch — and that drift
is invisible, because the repo test still passes while production differs.

Both functions keep `verify_jwt` **on**, and that is load-bearing for the runner's own auth
check rather than just belt-and-braces. `phone-sync-run` accepts a caller if the bearer
either equals `SUPABASE_SERVICE_ROLE_KEY` *or* is a JWT whose `role` claim is
`service_role`. The second branch is safe only because the platform has already verified
the signature before the function runs — so a forged token never reaches the code and the
function only has to judge claims. Deploying this one with `--no-verify-jwt` would turn
that branch into a hole. Don't.

The two branches exist because a plain string comparison against
`SUPABASE_SERVICE_ROLE_KEY` **does not work**: the value the platform injects is not
guaranteed to be the legacy JWT that pg_cron presents from Vault, and when they differ
every nightly run 403s *before* the function can write `last_error` — so it looks exactly
like "nobody is connected" rather than like a failure. Found by testing this in advance;
verify it after any change with the `net.http_post` probe in the deploy notes below.

Then the client secret, which never leaves Google and this function:

```bash
supabase secrets set GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy --project-ref ykuenmwfxecmmqichwit
```

Finally set `VITE_GOOGLE_CLIENT_ID` in `.env.local` and as a GitHub Actions secret (already
wired into `deploy.yml`). It is **not** a secret — it ships in the public bundle by design.
Leaving it unset simply hides the feature.

At this point you can connect your own account from the app and hit **Sync now**.

### 4. Nightly schedule

`db/20260804_phone_sync_cron.sql` is applied and the job is scheduled, but it raises until
the service_role key is in Vault. One statement, run by hand in the SQL editor:

```sql
select vault.create_secret('<service_role_key>', 'phone_sync_service_key');
```

The project URL is a constant in `phone_sync_dispatch()` rather than a second Vault entry —
it already ships in the public bundle, so treating it as a secret buys nothing and doubles
the setup. The key is in Vault because cron job definitions and `pg_proc` bodies are
readable by anyone with DB access.

Check it:

```sql
select * from cron.job;
select * from cron.job_run_details order by start_time desc limit 5;
select user_id, last_synced_at, last_error from google_contact_sync;
```

**Prove the auth path without waiting for 4am.** `phone_sync_dispatch()` is a no-op when
nobody is connected, so it can't tell you whether the key works. Fire one request at a
user id that cannot exist and read the response:

```sql
select net.http_post(
  url     := 'https://ykuenmwfxecmmqichwit.supabase.co/functions/v1/phone-sync-run',
  headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                              where name = 'phone_sync_service_key')),
  body    := jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000000')
) as request_id;

-- then, in a second statement (pg_net is async):
select status_code, content from net._http_response order by id desc limit 1;
```

- `500 {"error":"No Google connection for this user"}` → the key authenticates. Correct.
- `403 {"error":"Forbidden"}` → wrong key, or the auth check regressed.

Repeat it with the anon key substituted; that one **must** come back 403.

### 5. Google verification — the actual gate on "everyone"

`https://www.googleapis.com/auth/contacts` is a **sensitive** scope. Until the OAuth app is
verified:

- it is capped at **100 users for the lifetime of the project** — cumulative, permanent,
  cannot be reset (the single-operator setup already spent one), and
- every user sees a **"Google hasn't verified this app"** warning before consenting.

100 users is far beyond where Taraform is, so this blocks nothing today. Verification is
free to submit and needs a privacy policy URL plus a verified domain (taraform.org
qualifies on both), but it is a real review that takes weeks. Start it before you'd onboard
outside users, not after.

## Cost

| Component | Usage | Free allowance |
| --- | --- | --- |
| Supabase Edge Functions | ~30 invocations/month per user | 500,000/month |
| pg_cron + pg_net + Vault | nightly | unmetered, not plan-gated |
| Supabase egress | ~205 kB per user per run | 5 GB/month |
| Google People API | ~3 calls/night steady state per user | quota-based, not billed |

Still $0. One caveat: **free-tier Supabase projects pause after 7 days of inactivity**, and
a paused project's cron doesn't run. Not a concern while the app is in daily use, but it's
the failure mode if things go quiet.

## Relationship to the single-operator sync

`scripts/phone-sync.mjs` and `.github/workflows/sync-contacts.yml` are unchanged and still
work. Keep them until the hosted path has run clean for a while — they're the fallback, and
they exercise the same `src/lib/phoneSync.js`. Once you've connected your own account
through the app, running both would sync the same contacts into the same Google account
twice via two different `taraform_id` stampings; **pick one**. The tidy switch is
`node scripts/phone-sync.mjs --purge --yes`, then connect in the app.

## Code layout

| File | Role |
| --- | --- |
| `db/20260804_google_contact_sync.sql` | Table, Vault wiring, RPCs, grants. The tenancy boundary. |
| `db/20260804_phone_sync_cron.sql` | Nightly `pg_cron` job + per-user fan-out. |
| `supabase/functions/google-contacts-connect/` | Browser-facing: connect / disconnect / sync-now / status. |
| `supabase/functions/phone-sync-run/` | One user's sync. service_role only. |
| `supabase/functions/_shared/google.ts` | OAuth + People API I/O. |
| `supabase/functions/_shared/phoneSync.js` | **Generated** from `src/lib/` by `npm run sync:edge`. |
| `src/lib/googleContacts.js` | Browser: GIS popup + Edge Function calls. |
| `src/components/modals/PhoneSyncModal.jsx` | The Settings UI (phone icon in the header). |
| `src/lib/edgeShared.test.js` | Fails if the generated copy drifts from `src/lib/`. |
| `src/lib/rls.proof.test.js` | Probes the grants and the scoping function. |

The shared code is a **generated copy**, not an import: the Supabase CLI bundles a function
from its own directory, and reaching outside `supabase/functions` isn't a contract worth
betting a nightly job on. `npm test` fails the moment the copy and the source disagree.

## Still open

- **Google verification** (step 5) — start it before onboarding anyone outside.
- **Failure visibility.** A user whose token gets revoked sees `last_error` in the Settings
  modal, but only if they open it. Email would need a service we no longer run.
- **Per-user list priority — bit us once already.** `phone_sync_store_token` seeds
  `client_priority` with oldest membership first, and nothing in the UI calls
  `set_my_contact_sync_priority()` to change it. For the first real user that produced
  `[Table Rock, Personal List]` — the exact inverse of the deliberate order hardcoded in
  `scripts/phone-sync.mjs`, whose comment explains why: Personal List is the one actually
  worked out of, so its status is the current one. The first hosted run therefore flipped
  the 7 owners who appear in both lists onto their Table Rock copy (`created 7 / deleted 7`
  in `last_stats`), moving both the caller-ID status and the deep link to the record the
  user *doesn't* work in. Fixed by hand for that user on 2026-08-05:

  ```sql
  update google_contact_sync set client_priority = array['<personal>','<table rock>']::uuid[]
  where user_id = '<uid>';
  ```

  Reconnecting is safe — the `on conflict` clause deliberately leaves `client_priority`
  alone. Still open for the *next* multi-list user: either surface the order in
  `PhoneSyncModal` or pick a better default than membership age.
