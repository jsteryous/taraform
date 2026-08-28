# Taraform Frontend

Multi-tenant CRM for land acquisition. Supabase direct DB (anon key + RLS, no backend server), deployed to GitHub Pages (taraform.org) via CI on push to `main`. Primary client: Table Rock Partners (UUID: `f3a69c31-8e40-4ea0-865a-d8bd9214376d`).

> **2026-06-10 — Railway decommissioned.** The Express server (`taraform-server-production.up.railway.app`, repo jsteryous/taraform-server) and its features (Twilio SMS, email automation/OAuth, Reoon verification) were removed to get hosting cost to $0. All data access is now direct-to-Supabase: clients/members via the RLS policies + SECURITY DEFINER RPCs in `db/20260610_clients_rls.sql`, offers/contacts via membership-gated table policies. Those tables were later **dropped** — `sms_messages`, `email_messages` and `sms_settings` are all gone (verified 2026-08-27; this file claimed otherwise until then). Texting came back 2026-08-27 as a Supabase-only build — see **Texting** below. Do not add features that require an always-on server without flagging the cost.

## Routing

`HashRouter` (GitHub Pages). Contact detail is a full-screen overlay synced to `/#/contact/:id`; back button closes it via the URL sync effect in App.jsx.

## Multi-tenancy

Enforced by RLS only (the anon key ships in the public bundle). `clients`/`contact_offers`/`property_crm_contacts` policies gate by membership rows in `client_users`; member management goes through SECURITY DEFINER RPCs (`create_client`, `get_client_members`, `add_client_member`, `remove_client_member`). Verified 2026-06-10 by role simulation: each user sees only their own clients, anon sees zero rows.

**Signup is enabled**, so anyone on the internet can obtain an `authenticated` JWT — assume the `authenticated` role is hostile, not trusted. Re-verified 2026-08-06 by simulating a fresh signup with zero memberships: `property_crm_contacts`, `contact_offers`, `clients`, `client_users`, `enriched_leads`, `referral_leads` and `subscribers` all return **0 rows**; `google_contact_sync` is DENIED outright. All four member RPCs re-read and confirmed to check the caller's own membership first (`remove_client_member` requires `owner`). The one thing a stranger *can* do is `create_client`, which makes them owner of a brand-new empty client — by design, and it's how onboarding works, since `add_client_member` resolves an existing `auth.users` row by email and therefore **requires the invitee to have signed up first**. Don't "fix" signup by disabling it; that breaks adding members. Enable CAPTCHA + leaked-password protection instead (Auth → Settings) if bot signups become a problem.

**`updated_at` on `property_crm_contacts` is set by the client, not a trigger.** There is exactly one trigger in the whole `public` schema (`enriched_leads_updated_at`); `update_updated_at` is attached to nothing and is dead code. Since `upsertContact`'s optimistic-concurrency guard asserts the last-read `updated_at`, any write path that forgets to bump it silently degrades that guard — and a write made outside the app (psql, a script, the Supabase table editor) won't bump it at all.

## Texting

Manual, one-at-a-time SMS from the contact overlay (Messages tab). No cron, no blasting.
Runbook + compliance model: `scripts/SMS.md`. Schema: `db/20260827_sms.sql` (applied).

**Every guard is SQL, in `sms_send_precheck()`.** Not React — the anon key is public, so a
check there is decoration. Not the Edge Function — it runs as `service_role` and bypasses
RLS, so it cannot be the tenancy boundary. Same precedent as `phone_sync_contacts_for()`.
The function returns a *reason*, which the UI shows; a bare boolean would leave the operator
unable to act on a block. Checks: membership → valid number → number is on that contact →
not `bad_phones` → not opted out → DNC clear or consent recorded → 8am-9pm recipient local →
under the daily cap. **All of them fail closed.**

**Nothing sends until an area code is DNC-scrubbed** (`scripts/load-dnc.mjs`). This is
deliberate: a number missing from `dnc_numbers` only means "unlisted" if we hold that area
code's file, so `dnc_area_codes` tracks coverage separately. Without it a partial download
silently reads as a clean bill of health for the whole country. 864 alone unblocks ~72% of
the list and the registry is free for 5 area codes.

**Provider is Telnyx**, switched from Twilio 2026-08-27 (`db/20260827_telnyx.sql`). Cost was
not the reason — at ~600 msgs/month the two are ~$3 apart. The vendor surface is deliberately
one `fetch` in `sms-send` and one signature check in `sms-inbound`; everything that decides
whether a message *may* be sent is in SQL and would survive another switch. Telnyx signs
webhooks with **Ed25519** over `${timestamp}|${rawBody}` (Twilio used HMAC-SHA1 over a URL),
so `sms-inbound` must read the **raw** body — re-serializing the parsed JSON breaks the
signature. Telnyx also does **not** auto-reply to STOP the way Twilio did.

**Two traps.** (1) `clients.sms_number`, renamed from `twilio_number` — the old name outlived
the vendor by two migrations. **No client has a number set**: the dead Twilio value on Table
Rock was cleared 2026-08-27 (`db/20260827_clear_stale_sms_number.sql`, which is now the only
record of what it was), and Personal List — the list actually worked out of — never had one.
Nothing sends until that is set. (2) `sms-inbound` must deploy with `--no-verify-jwt`, making
it the only publicly reachable function; its signature check is therefore load-bearing, not
defence in depth.

**Opt-outs key on the NUMBER, in `sms_opt_outs` — never on the contact row.** This was a
real bug, caught 2026-08-27 before anything shipped: **295 numbers sit on more than one
contact** (one on four), so the original per-contact flag would have honoured a STOP on one
card and kept the duplicates textable at the same number. Enforced in `sms_send_precheck()`
*above* the consent branch and again in `sms_record_outbound()` at write time, and written
before contact matching so an unmatchable STOP still suppresses. Nothing in the app reverses
it — not consent, not a later START (which unblocks at Twilio but not here).

`sms_is_stop()` has three tiers — exact carrier keywords, a trailing-"stop" tier, and
phrases — because people write "please stop texting me" and neither Twilio nor an exact
matcher catches that. Widened 2026-08-28: the old version missed **"please stop."** (tier 1
is anchored, and the phrase tier demanded an object like "stop texting"), bare **"remove
me"**, and **"wrong number"**, which is a stop request in every way that matters. Tuned to
over-match deliberately, but *not* with a bare `stop` — "you can stop by the property"
is a sentence this business really receives. A 35-case corpus, false positives included,
sits commented at the foot of `db/20260828_sms_inbox.sql`; re-run it after any edit.

**The regex is no longer the last line of defence.** `sms_send_precheck()` blocks on
`unread_reply`: a number with an unread inbound message cannot be texted until a human opens
the thread, which is what marks it read. That converts "we hope the matcher caught it" into
"a person saw it" — the property 47 CFR 64.1200(d) actually cares about — and it is why the
inbox below is a compliance component, not a convenience. `sms_opt_out_number()` (Opt out
button, in the thread and in the inbox) covers anyone who asks by phone or email.

**Every reply is visible in one place** (`db/20260828_sms_inbox.sql`). Until 2026-08-28 the
per-contact Messages tab was the *only* reader of `sms_messages`, so a reply announced itself
by nothing at all, and a reply from a number matching no contact (`contact_id` null) could
not be surfaced by any per-contact query. `sms_inbox()` + the header badge fix both;
`sms_unread_count()` is polled every 60s while the tab is visible, because inbound arrives by
webhook with nothing to push it to the browser. Un-attributable inbound now dead-letters to
`sms_unrouted` instead of being discarded — a non-empty table means `clients.sms_number` is
unset or stale, which the inbox says in as many words.

**HELP is answered automatically**, once per number per day, never after a STOP. CTIA
Messaging Principles require it on a 10DLC campaign and Telnyx sends nothing on its own. The
decision is made in `sms_record_inbound()` (so it obeys the same suppression rules as
everything else) and only carried out in `sms-inbound`. Text is `clients.sms_help_text`,
falling back to the client name. This is the one outbound path with `sent_by` null, which is
also how the once-a-day guard recognises its own messages.

**Recreating a SECURITY DEFINER function drops its REVOKEs.** `CREATE OR REPLACE` keeps
grants; `DROP` + `CREATE` resets EXECUTE to PUBLIC. Changing `sms_record_inbound`'s return
type on 2026-08-28 therefore made it briefly callable by `anon` — i.e. forgeable replies and
forged STOPs from anyone holding the public bundle's key. Caught by re-checking
`has_function_privilege` after the migration; **do that check every time**. Same family as
the "a policy named for a role is not scoped to that role" lesson in Tier 1.

**There is no automated sending and adding one is a decision, not a refactor.** No cron job
touches SMS (`cron.job` holds only `phone-sync-nightly`), and `sms-send` requires a user JWT
per message. The manual-send property is what makes best-effort STOP detection acceptable.

## Subdirectory docs

Scoped guidance lives next to the code:

- `src/components/CLAUDE.md` — UI patterns (font tokens, Select, useConfirm, blur-to-save, check-css, CSV import)
- `src/context/CLAUDE.md` — AppContext split, pagination, filter state, focus-refresh, saveContact, showToast
- `src/lib/CLAUDE.md` — DB conventions (bigint id, sms_settings, contact_offers, custom fields, OAuth tokens)

## Remediation backlog

> Tracking list from a 2026-05-23 senior code review (whole-codebase pass). Tiers are priority order. When picking up work: read this list, re-confirm the top unchecked items still apply, then propose 1–3 to execute. Check items off (`[x]`) with the commit hash when done. Add new findings here rather than letting them float.

### Tier 0 — Durability (the data has no backup; that outranks everything)
- [ ] **Finish wiring the nightly backup.** Built 2026-08-06 (`.github/workflows/backup.yml` + `db/RESTORE.md`) but **inert until three things exist**: a private `jsteryous/taraform-backups` repo, repo variable `BACKUP_REPO`, and secrets `BACKUP_REPO_TOKEN` + `SUPABASE_DB_URL`. Setup steps are at the bottom of `db/RESTORE.md`. Until then **there is no backup of this database at all** — the org is on the Supabase **Free plan**, which gets no platform backups and no PITR; Supabase's own docs tell free-tier users to dump their own data. Dumps must go to a *separate private* repo: this repo is public, and Actions artifacts are world-readable on a public repo. Then do a restore drill into a throwaway project — an untested backup is a rumour.
- [ ] **Consider the Pro plan ($25/mo).** Buys daily platform backups, PITR as an add-on, and stops the 7-day inactivity pause. Breaks the documented "$0 hosting" constraint, so it's a judgment call — but the CRM is the business asset, and self-managed dumps are strictly worse than platform backups.

### Tier 1 — Security (do first; everything else is moot if tenant data leaks)
- [x] **Revoke anonymous write on the blog tables** — done 2026-08-06 (`db/20260806_fix_anon_write_policies.sql`). `image_library`, `insights` and `used_topics` each carried two policies *named* for service_role — `"service role full access"` and `"service_rw"` — but declared `TO public` with `USING (true)`/`WITH CHECK (true)`. `public` includes `anon`, and the anon key ships in the public bundle, so **anyone on the internet, with no login at all, could INSERT/UPDATE/DELETE those tables.** Proven as role `anon`, rolled back: `delete from image_library` → 183 rows, `delete from used_topics` → 13 rows, insert ALLOWED. The policies were also useless for their stated purpose — service_role *bypasses* RLS and never needed one; they only granted access to the roles they were meant to exclude. Replaced with `for select to anon, authenticated` (public reads preserved — this repo never touches these tables, they belong to the separate blog/marketing project, which may read them with the anon key). Re-probed after: reads 183/13 still fine, deletes 0, updates 0, insert `BLOCKED(42501)`. **Lesson worth generalizing: a policy named for a role is not scoped to that role. Grep for `TO public` before trusting a policy name.**
- [x] **Close the cross-tenant INSERT hole** — done 2026-08-06 (`db/20260806_close_cross_tenant_insert.sql`). `property_crm_contacts` carried **two** permissive ALL policies, and Postgres ORs permissive policies: alongside the membership policy sat a legacy `"Users see only their contacts"` (`auth.uid() = user_id`) whose `WITH CHECK` passed for *any* `client_id`. So any authenticated user could INSERT rows into any client's list — reachable from the internet, since the anon key ships in the public bundle and the client UUIDs are published in this **public** repo (`CLAUDE.md`, `db/20260804_trp_live_deals_to_personal_list.sql`). Not a leak: reads/updates/deletes of existing rows were correctly blocked. Proven both ways by role simulation as the TRP owner against Personal List, rolled back: before `insert=ALLOWED`, after `insert=BLOCKED(42501)`, with `readable=0` throughout. **Ordering trap:** 14 contacts had `client_id IS NULL` and were visible *only* through the legacy policy, so they had to be adopted into a client before it could be dropped — they were pre-multi-tenancy test rows (all "New Lead", no phones, no offers, one named "Test Save"), now in Personal List; the delete one-liner is in the migration. `client_id` is now `NOT NULL` on both `property_crm_contacts` and `contact_offers`.
- [x] **Audit & prove RLS** — done 2026-06-10 (Railway decommission). Audited `pg_policies`: `property_crm_contacts` and `contact_offers` already had membership-gated ALL policies; added the missing `clients` policies + member-management RPCs (`db/20260610_clients_rls.sql`). Proven by role simulation (authenticated-as-user-A vs user-B vs anon). `deleteContact`-by-id and ImportModal inserts are now bounded by RLS.
- [x] **Add a proof test:** user A cannot read/update/delete user B's rows via the anon client — scaffolded 2026-06-13 (`f9b9cce`) in `src/lib/rls.proof.test.js`. Self-skips unless `RLS_TEST_*` creds are in env (see file header). **Still TODO:** seed two throwaway test users + set the `RLS_TEST_*` GitHub secrets so it actually executes — right now it's a skipped guard, not a running one. As of 2026-08-05 CI runs the suite and will fail loudly on a missing-creds run once `RLS_TEST_REQUIRED=1` is set in `deploy.yml`; the seeding is the last step. This is the highest-value unchecked item in the file — RLS is the *only* authorization boundary in the app, so an unproven RLS is an unproven tenancy model.
- [x] **Close the `getClients` gap** — done 2026-06-10: the Railway endpoint no longer exists; `getClients` is a direct `clients` select gated by RLS.

### Tier 2 — Correctness bugs / latent traps
- [x] **Unify contact ID generation** — done 2026-06-13 (`db/20260613_id_defaults.sql` + app). `property_crm_contacts.id` was already sequence-backed (`nextval`); the app's `Date.now()` had been overriding it. `contact_offers.id` had no default — attached `GENERATED BY DEFAULT AS IDENTITY` and advanced both sequences past existing rows. Removed `Date.now()` from `AddContactModal` + `addOffer`; `saveContact` now inserts new contacts id-less and reads the generated id back. ImportModal already inserted id-less, so all paths now agree.
- [x] **Normalize phones before dedup/merge** — done 2026-06-12: `handlePreview`'s phone-merge path compares `normalizePhone`'d digits instead of formatted strings.
- [x] **De-duplicate the filter/export logic** — done 2026-06-13 (`3ace9c0`). Extracted `filterByNoteActivity` into `contactFilters.js` (next to `applyContactFilters`); `ContactList.filtered` and `App.handleExport` now both call it. SMS-activity filtering was already centralized server-side in `applyContactFilters`. +7 regression tests.
- [x] **Unify the filter boundary (push phone/note server-side)** — done 2026-07-13 (`db/20260713_filter_columns.sql`). Phone "has/missing" and note-activity had been filtered in JS after the fetch, which drifted the result count / pagination / CSV export from the actual filter. Added `has_good_phone` + `last_note_at` STORED generated columns (IMMUTABLE `compute_*` fns replicating `normalizePhone` + note-detection); `applyContactFilters` now filters both at the DB. Client-side `contactMatchesFilters` (with `matchesNoteActivity`/`hasGoodPhone`) survives **only** as the detail-overlay drift re-check, kept in sync with the SQL. `activity_log`/`bad_phones` stay in `LIST_FIELDS` to feed that re-check. Verified on prod data (2194 rows; 9 all-struck contacts now correctly excluded from "has phone").

- [x] **Delete the client-side filter mirror** — done 2026-08-05. The same filter predicates existed three times: PostgREST clauses in `applyContactFilters`, IMMUTABLE SQL in `compute_has_good_phone`/`compute_last_note_at`, and a per-contact JS copy (`contactMatchesFilters` + `matchesNoteActivity` + `hasGoodPhone`) that `ContactList.filtered` ran on every render, kept in agreement by hand and by comments saying "keep the two in sync". The JS copy existed only to drop a row edited in the detail overlay without a refetch. Replaced by `contactStillMatches(id, clientId, filters)` — the *same* `applyContactFilters` query narrowed to one id — called fire-and-forget from `saveContact` via `dropIfDrifted`, so drift is decided by the thing that defined the filter in the first place. `ContactList` now renders `contacts` as-is. `isFollowUpDue` survives for the ContactDetail "Due" badge only and is no longer part of the filter boundary. Net: three implementations → two, and the remaining two can't disagree about the list.
- [x] **Move the non-React code out of `AppContext`** — done 2026-08-05. `buildQuery`, `classifyError`, `fetchAllFilteredContacts`, `fetchContactsByIds`, `LIST_FIELDS`/`PAGE_SIZE` and all the inline `supabase.from(...)` calls lived in a React context module. Now `src/lib/contacts.js` (contact reads/writes) + `src/lib/errors.js` (`classifyError`), leaving `AppContext` as state and orchestration — 298 → ~210 lines. `lib/` is the data layer; `api.js` keeps clients/members/offers. Two stragglers still query Supabase directly from components: `StatsBar.jsx` and `ImportModal.jsx`.

- [x] **Fix dedup reading one page instead of the corpus** — done 2026-08-05. Found while auditing for the pattern behind the filter mirror: *the client holding a partial copy of server state and reasoning over it as if complete*. `ImportModal.handlePreview` built its lookup maps from `useApp().contacts` — one 50-row page — so a CSV import compared each row against ~50 of 2,194 contacts and inserted the rest as duplicates. `AddContactModal.findDuplicates` had the identical bug. Both were also blind to address matches entirely, since `property_addresses` isn't in `LIST_FIELDS`. Added `fetchDedupIndex(clientId)` (full key set, paged) and `fetchDuplicateCandidates(clientId, contact)` (targeted `or()` probe) to `lib/contacts.js`; the pure matching rules in `dedup.js` are unchanged, the server now supplies recall and they supply precision. +5 tests. **Audited the rest of the pattern:** `Dashboard` and `StatsBar` query the DB directly and are correct; `ContactList`'s county pool is a known, harmless partial. Rule written up in `src/components/CLAUDE.md`.

- [x] **Guard concurrent edits** — done 2026-08-06. `saveContact` was a full-row upsert with no precondition: two people editing one contact was last-write-wins with no error, and because `activity_log` is rewritten wholesale rather than appended, a note logged at the same time simply disappeared. Silent data loss — impossible at one user, live at two, and signup is open. `upsertContact` is now an `UPDATE` asserting the last-read `updated_at`, throwing `ContactConflictError` on a mismatch; `useDraftSave` reverts the edit and says what happened instead of "try again". Versions live in `versionsRef` (AppContext), not on the contact, because `useDraftSave` stamps an optimistic local `updatedAt`. Per-contact save queue stops blur-to-save writes from conflicting with themselves. +4 tests. **Further improvement if this ever matters more:** append notes via an RPC instead of rewriting the jsonb array, so concurrent notes merge rather than one editor losing the race.

### Tier 3 — Safety nets (highest long-term leverage)
- [x] **Add a test harness** — done 2026-06-13 (`f9b9cce`). Vitest + `npm test`; 41 passing tests over the pure data-layer fns (`applyContactFilters`, `mapDbContact`/`mapContactToDb`, `normalizePhone`/`normalizeCounty`, `parseCSV`, import dedup). `applyContactFilters` and the dedup fns were extracted to `src/lib/contactFilters.js` + `src/lib/dedup.js` to make them importable. **Next:** backfill a regression test per "bitten" bug in the subdir CLAUDE.md files (TDZ ordering, Export-All filter drift, offers/status race).
- [x] **Run the tests in CI** — done 2026-08-05. `deploy.yml` now runs `npm test` before `npm run build`, so a red suite blocks the deploy instead of shipping silently. (The gap was real: `npm test` had been failing since `4e82311` — the shebang in `sync-edge-shared.mjs` broke collection of `edgeShared.test.js` — and nobody noticed for a day, because the only thing that would have said so was a command you have to type.) The step passes the `RLS_TEST_*` secrets through, and `rls.proof.test.js` honours a new `RLS_TEST_REQUIRED` env var that turns "no creds → silently skip" into "no creds → red build". **Still TODO:** seed the two throwaway users (below), set the secrets, then flip `RLS_TEST_REQUIRED` to `'1'` in `deploy.yml`. Until then CI emits a `::warning::` on the run summary instead.
- [ ] **Adopt TypeScript incrementally**, starting in `src/lib/` (the snake_case↔camelCase mapping + bigint/jsonb shapes are where untyped bugs hide).

### Tier 4 — Maintainability & hygiene
- [ ] **Enforce or relax own conventions.** Both native `confirm()` calls in `ManageClientsModal` were fixed 2026-08-06 (see the delete-guard entry below). Still open: native `<select>` in `ImportModal.jsx:338,359,393` (rule says use `<Select>`). Add a lint rule or fix the callsites.
- [x] **Guard the client-delete cascade** — done 2026-08-06. `deleteClient` sat behind a native `confirm()`, one reflexive Enter away from cascading a client's entire contact and offer set into nothing, permanently — the FKs are `ON DELETE CASCADE` and there is no backup. Now counts the rows first (`getClientDataCounts`) and says exactly what will be destroyed, then requires the client's name typed out. `useConfirm()` gained an optional `requireText` for this; the member-removal `confirm()` moved to `useConfirm()` too, clearing the convention violation above.
- [ ] **Gate/remove production debug logging.** The `lib/api.js` request-body logging died with the Railway client; `ManageClientsModal.jsx:52,55` and auth handlers still log. Put behind a dev flag.
- [x] **Decide the data-access boundary** — resolved 2026-06-10: everything is direct-to-Supabase now; the Railway path no longer exists.
- [ ] **CSS strategy.** Global `index.css` policed by a custom `scripts/check-css.mjs`. Migrating to CSS Modules / scoped styles would retire the linter; lower priority.
- [ ] **Split large multi-concern components** (`ImportModal` 483, `ManageClientsModal` ~420) — separate data hooks from presentation. Opportunistic, not urgent.
- [x] **Multi-user phone contact sync** — built 2026-08-04, **deployed and live** (this entry said "not yet deployed" until 2026-08-06; it was wrong and cost an investigation). `phone-sync-run` is ACTIVE at **v5** (carrying `withoutPersonalNumbers`, deployed 2026-08-06), the `google_contact_sync` table holds one connected user, and `cron.job` id 1 `phone-sync-nightly` runs `0 8 * * *` UTC and is **active**. Note the table is `google_contact_sync`, **not** `phone_sync_*` — grepping the DB for `phone_sync%` finds nothing and looks like it was never deployed. Verified end to end 2026-08-06 via `select public.phone_sync_dispatch()`: `skipped_personal: 5`, `created/updated/deleted: 0`, `untouched: 99`, `last_error: null`. Deploy with `SUPABASE_ACCESS_TOKEN=<pat> npx supabase functions deploy phone-sync-run --project-ref ykuenmwfxecmmqichwit` (no Docker needed; the CLI bundles `_shared/` automatically). `skipped_personal` in `last_stats` is the cheapest proof of which code version actually ran. Any user can now connect their own Google account (phone icon in the header) and get nightly caller ID for the contacts RLS says they can see. Supabase Edge Functions + `pg_cron` + Vault-held refresh tokens; still $0, still no always-on server. Runbook + design: `scripts/PHONE_SYNC_MULTIUSER.md`. Two things to know before touching it: (1) the Edge Function runs as `service_role` and *bypasses RLS*, so the tenancy boundary is `phone_sync_contacts_for()` plus the grant list in `db/20260804_google_contact_sync.sql` — never grant a `phone_sync_*` function to `authenticated`; (2) `supabase/functions/_shared/` is **generated** from `src/lib/` by `npm run sync:edge`, and `npm test` fails if it drifts. **This is now the only sync** — the single-operator path (`scripts/phone-sync.mjs`, `phone-sync-authorize.mjs`, `sync-contacts.yml`, `PHONE_SYNC.md`) was retired 2026-08-06 as a second writer on the same Google account plus a standing credential; recover from git history if ever needed. It was also the only bulk-undo (`--purge`); the replacement is to disconnect, then delete the `Taraform` label's contents in Google Contacts.
- [x] **Stop synced leads from renaming personal contacts** — done 2026-08-06. The sync writes into the operator's **personal** Google account (the workflow comment claimed "a dedicated Google account"; it never was), so lead cards sit beside real contacts. Phones unify cards sharing a number — iOS links, Android aggregates — and the merged contact shows whichever name the OS picks, so a lead card renamed a real contact to "Nicholas Whitaker (Dead/Pass)" and swapped its photo. Five were shadowed. `withoutPersonalNumbers` (`src/lib/phoneSync.js`) now drops any lead whose number is already on a card the sync doesn't own: caller ID already worked for those, so the lead card added nothing but the collision. Self-healing — because `diffContacts` reconciles, dropping them from `desired` deletes the cards earlier runs created (verified live: 1327 → 1322, zero collisions, the 99 personal cards untouched). +6 tests. **Unrelated to this but worth knowing:** turning on Google Contacts sync on the phone also pulls down the operator's own pre-existing Google contacts, including 34 stale phone-less cards that then link to and shadow the real iCloud/device ones. That is not something the sync can fix — the cards predate it by years — and is the actual cause if a personal contact's name changes without a `taraform_id` on it.
- [x] **Deep-link the synced phone contacts back into the app** — done 2026-08-04. `buildPerson` in `src/lib/phoneSync.js` now emits `urls: [{ value: contactUrl(id) }]`, added to `PERSON_FIELDS`, `UPDATE_MASK` and `personSignature` (the last one matters: without it the diff can't see the field, so contacts synced before the link existed would never gain one). Makes a synced contact tappable from the phone straight to its contact overlay — the closest free thing to a "call from X" popup, since no browser can see incoming call state. +3 tests.

- [ ] **Finish wiring texting.** All code is written and applied — `db/20260827_sms.sql`,
  `db/20260827_sms_optout_hardening.sql`, `db/20260827_telnyx.sql` and
  `db/20260828_sms_inbox.sql` are live on the database, Messages tab + inbox are built, 179
  tests green. **Inert until four external things exist**, none of them code:
  1. ~~Deploy the two Edge Functions.~~ **Done 2026-08-28.** Both ACTIVE at v1:
     `sms-inbound` with `verify_jwt: false` (it is now genuinely the only publicly reachable
     function in the project), `sms-send` with `verify_jwt: true`. Probed live afterwards:
     unsigned POST → 403, forged signature → 403, GET → 405, `sms-send` without a JWT → 401,
     and **zero rows written** by the forgery attempts. The signature check is load-bearing
     and it holds.
  2. **Set the secrets** — `TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY` (different keys, see
     `scripts/SMS.md`). **Neither is set**, confirmed 2026-08-28 by probing `sms-send`, which
     answers 503 "Texting is not configured". The consequence is the one that matters:
     without `TELNYX_PUBLIC_KEY` every webhook fails the signature check, so `sms-inbound`
     returns 403 to *real* Telnyx events and **inbound STOP is still not being received**.
     Deployed-but-keyless is fail-closed, not finished. Easiest route is the dashboard
     (Project Settings → Edge Functions → Secrets), no PAT needed. A Messaging Profile left
     on webhook API **v1** fails the same way and just as silently. The cheapest proof either
     way is to text yourself, reply STOP, and confirm a row in `sms_opt_outs`.
  3. **Set `clients.sms_number` on Personal List.** All four clients are still null.
  4. **Load a DNC area code** (`scripts/load-dnc.mjs`, start with 864). `dnc_area_codes` and
     `dnc_numbers` are both empty, so every send is blocked by design — the feature, not a
     bug.
  Also worth setting `clients.sms_help_text` per client; it falls back to the client name.
  Motivation: cold calling alone was taking ~5,000 dials per deal, which is not reachable
  solo.

### Good as-is (don't "fix") 
Context data/UI split, `loadingRef` concurrency guard, ref-synced `setContacts`, O(1) import dedup, `useDraftSave` optimistic-save/revert, PostgREST error classification, and the CLAUDE.md docs themselves. Preserve these when refactoring.
