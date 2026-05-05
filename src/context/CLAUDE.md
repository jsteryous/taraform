# AppContext data flow

**Split into two contexts.** `useAppData()` — contacts, clients, filters, actions. `useAppUI()` — toast/showToast, theme/setTheme. `useApp()` combines both and is safe everywhere. Use the narrower hooks when a component only needs one side (e.g. `ContactCard` uses `useAppData()` so toast changes don't re-render the list).

**Contacts paginate 50/page.** `loadContacts(clientId, filters)` loads page 1; `loadMoreContacts` appends. All filters go as Supabase query params — never filter in JS. SMS activity filters (`sms_7/30/never`) are server-side via `last_sms_at`. Note filters (`note_7/30/never`) are client-side only — `activityLog` isn't in `LIST_FIELDS`.

**Filter state** is a single `filters` object (`{ search, statuses, counties, phone, activity, email }`). Use `setFilters(f => ({ ...f, key: val }))` for partial updates. `EMPTY_FILTERS` constant resets all.

**`setContacts` is ref-syncing.** Always use the one from context (not a local `useState`) so `contactsRef.current` stays in sync with `loadMoreContacts`.

**`loadingRef`** is a synchronous concurrent-fetch guard for `loadMoreContacts` — don't remove it.

**Tab focus auto-refreshes page 1** with current filters (throttled 2s, skipped during in-flight load). Picks up external writes — LandID extension, CSV imports in another tab, etc.

**`saveContact` is async and throws.** Always `await` it. The optimistic-save pattern (apply locally → revert + `showToast` on catch) lives in `useDraftSave` — use that hook rather than reimplementing.

**`showToast(msg, variant?)`** — second arg is `'success' | 'error' | 'warning'` (default: neutral, no icon). Pass the right variant on catch/success so the toast renders a colored border and icon.
