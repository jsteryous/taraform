# Taraform Frontend

## What this is
Taraform is a multi-tenant SMS/email outreach CRM for land acquisition. The primary client is Table Rock Partners (UUID: f3a69c31-8e40-4ea0-865a-d8bd9214376d). Built with React + Vite, deployed to GitHub Pages at taraform.org.

## Stack
- React 18 + Vite
- Supabase JS client (direct DB access from browser)
- Deployed via GitHub Pages (branch: main, repo: jsteryous/taraform)
- No TypeScript — plain JSX throughout

## Environment
Supabase credentials are in `.env.local` (gitignored). Required vars:
```
VITE_SUPABASE_URL=https://ykuenmwfxecmmqichwit.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```
The anon key is the public Supabase key — security is enforced by RLS, not by keeping the key secret. Never hardcode it back into source.

## Project structure
```
src/
  main.jsx
  App.jsx
  index.css
  lib/
    supabase.js         — Supabase client
    api.js              — fetch wrappers for Railway server (always sends JWT)
    utils.js            — formatPhone, normalizeCounty, mapDbContact, mapContactToDb, parseCustomFieldDefs, parseCSV
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

### Saving contacts
`saveContact(contact)` in AppContext is async and throws on error. Always `await` it.
In ContactDetail, `update` / `updateMultiple` / `updateCustomField` do optimistic UI updates and revert + show a toast if the save fails. Follow this same pattern anywhere else that calls `saveContact`.

### Parsing custom_field_definitions
`custom_field_definitions` on the clients object is a raw JSON string from the server (TEXT column). Always parse it with `parseCustomFieldDefs(raw)` from utils.js — never bare `JSON.parse`. The utility handles null, already-parsed arrays, and malformed JSON (returns `[]` on error).

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
3. **Ad-hoc extra fields** — user clicks "+ Add field", types a name, picks a CSV column. Stored in `custom_fields` JSONB with a slugified key.

No DB schema changes needed — `property_crm_contacts.custom_fields` is already JSONB and the insert always writes it.

### CSV import data rules
- Both `parseCSV` functions (utils.js and ImportModal.jsx) strip `\r` before splitting on `\n` — required for Excel/Windows CSVs.
- Duplicate detection uses Map-based lookups (O(n+m)) keyed by name, property address, and tax map ID. Do not revert to array `.filter()` scan — it's O(n²) and freezes on large imports.
- Bulk inserts are chunked at 500 rows. Do not send all rows in a single Supabase `.insert()` call.
- Duplicate phone updates run via `Promise.all` — do not use a sequential `for...of await` loop.
- Only one email per contact (`email` column). `email2` is used as fallback if `email1` is empty — this is intentional, not a bug.

### Config system
All client-specific UI (statuses, colors, tabs, visible fields) comes from `resolveConfig(currentClient)` in clientConfig.js. Never hardcode status names or colors.

### API calls
All calls to the Railway server go through `src/lib/api.js`. Every request automatically attaches the Supabase session JWT as `Authorization: Bearer <token>`.
Server base URL: `https://taraform-server-production.up.railway.app`
Server repo: https://github.com/jsteryous/taraform-server (main server file: api.js)

Never call `fetch()` directly for Railway endpoints — always use the exports from `api.js`:
```
// Clients
getClients, createClient, updateClient, deleteClient
getClientUsers, addClientUser, removeClientUser

// SMS
getTemplates, createTemplate, updateTemplate, deleteTemplate
getSetting, putSetting
getMessages, sendMessage

// Offers
addOffer, updateOffer, deleteOffer

// Email — connection
getEmailStatus(clientId), getEmailAuthUrl(clientId), getGmailAuthUrl(clientId), disconnectEmail(clientId)

// Email — templates
getEmailTemplates(clientId), createEmailTemplate(body), updateEmailTemplate(id, body), deleteEmailTemplate(id)

// Email — verification
startEmailVerify(body), getEmailVerifyStatus(clientId), resetEmailVerifyJob(clientId), reprocessEmailVerify(body)

// Email — sending & stats
getEmailMessages(contactId, clientId), sendEmailOne(body), sendEmailBatch(body), getEmailStats(clientId, period)
```

Settings (`getSetting`) may return 404 for keys that haven't been seeded yet — use `Promise.allSettled` when loading multiple settings so one missing key doesn't abort the whole load.

### Async loading state
Never recurse into a function that owns a `setSending(true/false)` try/finally — the outer `finally` fires after the inner call, flipping the flag at the wrong time. Inline the second API call instead:
```js
async function send() {
  setSending(true);
  try {
    let data = await sendEmailOne({ ...payload, force: false });
    if (data.unverified && confirm('Send anyway?')) {
      data = await sendEmailOne({ ...payload, force: true }); // inline, not recursive
    }
  } finally { setSending(false); }
}
```
`sendEmailOne` returns `{ unverified: true }` when the address hasn't been verified. Pass `force: true` to send anyway.

### Promise.all error handling
Always add `.catch()` to `Promise.all()` chains that update UI state — a single failed query will otherwise leave state permanently stale (e.g. StatsBar counts stuck at `…`).

### Error feedback
Use `showToast` from `useApp()` for all user-facing errors — never `alert()`.

## Multi-tenancy architecture
Access control is enforced at two layers:

**Railway server** — `/api/clients` reads the JWT, looks up `client_users` for that user's client IDs, and returns only those clients. All client management routes are gated by membership checks server-side.
> ⚠️ **Known gap**: as of early 2025, `getClients` on the server may return all clients regardless of membership — RLS is the real enforcement layer. Verify server-side gating before adding new users or exposing client management to untrusted users.

**Supabase RLS** — Row Level Security is enabled on:
- `property_crm_contacts` — users can only read/write contacts belonging to clients they're a member of
- `contact_offers` — access via contact → client membership chain

**client_users table** — junction table mapping users to clients:
- columns: id, client_id, user_id, role ('owner' | 'member'), created_at
- unique(client_id, user_id)
- RLS policy: `user_id = auth.uid()` (direct check — never self-referential)
- To add a user: Manage Clients → Configure → Members tab → enter email → Add
- The invited user must already have a Taraform account

## Database (Supabase)
URL: https://ykuenmwfxecmmqichwit.supabase.co
Key tables: property_crm_contacts, sms_messages, sms_templates, sms_followup_queue,
            sms_settings, clients, client_users, email_tokens, email_templates,
            email_messages, email_followup_queue, contact_offers

`property_crm_contacts.id` is bigint (NOT uuid) with a sequence default. Never pass id manually on insert.

`contact_offers` columns: id, contact_id, client_id (may be null on older rows), amount, status, notes, created_at
Status values: Pending | Accepted | Rejected | Countered
`client_id` is not reliably populated — always join through `property_crm_contacts` when filtering by client.

`email_status` values: eligible | verified | do_not_email | unknown | contacted | replied

### email_tokens table
- Stores OAuth tokens per client: client_id, provider ('outlook' | 'gmail'), access_token, refresh_token, email
- GET /api/email/status returns `{ connected, email, provider }` — frontend uses provider to show "GMAIL" or "OUTLOOK" badge
- OAuth popup flow: opener listens for postMessage `GOOGLE_AUTH_SUCCESS` / `GOOGLE_AUTH_ERROR` (Gmail) or `MS_AUTH_SUCCESS` / `MS_AUTH_ERROR` (Outlook)
- Gmail endpoints: GET /api/email/gmail-auth-url?client_id=, callback at /auth/google/callback
- Outlook endpoints: GET /api/email/auth-url?client_id=, disconnect: DELETE /api/email/disconnect?client_id=
- Railway env vars required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI

### clients table
- id (uuid, PK), name, twilio_number, created_at
- config (JSONB) — stores type, terminology, statuses, statsPills, tabs, visibleFields, listColumns
- custom_field_definitions (TEXT) — JSON array string: `[{"key":"acreage","label":"Acreage"}]`. Always parse with `parseCustomFieldDefs()`.

### sms_settings table
- Key/value pairs per client. No DB uniqueness constraint on (key, client_id) — never use `.upsert()` without `onConflict`, it inserts duplicates.
- Use select-then-update/insert pattern on the server (PUT /api/settings/:key).
- Known keys: `automation_paused`, `email_automation_enabled`, `email_daily_limit`, `send_start_hour`, `send_end_hour`, `daily_limit`
- `automation_paused` is seeded on client creation; others may not exist — always use `.maybeSingle()` on direct Supabase reads, never `.single()`.

## Code style
- Functional components with hooks only
- Inline styles throughout (no CSS modules, no Tailwind)
- CSS variables: var(--bg), var(--surface), var(--border), var(--text), var(--text-muted), var(--accent)
- No TypeScript
- Keep components focused — if a component is doing too much, split it

## Deploying
Push to `main` — GitHub Actions builds and deploys to the `gh-pages` branch automatically (`.github/workflows/deploy.yml`).

The build requires two repository secrets set in **GitHub → Settings → Secrets → Actions**:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

If these secrets are missing the deployed bundle will have `supabaseUrl = undefined` and the app will crash on load.
