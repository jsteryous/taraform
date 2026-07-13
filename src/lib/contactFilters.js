import { normalizePhone } from './utils';

// A contact "has a phone" only if at least one number isn't struck through. `bad_phones`
// stores normalizePhone() digits of flagged numbers; a phone is good when its normalized
// form isn't in that set. Used by the client-side has/missing refinement below — the
// server "has" query is only the coarse `phones != []` prefilter (it can't compare the
// formatted `phones` array against the normalized `bad_phones` array without an RPC).
export function hasGoodPhone(contact) {
  const bad = new Set(contact.badPhones || []);
  return (contact.phones || []).some((p) => {
    const d = normalizePhone(p);
    return d && !bad.has(d);
  });
}

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
  // has_good_phone (db/20260713_filter_columns.sql) is true iff a non-struck number
  // exists, so "missing" correctly covers both no-phone and all-struck contacts.
  if (filters.phone === 'has')     q = q.eq('has_good_phone', true);
  if (filters.phone === 'missing') q = q.eq('has_good_phone', false);
  if (filters.email === 'has')     q = q.not('email', 'is', null).neq('email', '');
  if (filters.email === 'missing') q = q.or('email.is.null,email.eq.');

  // Note-activity via the last_note_at generated column (max note timestamp). Mirrors the
  // JS matchesNoteActivity semantics so the client drift re-check agrees on a fresh load.
  if (filters.activity) {
    const [type, op, days] = filters.activity.split('_');
    if (type === 'note') {
      if (op === 'never') {
        q = q.is('last_note_at', null);
      } else {
        const n = parseInt(days, 10);
        if (!isNaN(n)) {
          const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
          // lt = a note within the last N days; gt = last note older than N days (or none).
          if (op === 'lt') q = q.gte('last_note_at', cutoff);
          else if (op === 'gt') q = q.or(`last_note_at.lt.${cutoff},last_note_at.is.null`);
        }
      }
    }
  }

  if (filters.search) {
    // tax_map_ids, property_addresses are jsonb (not text[]) — cs uses JSON array
    // syntax `cs.["value"]`, not Postgres array literal `cs.{value}`. Exact-element match,
    // case-sensitive. Partial/case-insensitive would need an RPC.
    // Strip PostgREST filter-syntax + JSON control chars before interpolation.
    const raw = filters.search.trim().replace(/[(),{}\[\]"\\]/g, '');
    const s   = raw.toLowerCase();
    const words = s.split(/\s+/).filter(Boolean);
    const arrayMatch = `tax_map_ids.cs.["${raw}"],property_addresses.cs.["${raw}"]`;
    // Phones are stored formatted ("(864) 555-1234"); match against the digit-only
    // generated column (db/20260622_phone_search.sql) so any format the user types —
    // or just the last 4 digits — finds the number. >=4 digits keeps short address/
    // parcel numbers from flooding name searches. Digits are 0-9 only, so safe to
    // interpolate verbatim. See src/lib/CLAUDE.md.
    const digits = filters.search.replace(/\D/g, '');
    const phoneMatch = digits.length >= 4 ? `,phones_digits.ilike.%${digits}%` : '';
    if (words.length === 1) {
      q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,county.ilike.%${s}%,owner_address.ilike.%${s}%,email.ilike.%${s}%,${arrayMatch}${phoneMatch}`);
    } else if (words.length > 1) {
      const first = words[0];
      const last  = words.slice(1).join(' ');
      q = q.or(`and(first_name.ilike.%${first}%,last_name.ilike.%${last}%),owner_address.ilike.%${s}%,${arrayMatch}${phoneMatch}`);
    }
  }

  return q;
}

// Client-side note-activity predicate for a single contact — the counterpart to the
// server-side last_note_at filter (applyContactFilters), kept in sync so the drift
// re-check below agrees with what the server returned. `activity` values: "note_never",
// or "note_lt_N" / "note_gt_N" with a custom day count N from the filter UI. lt = has a
// note within the last N days; gt = last note is more than N days old — contacts with no
// notes at all count as gt ("who haven't we touched in N days"; "note_never" is exactly-
// never). Empty/non-note activity matches everything (pass-through).
export function matchesNoteActivity(contact, activity) {
  if (!activity) return true;
  const [type, op, days] = activity.split('_');
  if (type !== 'note') return true;

  const notes = (contact.activityLog || []).filter((e) => e.type === 'note' || (!e.type && e.text));
  const lastNote = notes
    .map((e) => new Date(e.timestamp || e.createdAt))
    .filter((d) => !isNaN(d))
    .sort((a, b) => b - a)[0];
  if (op === 'never') return !lastNote;

  const n = parseInt(days, 10);
  if (isNaN(n)) return true;
  const cutoff = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  if (op === 'lt') return !!lastNote && lastNote >= cutoff;
  if (op === 'gt') return !lastNote || lastNote < cutoff;
  return true;
}

// Full client-side filter predicate for a single contact. The list is already
// server-filtered (applyContactFilters), but a row edited in the detail overlay can
// drift out of the active filter — a status change to Dead/Pass, a logged note, etc.
// Re-checking every row against these facets on render drops the drifted row without a
// refetch, so the follow-up work queue shrinks as you clear contacts. `search` is
// intentionally omitted — it's server-only (ilike / jsonb containment) and rarely drifts.
export function contactMatchesFilters(contact, filters = {}) {
  const { statuses, counties, phone, email, activity } = filters;
  if (statuses && !statuses.includes(contact.status)) return false;
  if (counties?.length && !counties.includes(contact.county)) return false;

  const goodPhone = hasGoodPhone(contact);
  if (phone === 'has' && !goodPhone) return false;
  if (phone === 'missing' && goodPhone) return false;

  const hasEmail = !!(contact.email && contact.email.trim());
  if (email === 'has' && !hasEmail) return false;
  if (email === 'missing' && hasEmail) return false;

  return matchesNoteActivity(contact, activity);
}
