# Plan: caller ID for every user, unattended, still $0

> Status: **design only, nothing built.** Written 2026-08-04. Supersedes the Tier 4 backlog
> sketch in the root `CLAUDE.md`, which assumed a browser-side PKCE flow with no server
> component — that turns out not to work for an *unattended* sync (see "Why the browser
> can't do this alone").
>
> Today's sync (`scripts/phone-sync.mjs` + `.github/workflows/sync-contacts.yml`) serves one
> operator: one Google refresh token and one Supabase login in **repo** secrets. A new user
> signing into Taraform gets nothing. This plan makes it self-serve.

## Goal

A new user signs in, clicks **Connect Google Contacts** once, and from then on their phone
shows `John Parker (Offer Made)` on incoming calls — forever, with no further action. Each
user's contacts go into **their own** Google account, scoped by RLS to the lists they can
actually see.

## Why the browser can't do this alone

The obvious cheap design is "do the whole sync client-side with Google Identity Services'
token model" — the browser gets a contacts-scoped access token with no client secret and no
refresh token, so there is nothing to store and nothing to leak.

It was rejected because **`requestAccessToken()` must be driven by a user gesture**. There
is no silent background renewal in the token model, so that design can only ever produce a
"Sync to phone" button the user has to remember to click. Unattended is the requirement, so
it's out.

Unattended means acting while the user is asleep, which means holding a delegated
credential, which means a refresh token at rest and a scheduler. There is no way around
that. The design work is entirely in *where* the token lives and *how narrowly* it's
reachable.

## Architecture

```
Browser (GitHub Pages, no secrets)
  "Connect Google Contacts"
  → GIS initCodeClient: PKCE + access_type=offline + prompt=consent
  → auth code  ──POST──►  Edge Function  google-contacts-connect
                            ├ exchanges code + client_secret + verifier
                            └ vault.create_secret(refresh_token) → google_contact_sync row

pg_cron  (nightly, 08:00 UTC)
  → for each connected user: net.http_post → Edge Function  phone-sync-run?user=<uuid>
       ├ vault → refresh token → Google access token
       ├ phone_sync_contacts_for(uid)   ← membership-scoped SQL, not a service_role table read
       ├ src/lib/phoneSync.js  (unchanged — buildPerson / dedupeByPhone / diffContacts)
       └ People API batchCreate / batchUpdate / batchDelete
```

Everything already in `src/lib/phoneSync.js` is reused verbatim: it's pure, has no Node
imports, and runs as-is on Deno. Only the I/O shell is new.

### The client secret stays server-side

Google's code exchange requires `client_secret` for a Web application client, so it can
never ship in the bundle. The browser does only the *authorization* half (PKCE challenge →
auth code) and posts the code to the Edge Function, which holds the secret as a Supabase
secret and completes the exchange. Standard BFF split.

Two quirks to remember when implementing:
- With `ux_mode: 'popup'`, Google requires `redirect_uri=postmessage` on the token exchange.
- `access_type: 'offline'` **and** `prompt: 'consent'` are both needed to reliably get a
  refresh token back — without `prompt: 'consent'`, a returning user who already granted the
  scope gets an access token and no refresh token, and the nightly job silently has nothing
  to use.

### Token custody

This is the part that was flagged as unsettled in the backlog. The design:

| Decision | Rationale |
| --- | --- |
| Refresh token in **Supabase Vault**, not a column | Encrypted at rest, so it isn't plaintext in a backup or a `pg_dump`. The `google_contact_sync` row holds only the vault secret's uuid, the Google account email, and sync status. |
| `google_contact_sync` has **RLS on and no SELECT policy** for `authenticated` | Users never need to read their own token back. Grant `SELECT` to nobody; the user-facing UI reads a view exposing only `google_email`, `last_synced_at`, `last_error`. |
| **Disconnect** hits Google's `/revoke` endpoint *before* deleting the row | Deleting our copy alone would leave a live grant dangling on Google's side. |
| Scheduler lives **inside Supabase** (pg_cron), not GitHub Actions | The alternative is a CI job holding a `service_role` key that can read every user's token — a new trust boundary outside the database. pg_cron + Edge Functions keep the credential and the data in the same system that already holds them. |

### The multi-tenancy trap

Edge Functions run as `service_role`, which **bypasses RLS**. A naive port of
`loadContacts()` would read every tenant's contacts. Do not re-implement the membership
check in TypeScript.

Instead add a `SECURITY DEFINER` function `phone_sync_contacts_for(uid uuid)` that does the
`client_users` join itself and returns only that user's rows. The scoping rule then lives in
one place in SQL, next to the existing policies in `db/20260610_clients_rls.sql`, and the
function is the only thing the sync is allowed to call. This is the single highest-risk line
of the whole feature and deserves a test in `src/lib/rls.proof.test.js`.

### Fan out, don't loop

Edge Functions have a wall-clock cap. A first-run sync for ~1,300 contacts is a dozen
sequential People API round-trips; doing that for N users inside one invocation will
eventually time out and leave a partial sync. So **pg_cron enqueues one invocation per
connected user**, not one invocation that loops. Each is independently retryable, and one
user's expired token can't abort everyone else's run.

### Which lists sync

Today `SYNC_CLIENT_IDS` is an env var whose **order is priority** for cross-list dedupe.
Per-user, the default should be "every client you're a member of," and priority needs a
stable per-user order. Simplest: a `client_priority uuid[]` column on `google_contact_sync`,
defaulted from the user's memberships, reorderable later in the UI if anyone cares. It must
be stable between runs or the dedupe winner flips and churns create/delete pairs every night.

## Part 2 — the "Call from: Name" popup

Worth being direct: **Taraform cannot show a popup when your phone rings.** A web app —
desktop or mobile — has no API for incoming cellular call state. There's no permission to
request; the capability doesn't exist in a browser. Only two things can produce that popup:

1. **A native app.** iOS's CallKit `CXCallDirectoryProvider` is *exactly* the feature you're
   describing — you supply a number→label map and iOS renders the name on the native call
   screen for numbers not in Contacts. Android allows a true floating overlay (how Truecaller
   works). Both need a shipped app; iOS also needs the Apple Developer Program at $99/yr and
   App Store review. Not free, and a different product.
2. **Routing calls through Taraform.** If calls arrived over VoIP (Twilio et al.), a webhook
   → Supabase Realtime → open browser tab would pop a card. The infrastructure is $0, but the
   phone number isn't (~$1.15/mo + per-minute), it changes the number you hand out, and it
   only works with the tab open.

Here's the thing though: the Google Contacts sync **already produces the outcome the popup
was for**, and arguably a better one. The name is on the native lock/call screen before you
answer, with no app open, no tab open, and no ongoing cost. What it's missing is only the
second half of your ask — tapping through to the contact card.

### That half is nearly free

Google People API contacts carry a `urls` field, which iOS and Android both sync as a
tappable link on the contact card. So put the deep link the app already has on it:

```js
urls: [{ value: `https://taraform.org/#/contact/${contact.id}`, type: 'work' }]
```

`John Parker (Offer Made)` calls → you see the name on the call screen → tap his name → his
contact card has a **taraform.org** link → tap it, and the app opens straight to his contact
overlay. The routing for this already exists (`/#/contact/:id`, the full-screen overlay
synced to the URL in `App.jsx`).

Implementation is small and lands in `src/lib/phoneSync.js`:
- add `urls` to `PERSON_FIELDS` and `UPDATE_MASK`
- emit it from `buildPerson`
- add it to `personSignature`, or the diff won't notice it and the field will never update

One-time cost: adding it to the signature makes the next run update all ~1,318 existing
contacts. That's expected, idempotent, and harmless.

**This is worth doing on its own, before any of the multi-user work** — it's an hour, it
benefits the current single-operator sync immediately, and it's independent of everything
above.

## Cost

| Component | Usage | Free allowance |
| --- | --- | --- |
| Supabase Edge Functions | ~30 invocations/month per user | 500,000/month |
| pg_cron + pg_net + Vault | nightly | unmetered features, not plan-gated |
| Supabase egress | ~205 kB per user per run | 5 GB/month |
| Google People API | ~3 calls/night steady state per user | quota-based, not billed |

Still $0. One caveat: **free-tier Supabase projects pause after 7 days of inactivity**, and a
paused project's cron doesn't run. Not a concern while the app is in daily use, but it's the
failure mode if usage ever goes quiet.

## The actual gating item: Google verification

`https://www.googleapis.com/auth/contacts` is a **sensitive** scope. An unverified app is
capped at **100 users for the lifetime of the project** — the cap can't be reset — and every
user sees the "Google hasn't verified this app" warning before consenting.

100 users is far beyond where Taraform is, so this doesn't block building it. But note two
things: the cap is *cumulative and permanent*, and it applies to the OAuth project as a
whole. The current single-operator setup already burned one slot against it.

Verification is free to submit and needs a privacy policy URL plus a verified domain —
taraform.org qualifies on both — but it's a real review that takes weeks. Start it well
before you'd actually onboard outside users, not after.

## Work breakdown

| Phase | Scope | Rough size |
| --- | --- | --- |
| 0 | ~~Deep link in the synced contact (`urls`)~~ — **done 2026-08-04**, see `phoneSync.js` | ~1 hour |
| 1 | `db/`: `google_contact_sync` table + Vault wiring + `phone_sync_contacts_for()` + the RLS proof test | half day |
| 2 | Edge Function `google-contacts-connect` (code exchange, store) | half day |
| 3 | Edge Function `phone-sync-run` (port the runner's I/O shell to Deno; `phoneSync.js` unchanged) | half day |
| 4 | pg_cron schedule + per-user fan-out + failure surfacing (`last_error` in the UI) | half day |
| 5 | Settings UI: Connect / status / Disconnect. Use `<Select>` and `useConfirm()`, per `components/CLAUDE.md` | half day |
| 6 | Google Cloud: add a Web application client + JS origins; submit for verification | ~1 hour + weeks of waiting |

Roughly 2½ days of work. `scripts/phone-sync.mjs` and its workflow stay as-is throughout —
they keep working for the owner, and they're a useful fallback while the hosted path is
unproven.

## Open questions

- **Does anyone actually want this yet?** The current users (`alex@rebbadvisors.com`,
  `devankashi3@gmail.com`) haven't asked. Phase 0 is worth doing regardless; phases 1–6 are
  speculative until a second user asks.
- **Who owns the Google Cloud project** once it's serving other people's contacts, and what
  privacy policy do we publish for it? Verification requires a real answer, not a placeholder.
- **Failure visibility.** A user whose token gets revoked needs to find out. A `last_error`
  badge in Settings is the minimum; email would need a service we no longer run.
