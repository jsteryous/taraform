# Phone caller ID — Taraform → Google Contacts

Shows an owner's name (and status) on your phone when they call back, instead of an
unknown number.

```
Supabase ──► nightly GitHub Action ──► Google Contacts ──► your phone
```

Your phone already does caller-ID lookup against its own address book, so the job is just
to keep that address book current. Google Contacts is the hub because **both iOS and
Android sync it natively**. No server, no hosting cost — the schedule runs on GitHub
Actions, the same CI that already deploys the site.

An incoming call shows **`John Parker (Offer Made)`**, with county, parcel, acreage and the
Taraform contact number in the notes.

## What syncs

- Contacts in **Personal List + Table Rock Partners** with `has_good_phone = true`
  (override with the `SYNC_CLIENT_IDS` env var — **the order is priority**, see below).
- Numbers struck through in `bad_phones` are excluded, so dead numbers never create a hit.
- Numbers are written as E.164 (`+18644910532`) — what both platforms match calls against.
- Contacts whose only number isn't a clean 10-digit NANP number are skipped and counted in
  the run log.

It is a **reconcile, not an append**: new contacts are created, renamed or re-statused ones
updated, and ones that no longer qualify deleted. Nightly runs don't accumulate duplicates.

### De-duplication

The same owner often exists as more than one row — in both client lists, or twice inside
one. They'd sync as separate Google contacts sharing a number, and the phone would pick one
arbitrarily. So rows with an **identical set of dialable numbers** collapse into one entry.

- **The order of `SYNC_CLIENT_IDS` decides the winner** — Personal List is first, because
  that's the list actually worked out of, so its status is the current one. Ties inside one
  list break on lowest id, so the winner never flips between runs.
- Nothing is lost: the survivor's notes carry an `Also:` line naming each collapsed copy,
  its status, and its list.
- Matching is on the **whole** number set, not any shared number — relatives and spouses
  share a landline, and collapsing those would hide a genuinely different owner.

As of 2026-08-04 this takes **1,416 dialable contacts down to 1,318 entries**: 7 cross-list
pairs, and 91 rows across 70 duplicate groups *within* a single list. That second number is
a data-quality signal worth a look in the app — the sync hides those duplicates from your
phone but doesn't fix them in the CRM.

**Safety rule:** every contact this job creates is stamped with a `taraform_id` in the
People API `userDefined` field. Anything in that Google account *without* the stamp was
added by hand and is never modified or deleted. Even so, use a dedicated Google account —
not your personal one — so 1,500 land-owner contacts stay out of your real address book and
removing them is one toggle.

## One-time setup

### 1. Google Cloud project

1. <https://console.cloud.google.com/> → create a project (any name).
2. **APIs & Services → Library** → enable **People API**.
3. **APIs & Services → OAuth consent screen** → External. Fill in the required fields and
   add the `.../auth/contacts` scope.
4. > **Publish the app to "In production."** An app left in **Testing** issues refresh
   > tokens that **expire after 7 days**, and the sync dies silently every week. Publishing
   > without Google verification is fine here — you'll click past an "unverified app"
   > warning once, because you're the only user.
5. **Credentials → Create credentials → OAuth client ID → Desktop app.** Save the client ID
   and secret.

### 2. Mint the refresh token

Run locally, signing in as the Google account that will hold the contacts.

PowerShell (no inline `VAR=value` prefix — set them first):

```powershell
$env:GOOGLE_CLIENT_ID="xxx"
$env:GOOGLE_CLIENT_SECRET="yyy"
node scripts/phone-sync-authorize.mjs
```

bash:

```bash
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy node scripts/phone-sync-authorize.mjs
```

It opens a browser, catches the redirect, and prints the refresh token.

Because the app is published but unverified, Google shows **"Google hasn't verified this
app."** Click **Advanced → Go to … (unsafe)**. That's expected — you're the only user.

### 3. Supabase sync user

Create a Supabase user for the job and add it to both clients (via `add_client_member`).
Its reads go through RLS exactly like the app's, so CI never holds a `service_role` key.
Using your own login works too — the job only reads.

### 4. GitHub secrets

**Settings → Secrets and variables → Actions.** `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` already exist for the deploy workflow; add:

| Secret | Value |
| --- | --- |
| `SYNC_USER_EMAIL` | Supabase sync user's email |
| `SYNC_USER_PASSWORD` | its password |
| `GOOGLE_CLIENT_ID` | from step 1 |
| `GOOGLE_CLIENT_SECRET` | from step 1 |
| `GOOGLE_REFRESH_TOKEN` | from step 2 |

### 5. First run

**Actions → Sync contacts to Google → Run workflow**, with **dry run checked**. It reports
the create/update/delete plan without writing anything. If the numbers look right, run it
again unchecked.

### 6. Add the account to your iPhone

**Settings → Apps → Contacts → Accounts → Add Account → Google**, sign in as the dedicated
account, and turn **Contacts** on.

- Leave your personal account as the **default** account (Contacts → Default Account), so
  new contacts you create by hand don't land in the synced account — the reconcile would
  delete them, since they'd have no `taraform_id`.
- First sync can take a few minutes for ~1,500 contacts.

## Privacy note — this repo is public

GitHub Actions logs on a **public** repo are readable by anyone. Owner names and phone
numbers are client PII, so the runner prints **counts only when `CI`/`GITHUB_ACTIONS` is
set**, and withholds Google's error bodies (which can quote the field values that caused a
failure). Run locally for a per-contact preview.

If you'd rather nothing about this job be public, make the repo private — it stays free
either way. Private repos on the Free plan get 2,000 Actions minutes/month; this job uses
roughly 1–2 minutes a night, so about 60 minutes a month.

## Cost

Free, verified rather than assumed:

| Component | Usage | Allowance |
| --- | --- | --- |
| GitHub Actions | ~1–2 min/night | Unlimited on public repos; 2,000 min/month if private |
| Supabase egress | 205 kB/run → ~6 MB/month | 5 GB/month on the free tier (~0.1% used) |
| Google People API | ~3 calls/night steady state (~11 on first run) | Quota-based, not billed; no billing account required |

The People API is a Google Workspace API (like Gmail and Calendar) — limited by request
quotas rather than charged per call, and this job's volume is negligible against any of
them. **If Google ever asks you for a credit card during setup, stop** — that would mean
something changed, and nothing here is worth paying for.

## Running it by hand

```bash
node scripts/phone-sync.mjs --dry-run   # plan only
node scripts/phone-sync.mjs             # apply
```

Needs the same env vars as CI.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `invalid_grant` on token refresh | Refresh token expired or revoked. Almost always the OAuth app is still in **Testing** — publish to **In production** and re-run the authorize script. |
| Sync stopped running with no failures | GitHub disables scheduled workflows after **60 days without repo activity**. Push a commit, or trigger it manually to re-arm. |
| A contact rings unidentified | Check it has `has_good_phone = true` and its number is a 10-digit NANP number. Non-NANP numbers are reported as skipped in the run log. |
| Duplicate contacts on the phone | Usually the same person in both client lists — they're separate Taraform rows, so they sync as separate contacts by design. |
| A hand-added contact vanished | It was created in the *synced* account, so it had no `taraform_id`. Set your personal account as the Contacts default. |

## Code layout

| File | Role |
| --- | --- |
| `src/lib/phoneSync.js` | Pure logic — phone selection, name building, the diff. Unit-tested. |
| `src/lib/phoneSync.test.js` | 22 tests (`npm test`). |
| `scripts/phone-sync.mjs` | The runner: Supabase, OAuth, People API batching. |
| `scripts/phone-sync-authorize.mjs` | One-time refresh-token helper. |
| `.github/workflows/sync-contacts.yml` | Nightly schedule + manual dry-run trigger. |

The logic lives in `src/lib/` (rather than beside the runner) because vitest only collects
`src/**/*.test.js` — same reason `contactFilters.js` and `dedup.js` were extracted there.
