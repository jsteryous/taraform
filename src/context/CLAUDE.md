# AppContext data flow

**AppContext holds state; it does not build queries.** Every contact query lives in `src/lib/contacts.js` (`fetchContactsPage`, `fetchFullContact`, `contactStillMatches`, `fetchAllFilteredContacts`, `fetchContactsByIds`, `insertContact`/`upsertContact`/`deleteContactById`); clients, members and offers live in `src/lib/api.js`. Error→sentence mapping is `classifyError` in `src/lib/errors.js`. If you're about to write `supabase.from(...)` in a component or in the context, add it to `lib/` instead — that's what keeps the query shape testable and the filter boundary singular.

**Split into two contexts.** `useAppData()` — contacts, clients, filters, actions. `useAppUI()` — toast/showToast, theme/setTheme. `useApp()` combines both and is safe everywhere. Use the narrower hooks when a component only needs one side (e.g. `ContactCard` uses `useAppData()` so toast changes don't re-render the list).

**Contacts paginate 50/page.** `loadContacts(clientId, filters)` loads page 1; `loadMoreContacts` appends. ALL facets filter server-side through `applyContactFilters` — status/county/phone/email/search since always, note-activity via the `last_note_at` generated column and follow-up via `follow_up_on` + `last_note_at` (`db/20260713_filter_columns.sql`, `db/20260724_follow_up.sql`) — never replace those with JS. (SMS activity filtering was removed 2026-07-13 — SMS isn't a feature since the Railway decommission.)

**Drift is re-checked against the server, not re-implemented.** A row edited in the detail overlay (status → Dead/Pass, a logged note, a snoozed follow-up) can fall out of the active filter. `saveContact` hands it to `dropIfDrifted`, which calls `contactStillMatches(id, clientId, filters)` — the *same* `applyContactFilters` query the list was built from, narrowed to one id — and removes the row if it no longer matches. Skipped entirely when `hasActiveFilters(filters)` is false, and deliberately **not awaited**: the "Saved" indicator shouldn't wait on a cosmetic re-check, and a failed check just leaves the row in place. `totalCount` is untouched (drift changes what's listed, not the server's count for those filters).

This replaced `contactMatchesFilters`, a per-contact JS copy of every filter predicate that had to be hand-kept in sync with the SQL and the PostgREST clauses. **Do not bring it back.** If you need a per-contact predicate, ask the server. The one surviving JS predicate is `isFollowUpDue`, and it drives *only* the ContactDetail "Due" badge — nothing routes rows in or out of the list from it.

**Bulk fetches (export, etc.):** use `fetchAllFilteredContacts(clientId, filters)` from `lib/contacts.js` — pages past Supabase's 1000-row cap with `select('*')` and shares the filter pipeline with the list view, so the export needs no client-side re-filtering at all. It and `fetchContactsByIds` return **raw snake_case DB rows** (the CSV needs `owner_address` / `property_addresses` / `activity_log`, which `LIST_FIELDS` omits); everything else in that module returns mapped camelCase contacts. Don't reach for raw supabase queries here; they skip the filter pipeline (this is exactly how Export All was broken).

**Search filter** ORs name/county/owner_address/email (`ilike`, partial) with `tax_map_ids`/`property_addresses`/`phones` (`cs.["value"]`, exact-element). The array columns are jsonb — see `src/lib/CLAUDE.md` for the syntax rule. No partial/case-insensitive across array elements without a Postgres RPC.

**Filter state** is a single `filters` object (`{ search, statuses, counties, phone, activity, email, followUp }`). Use `setFilters(f => ({ ...f, key: val }))` for partial updates. `EMPTY_FILTERS` constant resets all. `followUp` is null or the resolved `{ days, statuses }` from `resolveConfig().followUp` — the config rides in the filter value so `applyContactFilters` stays a pure function of its inputs.

**`setContacts` is ref-syncing.** Always use the one from context (not a local `useState`) so `contactsRef.current` stays in sync with `loadMoreContacts`.

**`loadingRef`** is a synchronous concurrent-fetch guard for `loadMoreContacts` — don't remove it.

**Tab focus auto-refreshes page 1** with current filters (throttled 2s, skipped during in-flight load). Picks up external writes — LandID extension, CSV imports in another tab, etc.

**`saveContact` is async and throws.** Always `await` it. The optimistic-save pattern (apply locally → revert + `showToast` on catch) lives in `useDraftSave` — use that hook rather than reimplementing.

**`showToast(msg, variant?)`** — second arg is `'success' | 'error' | 'warning'` (default: neutral, no icon). Pass the right variant on catch/success so the toast renders a colored border and icon.

**`useEffect` ordering (TDZ):** Any effect in `AppProvider` whose deps reference `loadContacts` / `loadMoreContacts` / `loadFullContact` / `saveContact` / `deleteContact` must be placed *after* its `useCallback` declaration. Deps arrays evaluate at render time, so an earlier-placed effect throws TDZ — minified to `Cannot access 'le' before initialization`. Bitten twice (`ef658d3`, `1df32f7`).
