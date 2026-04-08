# Taraform Frontend

Multi-tenant SMS/email outreach CRM for land acquisition. React 18 + Vite + React Router, Supabase direct DB, deployed to GitHub Pages (taraform.org) via CI on push to `main`. Primary client: Table Rock Partners (UUID: `f3a69c31-8e40-4ea0-865a-d8bd9214376d`).

Supabase credentials in `.env.local` (gitignored). Security enforced by RLS — never hardcode credentials.

Railway server: `https://taraform-server-production.up.railway.app` (repo: jsteryous/taraform-server)

## Routing

Uses `HashRouter` (GitHub Pages compatible). Routes: `/#/` (list), `/#/contact/:id` (detail overlay), `/#/dashboard`. All navigation via `useNavigate` — never manipulate `window.location` for these paths. Contact detail is a full-screen overlay, not a separate page. Back button closes it via the URL sync effect in App.jsx.

## Gotchas & required patterns

**Contacts are paginated 50/page.** `loadContacts(clientId, filters)` loads page 1; `loadMoreContacts` appends. All filters go as Supabase query params — never filter in JS. SMS activity filters (`sms_7/30/never`) are server-side via `last_sms_at`. Note filters (`note_7/30/never`) are client-side only — `activityLog` isn't in `LIST_FIELDS` so they only work on already-loaded contacts.

**Filter state lives in AppContext**, not App.jsx — all 6 filters (`filterSearch`, `filterStatuses`, `filterCounties`, `filterPhone`, `filterActivity`, `filterEmail`) reset automatically when `currentClientId` changes.

**`saveContact` is async and throws.** Always `await` it. Follow the optimistic update pattern in ContactDetail (`update`/`updateMultiple`/`updateCustomField`): apply locally, revert + `showToast` on catch.

**`custom_field_definitions` is a TEXT column** (not JSONB). Always parse with `parseCustomFieldDefs(raw)` from utils.js — never bare `JSON.parse`. Handles null, already-parsed arrays, and malformed JSON (returns `[]`).

**All Railway calls go through `src/lib/api.js`.** Never call `fetch()` directly for Railway endpoints. `getSetting` may return 404 for unseeded keys — use `Promise.allSettled` when loading multiple settings in parallel.

**`sms_settings` has no uniqueness constraint** on `(key, client_id)` — never `.upsert()` without `onConflict`. Use select-then-update/insert (PUT /api/settings/:key on the server). Use `.maybeSingle()` on direct reads, never `.single()`.

**`contact_offers.client_id` is unreliable** (null on older rows). Always join through `property_crm_contacts` when filtering by client.

**`property_crm_contacts.id` is bigint** with a sequence default. Never pass `id` manually on insert.

**No recursive `setSending` pattern.** If a send function owns a `setSending(true/false)` try/finally, inline any second API call — don't call the function recursively. The outer `finally` fires after the inner call completes.

**CSV import:** Duplicate detection uses Map-based lookups (O(n+m)) — do not revert to `.filter()` scan (O(n²) freezes on large imports). Bulk inserts chunked at 500 rows.

**Config system:** All client-specific UI (statuses, colors, tabs, visible fields) comes from `resolveConfig(currentClient)` in `clientConfig.js`. Never hardcode status names or colors.

**Error feedback:** `showToast` from `useApp()` for all user-facing errors — never `alert()`.

**AppContext callbacks** (`loadContacts`, `loadMoreContacts`, `loadFullContact`, `saveContact`, `deleteContact`) use refs (`loadingRef`, `contactsRef`) and functional setState to stay stable. Don't add state to their dep arrays.

## Multi-tenancy

Access gated by Supabase RLS on `property_crm_contacts` and `contact_offers`. `client_users` maps users to clients (role: `owner` | `member`; RLS: `user_id = auth.uid()`).

> ⚠️ `getClients` on the Railway server may return all clients regardless of membership — RLS is the real enforcement layer. Verify server-side gating before adding new users.

## Key DB notes

- `clients.config` — JSONB: type, terminology, statuses, statsPills, tabs, visibleFields, listColumns
- `clients.custom_field_definitions` — TEXT: JSON array string `[{"key":"acreage","label":"Acreage"}]`
- `sms_settings` known keys: `automation_paused`, `email_automation_enabled`, `email_daily_limit`, `send_start_hour`, `send_end_hour`, `daily_limit`
- `email_tokens`: OAuth per client, provider `gmail` | `outlook`. Popup flow posts `GOOGLE_AUTH_SUCCESS/ERROR` or `MS_AUTH_SUCCESS/ERROR`.
