# Taraform Frontend

Multi-tenant SMS/email outreach CRM for land acquisition. React 18 + Vite + React Router, Supabase direct DB, deployed to GitHub Pages (taraform.org) via CI on push to `main`. Primary client: Table Rock Partners (UUID: `f3a69c31-8e40-4ea0-865a-d8bd9214376d`).

Railway server: `https://taraform-server-production.up.railway.app` (repo: jsteryous/taraform-server)

## Routing

`HashRouter` (GitHub Pages). All navigation via `useNavigate` — never `window.location`. Contact detail is a full-screen overlay synced to `/#/contact/:id`; back button closes it via the URL sync effect in App.jsx.

## Gotchas & required patterns

**Contacts are paginated 50/page.** `loadContacts(clientId, filters)` loads page 1; `loadMoreContacts` appends. All filters go as Supabase query params — never filter in JS. SMS activity filters (`sms_7/30/never`) are server-side via `last_sms_at`. Note filters (`note_7/30/never`) are client-side only — `activityLog` isn't in `LIST_FIELDS` so they only work on already-loaded contacts.

**`saveContact` is async and throws.** Always `await` it. Follow the optimistic update pattern in ContactDetail (`update`/`updateMultiple`/`updateCustomField`): apply locally, revert + `showToast` on catch.

**`custom_field_definitions` is a TEXT column** (not JSONB). Always parse with `parseCustomFieldDefs(raw)` from utils.js — never bare `JSON.parse`. Handles null, already-parsed arrays, and malformed JSON (returns `[]`).

**`getSetting` may return 404** for unseeded keys — use `Promise.allSettled` when loading multiple settings in parallel.

**`sms_settings` has no uniqueness constraint** on `(key, client_id)` — never `.upsert()` without `onConflict`. Use PUT /api/settings/:key on the server. Use `.maybeSingle()` on direct reads, never `.single()`.

**`contact_offers.client_id` is unreliable** (null on older rows). Always join through `property_crm_contacts` when filtering by client.

**`property_crm_contacts.id` is bigint.** `saveContact` upserts with `onConflict: 'id'` — always pass a numeric `id`. New contacts use `Date.now()` as a client-generated numeric ID (avoids sequence conflicts at timestamp scale). Never pass a string (e.g. UUID) — bigint column will reject it.

**No recursive `setSending` pattern.** If a send function owns a `setSending(true/false)` try/finally, inline any second API call — don't call the function recursively.

**CSV import:** Duplicate detection uses Map-based lookups (O(n+m)) — do not revert to `.filter()` scan (O(n²) freezes on large imports). Bulk inserts chunked at 500 rows.

**Config system:** All client-specific UI (statuses, colors, tabs, visible fields) comes from `resolveConfig(currentClient)` in `clientConfig.js`. Never hardcode status names or colors.

**AppContext callbacks** (`loadContacts`, `loadMoreContacts`, `loadFullContact`, `saveContact`, `deleteContact`) use refs (`loadingRef`, `contactsRef`) and functional setState to stay stable. Don't add state to their dep arrays. All have empty `[]` dep arrays with eslint-disable — this is intentional, don't "fix" it without understanding the ref pattern.

**All fields in ContactDetail save on blur, not on change.** Draft state updates on `onChange`; `update()`/`updateMultiField()` fires on `onBlur`. Don't revert to saving on `onChange`.

## Multi-tenancy

> ⚠️ `getClients` on the Railway server may return all clients regardless of membership — RLS is the real enforcement layer. Verify server-side gating before adding new users.

## Key DB notes

- `sms_settings` known keys: `automation_paused`, `email_automation_enabled`, `email_daily_limit`, `send_start_hour`, `send_end_hour`, `daily_limit`
- `email_tokens`: OAuth per client, provider `gmail` | `outlook`. Popup flow posts `GOOGLE_AUTH_SUCCESS/ERROR` or `MS_AUTH_SUCCESS/ERROR`.
