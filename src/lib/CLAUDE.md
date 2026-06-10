# DB & API conventions

> All data access is direct-to-Supabase (anon key + RLS) since the 2026-06-10 Railway decommission. `api.js` is a thin wrapper over supabase-js; clients/members go through the RPCs in `db/20260610_clients_rls.sql`.

**`property_crm_contacts.id` is bigint.** New contacts use `Date.now()` as a client-generated numeric ID. Never pass a string (e.g. UUID) — bigint column will reject it.

**Array-ish columns on `property_crm_contacts` are `jsonb`, not `text[]`.** `phones`, `tax_map_ids`, `property_addresses`, `activity_log`, `custom_fields` — all jsonb. PostgREST containment uses JSON array syntax `cs.["value"]`; the text-array form `cs.{value}` returns `22P02 invalid input syntax for type json`. Likely backed by GIN indexes for fast containment lookups.

**`custom_field_definitions` is a TEXT column** (not JSONB). Always parse with `parseCustomFieldDefs(raw)` from `utils.js` — never bare `JSON.parse`.

**Dormant tables** (`sms_settings`, `sms_messages`, `sms_templates`, `email_messages`, `email_templates`, `email_tokens`, `*_followup_queue`) hold historical SMS/email data from the retired Railway server. No UI reads them; don't delete without asking. If `sms_settings` is ever touched again: no uniqueness constraint on `(key, client_id)` — never `.upsert()` without `onConflict`, and use `.maybeSingle()`.

**`contact_offers.client_id` is unreliable** (null on older rows). Always join through `property_crm_contacts` when filtering by client.

**Tax map IDs are unique within a county, not globally.** Same parcel ID can exist in different counties — duplicate detection (`AddContactModal.findDuplicates`, `ImportModal.findDuplicate`/`buildLookupMaps`) must key by `county|taxMapId`, not `taxMapId` alone.

**Supabase auth token storage:** `localStorage['sb-ykuenmwfxecmmqichwit-auth-token']`. The LandID Chrome extension reads this to share auth — coordinate before changing storage strategy (storageKey, custom storage, cookie-based) or bumping supabase-js across token-format changes.
