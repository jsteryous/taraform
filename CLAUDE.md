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
