# Taraform Frontend

Multi-tenant CRM for land acquisition. Supabase direct DB (anon key + RLS, no backend server), deployed to GitHub Pages (taraform.org) via CI on push to `main`. Primary client: Table Rock Partners (UUID: `f3a69c31-8e40-4ea0-865a-d8bd9214376d`).

> **2026-06-10 — Railway decommissioned.** The Express server (`taraform-server-production.up.railway.app`, repo jsteryous/taraform-server) and its features (Twilio SMS, email automation/OAuth, Reoon verification) were removed to get hosting cost to $0. All data access is now direct-to-Supabase: clients/members via the RLS policies + SECURITY DEFINER RPCs in `db/20260610_clients_rls.sql`, offers/contacts via membership-gated table policies. Historical SMS/email data remains in the DB (`sms_messages`, `email_messages`, …) but has no UI. Do not add features that require an always-on server without flagging the cost.

## Routing

`HashRouter` (GitHub Pages). Contact detail is a full-screen overlay synced to `/#/contact/:id`; back button closes it via the URL sync effect in App.jsx.

## Multi-tenancy

Enforced by RLS only (the anon key ships in the public bundle). `clients`/`contact_offers`/`property_crm_contacts` policies gate by membership rows in `client_users`; member management goes through SECURITY DEFINER RPCs (`create_client`, `get_client_members`, `add_client_member`, `remove_client_member`). Verified 2026-06-10 by role simulation: each user sees only their own clients, anon sees zero rows.

## Subdirectory docs

Scoped guidance lives next to the code:

- `src/components/CLAUDE.md` — UI patterns (font tokens, Select, useConfirm, blur-to-save, check-css, CSV import)
- `src/context/CLAUDE.md` — AppContext split, pagination, filter state, focus-refresh, saveContact, showToast
- `src/lib/CLAUDE.md` — DB conventions (bigint id, sms_settings, contact_offers, custom fields, OAuth tokens)

## Remediation backlog

> Tracking list from a 2026-05-23 senior code review (whole-codebase pass). Tiers are priority order. When picking up work: read this list, re-confirm the top unchecked items still apply, then propose 1–3 to execute. Check items off (`[x]`) with the commit hash when done. Add new findings here rather than letting them float.

### Tier 1 — Security (do first; everything else is moot if tenant data leaks)
- [x] **Audit & prove RLS** — done 2026-06-10 (Railway decommission). Audited `pg_policies`: `property_crm_contacts` and `contact_offers` already had membership-gated ALL policies; added the missing `clients` policies + member-management RPCs (`db/20260610_clients_rls.sql`). Proven by role simulation (authenticated-as-user-A vs user-B vs anon). `deleteContact`-by-id and ImportModal inserts are now bounded by RLS.
- [ ] **Add a proof test:** user A cannot read/update/delete user B's rows via the anon client. Keep it as a regression guard. (One-off simulation was run 2026-06-10; an automated test is still missing.)
- [x] **Close the `getClients` gap** — done 2026-06-10: the Railway endpoint no longer exists; `getClients` is a direct `clients` select gated by RLS.

### Tier 2 — Correctness bugs / latent traps
- [ ] **Unify contact ID generation.** Single-add uses `Date.now()` bigint keys; `ImportModal.jsx:244-261` inserts with no `id` (DB default). Pick one owner — prefer DB-side identity/UUID — and delete the `Date.now()` path. (Same-ms collisions also possible on bulk ops.)
- [ ] **Normalize phones before dedup/merge.** Import compares `formatPhone`'d values (`ImportModal.jsx:223`) but `normalizePhone` (`utils.js:8`) isn't used in the match path → duplicate/missed merges on inconsistent formats.
- [ ] **De-duplicate the filter/export logic.** Note-activity filter is reimplemented in `ContactList` `filtered` memo, `App.jsx:45-57`, and `AppContext`. Collapse to one shared function (this is the documented root of past "Export All" breakage).

### Tier 3 — Safety nets (highest long-term leverage)
- [ ] **Add a test harness.** Start with pure data-layer fns: `applyContactFilters`, `mapDbContact`/`mapContactToDb`, import dedup (`buildLookupMaps`/`findDuplicate`). Then backfill a test for each "bitten" bug documented in the subdir CLAUDE.md files.
- [ ] **Adopt TypeScript incrementally**, starting in `src/lib/` (the snake_case↔camelCase mapping + bigint/jsonb shapes are where untyped bugs hide).

### Tier 4 — Maintainability & hygiene
- [ ] **Enforce or relax own conventions.** Violations of `components/CLAUDE.md`: native `confirm()` in `ManageClientsModal.jsx:39,331`; native `<select>` in `ImportModal.jsx:338,359,393` (rule says use `useConfirm()` / `<Select>`). Add a lint rule or fix the callsites.
- [ ] **Gate/remove production debug logging.** The `lib/api.js` request-body logging died with the Railway client; `ManageClientsModal.jsx:52,55` and auth handlers still log. Put behind a dev flag.
- [x] **Decide the data-access boundary** — resolved 2026-06-10: everything is direct-to-Supabase now; the Railway path no longer exists.
- [ ] **CSS strategy.** Global `index.css` policed by a custom `scripts/check-css.mjs`. Migrating to CSS Modules / scoped styles would retire the linter; lower priority.
- [ ] **Split large multi-concern components** (`ImportModal` 483, `ManageClientsModal` ~420) — separate data hooks from presentation. Opportunistic, not urgent.

### Good as-is (don't "fix") 
Context data/UI split, `loadingRef` concurrency guard, ref-synced `setContacts`, O(1) import dedup, `useDraftSave` optimistic-save/revert, PostgREST error classification, and the CLAUDE.md docs themselves. Preserve these when refactoring.
