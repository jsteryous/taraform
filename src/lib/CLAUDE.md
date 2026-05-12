# DB & API conventions

**`property_crm_contacts.id` is bigint.** New contacts use `Date.now()` as a client-generated numeric ID. Never pass a string (e.g. UUID) — bigint column will reject it.

**Array-ish columns on `property_crm_contacts` are `jsonb`, not `text[]`.** `phones`, `tax_map_ids`, `property_addresses`, `activity_log`, `custom_fields` — all jsonb. PostgREST containment uses JSON array syntax `cs.["value"]`; the text-array form `cs.{value}` returns `22P02 invalid input syntax for type json`. Likely backed by GIN indexes for fast containment lookups.

**`custom_field_definitions` is a TEXT column** (not JSONB). Always parse with `parseCustomFieldDefs(raw)` from `utils.js` — never bare `JSON.parse`.

**`getSetting` may return 404** for unseeded keys — use `Promise.allSettled` when loading multiple settings in parallel.

**`sms_settings` has no uniqueness constraint** on `(key, client_id)` — never `.upsert()` without `onConflict`. Use PUT /api/settings/:key on the server. Use `.maybeSingle()` on direct reads, never `.single()`. Known keys: `automation_paused`, `email_automation_enabled`, `email_daily_limit`, `send_start_hour`, `send_end_hour`, `daily_limit`.

**`contact_offers.client_id` is unreliable** (null on older rows). Always join through `property_crm_contacts` when filtering by client.

**Tax map IDs are unique within a county, not globally.** Same parcel ID can exist in different counties — duplicate detection (`AddContactModal.findDuplicates`, `ImportModal.findDuplicate`/`buildLookupMaps`) must key by `county|taxMapId`, not `taxMapId` alone.

**`email_tokens`:** OAuth per client, provider `gmail` | `outlook`. Popup flow posts `GOOGLE_AUTH_SUCCESS/ERROR` or `MS_AUTH_SUCCESS/ERROR`.

**Supabase auth token storage:** `localStorage['sb-ykuenmwfxecmmqichwit-auth-token']`. The LandID Chrome extension reads this to share auth — coordinate before changing storage strategy (storageKey, custom storage, cookie-based) or bumping supabase-js across token-format changes.
