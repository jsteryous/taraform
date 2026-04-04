# Taraform Frontend

## What this is
Taraform is a multi-tenant SMS/email outreach CRM for land acquisition. The primary client is Table Rock Partners (UUID: f3a69c31-8e40-4ea0-865a-d8bd9214376d). Built with React + Vite, deployed to GitHub Pages at taraform.org.

## Stack
- React 18 + Vite
- Supabase JS client (direct DB access from browser)
- Deployed via GitHub Pages (branch: main, repo: jsteryous/taraform)
- No TypeScript — plain JSX throughout

## Project structure
```
src/
  main.jsx
  App.jsx
  index.css
  lib/
    supabase.js         — Supabase client
    api.js              — fetch wrappers for Railway server (always sends JWT)
    utils.js            — formatPhone, normalizeCounty, mapDbContact, mapContactToDb
    clientConfig.js     — LAND_CONFIG, resolveConfig, getStatusColor, statsPills
  context/
    AppContext.jsx       — global state: contacts (paginated 50/page), currentContact,
                          currentClientId, loadContacts, loadMoreContacts, loadFullContact
  components/
    auth/LoginScreen.jsx
    layout/Header.jsx         — SMS dot + Email dot, automation toggles
    layout/StatsBar.jsx       — count-only Supabase queries per status
    contacts/ContactList.jsx  — server-side filtering + pagination, load more button
    contacts/ContactCard.jsx
    contacts/ContactDetail.jsx — 3-column: sidebar | notes/SMS/email tabs | offers panel
    contacts/NotesTab.jsx
    contacts/SmsTab.jsx
    contacts/OffersTab.jsx
    contacts/EmailTab.jsx
    contacts/VirtualList.jsx
    modals/AddContactModal.jsx
    modals/ImportModal.jsx          — skip trace CSV import, multi-phone, Email1/Email2, three-tier field mapping
    modals/EmailSettingsModal.jsx   — Gmail + Outlook connect, Reoon verify, templates
    modals/EmailVerificationImportModal.jsx
    modals/SendEmailModal.jsx
    modals/ManageClientsModal.jsx   — create/edit clients + Members tab (invite by email, remove)
    modals/TemplatesModal.jsx
    modals/SmsSettingsModal.jsx
    shared/Modal.jsx
    shared/Toast.jsx
    Dashboard.jsx       — pipeline, SMS KPIs, offer stats (Supabase direct), email stats
```

## Key patterns

### Server-side pagination
Contacts load 50 at a time via `loadContacts(clientId, filters)` in AppContext.
Filters (status, county, search, phone, email) are passed as Supabase query params — never filter in JS.
`loadFullContact(id)` fetches all fields including JSONB when opening a contact detail.

### Data mapping
DB uses snake_case. Frontend uses camelCase. Always go through `mapDbContact` / `mapContactToDb` in utils.js.

### CSV import field mapping (three tiers)
ImportModal uses three tiers for mapping CSV columns:
1. **Core fields** — hardcoded (`CORE_FIELDS`), map to dedicated DB columns (name, phone, email, county, addresses, tax map ID, acreage). Special processing: multi-phone deduplication, address assembly from city/state/zip columns.
2. **Client custom fields** — pulled from `currentClient.custom_field_definitions` at runtime, auto-mapped by label/key. Stored in `custom_fields` JSONB.
3. **Ad-hoc extra fields** — user clicks "+ Add field", types a name, picks a CSV column. Stored in `custom_fields` JSONB with a slugified key. No pre-configuration needed for one-off columns like "website".

No DB schema changes needed — `property_crm_contacts.custom_fields` is already JSONB and the insert always writes it.

### Config system
All client-specific UI (statuses, colors, tabs, visible fields) comes from `resolveConfig(currentClient)` in clientConfig.js. Never hardcode status names or colors.

### API calls
All calls to the Railway server go through `src/lib/api.js`.
Every request automatically attaches the Supabase session JWT as `Authorization: Bearer <token>`.
Server base URL: `https://taraform-server-production.up.railway.app`
Server repo: https://github.com/jsteryous/taraform-server (main server file: api.js)

## Multi-tenancy architecture
Access control is enforced at two layers:

**Railway server** — `/api/clients` reads the JWT, looks up `client_users` for that user's client IDs, and returns only those clients. All client management routes (create, update, delete, add/remove members) are gated by membership checks server-side.

**Supabase RLS** — Row Level Security is enabled on:
- `property_crm_contacts` — users can only read/write contacts belonging to clients they're a member of
- `contact_offers` — access via contact → client membership chain

**client_users table** — junction table mapping users to clients:
- columns: id, client_id, user_id, role ('owner' | 'member'), created_at
- unique(client_id, user_id)
- RLS policy: `user_id = auth.uid()` (direct check — never self-referential)
- To add a user to a client: Manage Clients → Configure → Members tab → enter email → Add
- The invited user must already have a Taraform account (signed up first)

## Database (Supabase)
URL: https://ykuenmwfxecmmqichwit.supabase.co
Key tables: property_crm_contacts, sms_messages, sms_templates, sms_followup_queue,
            sms_settings, clients, client_users, email_tokens, email_templates,
            email_messages, email_followup_queue, contact_offers

property_crm_contacts.id is bigint (NOT uuid) with a sequence default (property_crm_contacts_id_seq).
Never pass id manually on insert — let Postgres generate it.

contact_offers columns: id, contact_id, client_id (may be null on older rows), amount, status, notes, created_at
contact_offers status values: Pending | Accepted | Rejected | Countered
Note: client_id is not reliably populated on all rows — always join through property_crm_contacts when filtering by client

email_status values: eligible | verified | do_not_email | unknown | contacted | replied

### email_tokens table
- Stores OAuth tokens per client for email sending
- columns include: client_id, provider ('outlook' | 'gmail'), access_token, refresh_token, email
- `provider` column added via: `ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'outlook';`
- GET /api/email/status returns { connected, email, provider } — frontend uses provider to show "GMAIL" or "OUTLOOK" badge
- OAuth popup flow: opener listens for postMessage with type GOOGLE_AUTH_SUCCESS / GOOGLE_AUTH_ERROR (Gmail) or MS_AUTH_SUCCESS / MS_AUTH_ERROR (Outlook)
- Gmail OAuth endpoints: GET /api/email/gmail-auth-url?client_id=, callback at /auth/google/callback
- Outlook OAuth endpoints: GET /api/email/auth-url?client_id=, disconnect: DELETE /api/email/disconnect?client_id=
- Railway env vars required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (https://taraform-server-production.up.railway.app/auth/google/callback)

### clients table columns
- id (uuid, PK)
- name, twilio_number, created_at
- config (JSONB) — stores type, terminology, statuses, statsPills, tabs, visibleFields, listColumns
- custom_field_definitions (TEXT) — stores a JSON array string: `[{"key":"acreage","label":"Acreage"}]`
  - Always parse on read: the server returns it as a raw JSON string, not a parsed array
  - Frontend reads it as: `JSON.parse(currentClient.custom_field_definitions || '[]')`
  - Sent to server as a JS array; server stringifies before storing

### sms_settings table
- Stores key/value pairs per client (key + client_id should be unique, but no DB constraint enforces it)
- Never use Supabase `.upsert()` without `onConflict` — it will insert duplicates instead of updating
- Use select-then-update/insert pattern in the server (see PUT /api/settings/:key in api.js)
- Keys used: `automation_paused`, `email_automation_enabled`
- `automation_paused` is seeded on client creation; `email_automation_enabled` may not exist — always use `.maybeSingle()` when reading settings, never `.single()`

## Code style
- Functional components with hooks only
- Inline styles throughout (no CSS modules, no Tailwind)
- CSS variables for theming: var(--bg), var(--surface), var(--border), var(--text), var(--text-muted), var(--accent)
- No TypeScript
- Keep components focused — if a component is doing too much, split it

## Deploying
```bash
npm run build && npx gh-pages -d dist
```
GitHub Pages serves from the `gh-pages` branch automatically.
