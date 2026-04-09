# Taraform Frontend

Multi-tenant SMS/email outreach CRM for land acquisition. Supabase direct DB, deployed to GitHub Pages (taraform.org) via CI on push to `main`. Primary client: Table Rock Partners (UUID: `f3a69c31-8e40-4ea0-865a-d8bd9214376d`).

Railway server: `https://taraform-server-production.up.railway.app` (repo: jsteryous/taraform-server)

## Routing

`HashRouter` (GitHub Pages). Contact detail is a full-screen overlay synced to `/#/contact/:id`; back button closes it via the URL sync effect in App.jsx.

## UI patterns

- **Font sizes:** Use CSS tokens (`--text-2xs` → `--text-xl` defined in `:root`) — never arbitrary `rem` values. `check-css` enforces this.
- **Icons:** Use Lucide React — never emoji icons.
- **Selects:** Use `<Select>` from `shared/Select.jsx` — never native `<select>`.
- **Confirms:** Use `useConfirm()` from `shared/ConfirmDialog.jsx` — never `confirm()`.
- **Config:** All client-specific UI (statuses, colors, tabs, visible fields) comes from `resolveConfig(currentClient)` in `clientConfig.js`. Never hardcode status names or colors.
- **Blur-to-save:** All fields in ContactDetail save on blur, not on change. Draft state updates on `onChange`; `update()` / `updateMultiple()` / `updateCustomField()` fire on `onBlur`. (`updateMultiField` is a helper that wraps `update` for array-typed fields.)
- **CSS/JSX sync:** Run `npm run check-css` after adding or renaming a `className`. Flags missing classes and raw rem font-sizes (both exit 1). Dead CSS is informational only.

## Gotchas

**Contacts are paginated 50/page.** `loadContacts(clientId, filters)` loads page 1; `loadMoreContacts` appends. All filters go as Supabase query params — never filter in JS. SMS activity filters (`sms_7/30/never`) are server-side via `last_sms_at`. Note filters (`note_7/30/never`) are client-side only — `activityLog` isn't in `LIST_FIELDS`.

**`saveContact` is async and throws.** Always `await` it. Follow the optimistic update pattern in ContactDetail (`update`/`updateMultiple`/`updateCustomField`): apply locally, revert + `showToast` on catch.

**`custom_field_definitions` is a TEXT column** (not JSONB). Always parse with `parseCustomFieldDefs(raw)` from utils.js — never bare `JSON.parse`.

**`getSetting` may return 404** for unseeded keys — use `Promise.allSettled` when loading multiple settings in parallel.

**`sms_settings` has no uniqueness constraint** on `(key, client_id)` — never `.upsert()` without `onConflict`. Use PUT /api/settings/:key on the server. Use `.maybeSingle()` on direct reads, never `.single()`.

**`contact_offers.client_id` is unreliable** (null on older rows). Always join through `property_crm_contacts` when filtering by client.

**`property_crm_contacts.id` is bigint.** New contacts use `Date.now()` as a client-generated numeric ID. Never pass a string (e.g. UUID) — bigint column will reject it.

**No recursive `setSending` pattern.** If a send function owns a `setSending(true/false)` try/finally, inline any second API call — don't call the function recursively.

**CSV import:** Duplicate detection uses Map-based lookups (O(n+m)) — do not revert to `.filter()` scan (O(n²) freezes on large imports). Bulk inserts chunked at 500 rows.

**AppContext callbacks** (`loadContacts`, `loadMoreContacts`, `loadFullContact`, `saveContact`, `deleteContact`) use refs and functional setState. All have empty `[]` dep arrays with eslint-disable — intentional, don't "fix" it.

**`setContacts` from context is ref-syncing.** The context exposes `_setContacts` as `setContacts` — always use it instead of a local `useState` setter so `contactsRef.current` stays in sync with `loadMoreContacts`.

## Multi-tenancy

> ⚠️ `getClients` on the Railway server may return all clients regardless of membership — RLS is the real enforcement layer. Verify server-side gating before adding new users.

## Key DB notes

- `sms_settings` known keys: `automation_paused`, `email_automation_enabled`, `email_daily_limit`, `send_start_hour`, `send_end_hour`, `daily_limit`
- `email_tokens`: OAuth per client, provider `gmail` | `outlook`. Popup flow posts `GOOGLE_AUTH_SUCCESS/ERROR` or `MS_AUTH_SUCCESS/ERROR`.
