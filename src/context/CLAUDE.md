# AppContext data flow

**Split into two contexts.** `useAppData()` — contacts, clients, filters, actions. `useAppUI()` — toast/showToast, theme/setTheme. `useApp()` combines both and is safe everywhere. Use the narrower hooks when a component only needs one side (e.g. `ContactCard` uses `useAppData()` so toast changes don't re-render the list).

**Contacts paginate 50/page.** `loadContacts(clientId, filters)` loads page 1; `loadMoreContacts` appends. Server-side filters (status/county/phone/email/search) go as Supabase query params — never replace those with JS. Note-activity filters (`note_lt_N`/`note_gt_N`, custom day count; plus `note_never`) are client-side only (jsonb `activity_log`, not server-filterable without an RPC); `activity_log` **is** in `LIST_FIELDS` so the filter evaluates every row. `ContactList.filtered` also re-checks each row against `contactMatchesFilters` so a contact edited in the detail overlay (status → Dead/Pass, a logged note) drops from the view without a refetch. (SMS activity filtering was removed 2026-07-13 — SMS isn't a feature since the Railway decommission.)

**Bulk fetches (export, etc.):** use `fetchAllFilteredContacts(clientId, filters)` — pages past Supabase's 1000-row cap with `select('*')`, shares filter logic with `loadContacts` via `applyContactFilters`. Re-apply the note activity filter client-side after the fetch (same as `ContactList`'s `filtered` memo). Don't reach for raw supabase queries here; they skip the filter pipeline (this is exactly how Export All was broken).

**Search filter** ORs name/county/owner_address/email (`ilike`, partial) with `tax_map_ids`/`property_addresses`/`phones` (`cs.["value"]`, exact-element). The array columns are jsonb — see `src/lib/CLAUDE.md` for the syntax rule. No partial/case-insensitive across array elements without a Postgres RPC.

**Filter state** is a single `filters` object (`{ search, statuses, counties, phone, activity, email }`). Use `setFilters(f => ({ ...f, key: val }))` for partial updates. `EMPTY_FILTERS` constant resets all.

**`setContacts` is ref-syncing.** Always use the one from context (not a local `useState`) so `contactsRef.current` stays in sync with `loadMoreContacts`.

**`loadingRef`** is a synchronous concurrent-fetch guard for `loadMoreContacts` — don't remove it.

**Tab focus auto-refreshes page 1** with current filters (throttled 2s, skipped during in-flight load). Picks up external writes — LandID extension, CSV imports in another tab, etc.

**`saveContact` is async and throws.** Always `await` it. The optimistic-save pattern (apply locally → revert + `showToast` on catch) lives in `useDraftSave` — use that hook rather than reimplementing.

**`showToast(msg, variant?)`** — second arg is `'success' | 'error' | 'warning'` (default: neutral, no icon). Pass the right variant on catch/success so the toast renders a colored border and icon.

**`useEffect` ordering (TDZ):** Any effect in `AppProvider` whose deps reference `loadContacts` / `loadMoreContacts` / `loadFullContact` / `saveContact` / `deleteContact` must be placed *after* its `useCallback` declaration. Deps arrays evaluate at render time, so an earlier-placed effect throws TDZ — minified to `Cannot access 'le' before initialization`. Bitten twice (`ef658d3`, `1df32f7`).
