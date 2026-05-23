# Taraform Frontend

Multi-tenant SMS/email outreach CRM for land acquisition. Supabase direct DB, deployed to GitHub Pages (taraform.org) via CI on push to `main`. Primary client: Table Rock Partners (UUID: `f3a69c31-8e40-4ea0-865a-d8bd9214376d`).

Railway server: `https://taraform-server-production.up.railway.app` (repo: jsteryous/taraform-server)

## Routing

`HashRouter` (GitHub Pages). Contact detail is a full-screen overlay synced to `/#/contact/:id`; back button closes it via the URL sync effect in App.jsx.

## Multi-tenancy

> ⚠️ `getClients` on the Railway server may return all clients regardless of membership — RLS is the real enforcement layer. Verify server-side gating before adding new users.

## Subdirectory docs

Scoped guidance lives next to the code:

- `src/components/CLAUDE.md` — UI patterns (font tokens, Select, useConfirm, blur-to-save, check-css, CSV import)
- `src/context/CLAUDE.md` — AppContext split, pagination, filter state, focus-refresh, saveContact, showToast
- `src/lib/CLAUDE.md` — DB conventions (bigint id, sms_settings, contact_offers, custom fields, OAuth tokens)

## Remediation backlog

> Tracking list from a 2026-05-23 senior code review (whole-codebase pass). Tiers are priority order. When picking up work: read this list, re-confirm the top unchecked items still apply, then propose 1–3 to execute. Check items off (`[x]`) with the commit hash when done. Add new findings here rather than letting them float.

### Tier 1 — Security (do first; everything else is moot if tenant data leaks)
- [ ] **Audit & prove RLS** on every table the browser hits directly. The anon key ships in the public bundle (`deploy.yml` → `lib/supabase.js`), and tenant scoping is *only* a client-side `.eq('client_id', …)` — not a boundary. Confirm SELECT/INSERT/UPDATE/DELETE policies on `property_crm_contacts` and `contact_offers` are membership-gated. Note: `deleteContact` (`context/AppContext.jsx:257`) deletes by `id` with no client check, and `ImportModal.jsx` inserts straight into the table.
- [ ] **Add a proof test:** user A cannot read/update/delete user B's rows via the anon client. Keep it as a regression guard.
- [ ] **Close the `getClients` gap** (Railway `/api/clients` returns all clients regardless of membership — see Multi-tenancy note above). Gate server-side.

### Tier 2 — Correctness bugs / latent traps
- [ ] **Unify contact ID generation.** Single-add uses `Date.now()` bigint keys; `ImportModal.jsx:244-261` inserts with no `id` (DB default). Pick one owner — prefer DB-side identity/UUID — and delete the `Date.now()` path. (Same-ms collisions also possible on bulk ops.)
- [ ] **Normalize phones before dedup/merge.** Import compares `formatPhone`'d values (`ImportModal.jsx:223`) but `normalizePhone` (`utils.js:8`) isn't used in the match path → duplicate/missed merges on inconsistent formats.
- [ ] **De-duplicate the filter/export logic.** Note-activity filter is reimplemented in `ContactList` `filtered` memo, `App.jsx:45-57`, and `AppContext`. Collapse to one shared function (this is the documented root of past "Export All" breakage).

### Tier 3 — Safety nets (highest long-term leverage)
- [ ] **Add a test harness.** Start with pure data-layer fns: `applyContactFilters`, `mapDbContact`/`mapContactToDb`, import dedup (`buildLookupMaps`/`findDuplicate`). Then backfill a test for each "bitten" bug documented in the subdir CLAUDE.md files.
- [ ] **Adopt TypeScript incrementally**, starting in `src/lib/` (the snake_case↔camelCase mapping + bigint/jsonb shapes are where untyped bugs hide).

### Tier 4 — Maintainability & hygiene
- [ ] **Enforce or relax own conventions.** Violations of `components/CLAUDE.md`: native `confirm()` in `ManageClientsModal.jsx:39,331`; native `<select>` in `ImportModal.jsx:338,359,393` (rule says use `useConfirm()` / `<Select>`). Add a lint rule or fix the callsites.
- [ ] **Gate/remove production debug logging.** `lib/api.js:12` logs every request body (PII); also `ManageClientsModal.jsx:52,55` and auth handlers. Put behind a dev flag.
- [ ] **Decide the data-access boundary.** Contacts go direct-to-Supabase; offers/templates/settings go via Railway. The inconsistency is the documented root of `contact_offers.client_id` unreliability + the offers/status race. Pick a rule and apply it.
- [ ] **CSS strategy.** 1334-line global `index.css` policed by a custom `scripts/check-css.mjs`. Migrating to CSS Modules / scoped styles would retire the linter; lower priority.
- [ ] **Split large multi-concern components** (`EmailSettingsModal` 491, `ImportModal` 483, `ManageClientsModal` 430) — separate data hooks from presentation. Opportunistic, not urgent.

### Good as-is (don't "fix") 
Context data/UI split, `loadingRef` concurrency guard, ref-synced `setContacts`, O(1) import dedup, `useDraftSave` optimistic-save/revert, PostgREST error classification, and the CLAUDE.md docs themselves. Preserve these when refactoring.
