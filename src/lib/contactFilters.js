// Pure query-shaping for property_crm_contacts list/export.
// Takes a PostgREST query builder `q` and the current `filters` object, applies
// the active filters, and returns the builder. No supabase/component state here so
// it can be unit-tested against a mock builder (see contactFilters.test.js).
//
// jsonb columns (phones, tax_map_ids, property_addresses) use JSON-array containment
// syntax `cs.["value"]` — see src/lib/CLAUDE.md for the rule.
export function applyContactFilters(q, filters = {}) {
  if (filters.statuses?.length) q = q.in('status', filters.statuses);
  if (filters.counties?.length) q = q.in('county', filters.counties);
  // phones is jsonb — empty value is [] (JSON array), not {} (object).
  if (filters.phone === 'has')     q = q.not('phones', 'eq', '[]');
  if (filters.phone === 'missing') q = q.or('phones.is.null,phones.eq.[]');
  if (filters.email === 'has')     q = q.not('email', 'is', null).neq('email', '');
  if (filters.email === 'missing') q = q.or('email.is.null,email.eq.');

  if (filters.activity) {
    const [type, period] = filters.activity.split('_');
    if (type === 'sms') {
      if (period === 'never') {
        q = q.is('last_sms_at', null);
      } else {
        const days = parseInt(period, 10);
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        q = q.gte('last_sms_at', cutoff);
      }
    }
  }

  if (filters.search) {
    // tax_map_ids, property_addresses, phones are jsonb (not text[]) — cs uses JSON array
    // syntax `cs.["value"]`, not Postgres array literal `cs.{value}`. Exact-element match,
    // case-sensitive. Partial/case-insensitive would need an RPC.
    // Strip PostgREST filter-syntax + JSON control chars before interpolation.
    const raw = filters.search.trim().replace(/[(),{}\[\]"\\]/g, '');
    const s   = raw.toLowerCase();
    const words = s.split(/\s+/).filter(Boolean);
    const arrayMatch = `tax_map_ids.cs.["${raw}"],property_addresses.cs.["${raw}"],phones.cs.["${raw}"]`;
    if (words.length === 1) {
      q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,county.ilike.%${s}%,owner_address.ilike.%${s}%,email.ilike.%${s}%,${arrayMatch}`);
    } else if (words.length > 1) {
      const first = words[0];
      const last  = words.slice(1).join(' ');
      q = q.or(`and(first_name.ilike.%${first}%,last_name.ilike.%${last}%),owner_address.ilike.%${s}%,${arrayMatch}`);
    }
  }

  return q;
}

// Client-side note-activity filter. activity_log is jsonb and isn't server-filterable
// without an RPC, so both the list view (ContactList.filtered) and the Export-All path
// (App.handleExport) must filter by it in JS. Keep this the single source of truth —
// past "Export All disagrees with the list" bugs came from two hand-mirrored copies.
//
// `activity` is the same string the SMS path uses ("note_7", "note_30", "note_never").
// Non-note filters (no activity, or sms_*) pass through unchanged.
export function filterByNoteActivity(contacts, activity) {
  if (!activity) return contacts;
  const [type, period] = activity.split('_');
  if (type !== 'note') return contacts;

  const cutoff = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return contacts.filter((c) => {
    const notes = (c.activityLog || []).filter((e) => e.type === 'note' || (!e.type && e.text));
    const lastNote = notes
      .map((e) => new Date(e.timestamp || e.createdAt))
      .filter((d) => !isNaN(d))
      .sort((a, b) => b - a)[0];
    if (period === 'never') return !lastNote;
    if (!lastNote) return false;
    if (period === '7') return lastNote >= cutoff(7);
    if (period === '30') return lastNote >= cutoff(30);
    return true;
  });
}
