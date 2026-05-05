# UI patterns

- **Font sizes:** Use CSS tokens (`--text-2xs` → `--text-xl` defined in `:root`) — never arbitrary `rem` values. `check-css` enforces this.
- **Icons:** Use Lucide React — never emoji icons.
- **Selects:** Use `<Select>` from `shared/Select.jsx` — never native `<select>`.
- **Confirms:** Use `useConfirm()` from `shared/ConfirmDialog.jsx` — never `confirm()`.
- **Config:** All client-specific UI (statuses, colors, tabs, visible fields, `leadSourceOptions`, `contactMethodOptions`) comes from `resolveConfig(currentClient)` in `clientConfig.js`. Never hardcode these values.
- **Blur-to-save:** All fields in ContactDetail save on blur, not on change. Draft state updates on `onChange`; `update()` / `updateMultiple()` / `updateCustomField()` fire on `onBlur` — all three come from `useDraftSave` (`hooks/useDraftSave.js`), which owns the optimistic-save/revert pattern. (`updateMultiField` wraps `update` for array-typed fields.)
- **CSS/JSX sync:** Run `npm run check-css` after adding or renaming a `className`. Flags missing classes and raw rem font-sizes (both exit 1). Dead CSS is informational only.
- **No recursive `setSending`.** If a send function owns a `setSending(true/false)` try/finally, inline any second API call — don't call the function recursively.

## CSV import (ImportModal)

`parseCSVRaw` (`utils.js`) returns indexed rows for the column-mapping UI. `parseCSV` returns keyed objects. Duplicate detection uses Map-based lookups (O(n+m)) — do not revert to `.filter()` scan. Bulk inserts chunked at 500 rows.
