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
    api.js              — fetch wrappers for Railway server
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
    modals/ImportModal.jsx          — skip trace CSV import, multi-phone, Email1/Email2
    modals/EmailSettingsModal.jsx   — Outlook connect, Reoon verify, templates
    modals/EmailVerificationImportModal.jsx
    modals/SendEmailModal.jsx
    modals/ManageClientsModal.jsx
    modals/TemplatesModal.jsx
    modals/SmsSettingsModal.jsx
    shared/Modal.jsx
    shared/Toast.jsx
    Dashboard.jsx       — pipeline, SMS KPIs, offer stats (server-side), email stats
```

## Key patterns

### Server-side pagination
Contacts load 50 at a time via `loadContacts(clientId, filters)` in AppContext.
Filters (status, county, search, phone, email) are passed as Supabase query params — never filter in JS.
`loadFullContact(id)` fetches all fields including JSONB when opening a contact detail.

### Data mapping
DB uses snake_case. Frontend uses camelCase. Always go through `mapDbContact` / `mapContactToDb` in utils.js.

### Config system
All client-specific UI (statuses, colors, tabs, visible fields) comes from `resolveConfig(currentClient)` in clientConfig.js. Never hardcode status names or colors.

### API calls
All calls to the Railway server go through `src/lib/api.js`.
Server base URL: `https://taraform-server-production.up.railway.app`

## Database (Supabase)
URL: https://ykuenmwfxecmmqichwit.supabase.co
Key tables: property_crm_contacts, sms_messages, sms_templates, sms_followup_queue,
            sms_settings, clients, email_tokens, email_templates, email_messages,
            email_followup_queue

email_status values: eligible | verified | do_not_email | unknown | contacted | replied

## Code style
- Functional components with hooks only
- Inline styles throughout (no CSS modules, no Tailwind)
- CSS variables for theming: var(--bg), var(--surface), var(--border), var(--text), var(--text-muted), var(--accent)
- No TypeScript
- Keep components focused — if a component is doing too much, split it

## Deploying
```bash
npm run build && npm run deploy
```
GitHub Pages serves from the `gh-pages` branch automatically.
