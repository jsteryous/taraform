# UI patterns

- **Font sizes:** Use CSS tokens (`--text-2xs` → `--text-xl` defined in `:root`) — never arbitrary `rem` values. `check-css` enforces this.
- **Icons:** Use Lucide React — never emoji icons.
- **Selects:** Use `<Select>` from `shared/Select.jsx` — never native `<select>`.
- **Confirms:** Use `useConfirm()` from `shared/ConfirmDialog.jsx` — never `confirm()`.
- **Config:** All client-specific UI (statuses, colors, tabs, visible fields, `leadSourceOptions`, `contactMethodOptions`) comes from `resolveConfig(currentClient)` in `clientConfig.js`. Never hardcode these values.
- **Blur-to-save:** All fields in ContactDetail save on blur, not on change. Draft state updates on `onChange`; `update()` / `updateMultiple()` / `updateCustomField()` fire on `onBlur` — all three come from `useDraftSave` (`hooks/useDraftSave.js`), which owns the optimistic-save/revert pattern. (`updateMultiField` wraps `update` for array-typed fields.)
- **CSS/JSX sync:** Run `npm run check-css` after adding or renaming a `className`. Flags missing classes and raw rem font-sizes (both exit 1). Dead CSS is informational only.
- **No recursive `setSending`.** If a send function owns a `setSending(true/false)` try/finally, inline any second API call — don't call the function recursively.

## `contacts` from context is ONE PAGE — never treat it as the whole set

`useApp().contacts` holds the loaded page(s) of the list (`PAGE_SIZE` = 50), not the client's contacts. Deriving any *answer* from it — "does this already exist", "what counties are there", "how many are X" — silently computes over ~50 rows and looks like it worked.

This shipped as a real bug twice: `ImportModal` de-duplicated a CSV against the loaded page (importing the rest as duplicates) and `AddContactModal`'s duplicate warning did the same. Both were also blind to addresses, because `property_addresses` isn't in `LIST_FIELDS`. Fixed 2026-08-05 with `fetchDedupIndex` / `fetchDuplicateCandidates` in `lib/contacts.js`.

Render it, page it, select from it. To *ask a question* about the client's contacts, query the DB — `StatsBar` and `Dashboard` already do this correctly and are the pattern to copy. (`ContactList`'s county dropdown is a known partial: it accumulates counties from loaded rows and never drops one, so the list fills in as you page rather than being wrong.)

## CSV import (ImportModal)

`parseCSVRaw` (`utils.js`) returns indexed rows for the column-mapping UI. `parseCSV` returns keyed objects. Duplicate detection uses Map-based lookups (O(n+m)) — do not revert to `.filter()` scan — over the corpus from `fetchDedupIndex(clientId)`, **not** over `contacts` (see above). Bulk inserts chunked at 500 rows.

## Offers ↔ contact status (OffersTab)

Contact status is auto-derived from the latest offer (by `createdAt`): `Pending`/`Countered` → "Offer Made", `Rejected` → "Offer Rejected/NFS", `Accepted` → "UC". Pre-offer (`New Lead`, `Contacted`) and terminal (`Closed`, `Dead/Pass`) states stay manual via the header dropdown.

**Stats pills count contacts, never child rows.** Every pill in `StatsBar` counts `property_crm_contacts` in the pill's status, so the number always matches the list you get by clicking it. The `offers` pill briefly counted `contact_offers` rows instead and drifted — offer rows are permanent, but the contact moves on to Offer Rejected/NFS, UC, Dead/Pass, so the pill read 7 while the filtered list showed 3.

When mutating offers, batch any contact-status change with the offers update into a single `onChangeMultiple({ offers, status })` call. Sequential `onOffersChange` + `onChangeMultiple` calls race through `useDraftSave`'s `draftRef.current` and the second clobbers the first — caused a stale-render bug where the inline status dropdown didn't reflect the new value until re-mount.
