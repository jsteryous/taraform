// Is any facet of the filter object actually narrowing the result set? Used to skip work
// that only matters under an active filter (the post-save drift re-check, the "(filtered)"
// suffix on an export).
export function hasActiveFilters(f) {
  if (!f) return false;
  // `statuses` is null for "all" and an array (possibly empty) for any explicit choice;
  // ?? null keeps a partial object like {} from reading as filtered.
  return !!(f.search || (f.statuses ?? null) !== null || f.counties?.length || f.phone || f.email || f.activity || f.followUp);
}

// Local calendar date as YYYY-MM-DD — the comparison unit for follow_up_on (a DATE
// column): "due" means the user's local today or earlier, no timezone midnight skew.
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Most recent note timestamp from the activity log (type 'note', or legacy untyped-
// with-text) — the JS counterpart of the last_note_at generated column.
export function lastNoteDate(contact) {
  return (contact.activityLog || [])
    .filter((e) => e.type === 'note' || (!e.type && e.text))
    .map((e) => new Date(e.timestamp || e.createdAt))
    .filter((d) => !isNaN(d))
    .sort((a, b) => b - a)[0] || null;
}

// How stale a contact's notes may get before its status resurfaces it, in days.
// `statusDays` holds per-status overrides on top of the default `days` — a Hot Lead
// resurfaces weekly while a merely Contacted one waits the full 90. Returns null when
// the status isn't auto-eligible at all (only a manual date can queue it).
export function followUpWindow(status, followUp) {
  if (!followUp?.days) return null;
  if (!(followUp.statuses || []).includes(status)) return null;
  return followUp.statusDays?.[status] ?? followUp.days;
}

// Per-contact "due for follow-up" predicate, used *only* to render the ContactDetail
// "Due" badge — filtering by follow-up happens server-side in applyContactFilters below.
// It is not a filter mirror: nothing routes rows in or out of the list based on it, so a
// disagreement with the SQL costs a wrong badge, not a wrong result set.
//
// `followUp` is the resolved client config ({ days, statuses, statusDays } from
// resolveConfig().followUp). A manual follow_up_on date always wins — set, it alone
// decides (arrived = due, future = not due, even outside the auto statuses); unset, the
// auto rule applies: an eligible status with no note within that status's window
// (never-noted counts as due — last_note_at null is the most overdue).
export function isFollowUpDue(contact, followUp) {
  if (!followUp?.days) return false;
  if (contact.followUpOn) return contact.followUpOn <= todayStr();
  const window = followUpWindow(contact.status, followUp);
  if (!window) return false;
  const last = lastNoteDate(contact);
  return !last || last < new Date(Date.now() - window * 86400000);
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

  // Note-activity via the last_note_at generated column (max note timestamp). lt = has a
  // note within the last N days; gt = last note older than N days, which includes
  // never-noted contacts ("who haven't we touched in N days"); note_never is exactly-never.
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

  // Follow-up queue — filters.followUp carries the resolved config ({ days, statuses,
  // statusDays }) so this stays a pure function of its inputs. Due = manual follow_up_on
  // has arrived, OR no manual date + auto-eligible status + last note older than that
  // status's window (or never). isFollowUpDue above expresses the same rule for the
  // detail badge, but this clause is the only one that decides what's in the list.
  if (filters.followUp?.days) {
    // Statuses are grouped by window, one and(...) branch per distinct cadence: Hot Lead
    // (7d) and Contacted (90d) need different cutoffs, so they can't share an in.() list.
    const byWindow = new Map();
    for (const s of filters.followUp.statuses || []) {
      const w = followUpWindow(s, filters.followUp);
      if (!w) continue;
      if (!byWindow.has(w)) byWindow.set(w, []);
      byWindow.get(w).push(s);
    }
    // Status values may contain spaces/slashes ("Offer Rejected/NFS") — quote them for
    // the in.() list. None contain commas or quotes (they come from client config).
    const auto = [...byWindow].map(([w, group]) => {
      const cutoff = new Date(Date.now() - w * 86400000).toISOString();
      const list = group.map((s) => `"${s}"`).join(',');
      return `and(follow_up_on.is.null,status.in.(${list}),or(last_note_at.is.null,last_note_at.lt.${cutoff}))`;
    });
    q = q.or([`follow_up_on.lte.${todayStr()}`, ...auto].join(','));
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
    // or just the last 4 digits — finds the number. Threshold: 4 digits normally
    // (keeps street/parcel numbers inside mixed queries from flooding name searches),
    // but 3 when the query is nothing but digits/phone punctuation — a bare area code
    // ("919") is unambiguously a phone search. Digits are 0-9 only, so safe to
    // interpolate verbatim. See src/lib/CLAUDE.md.
    const digits = filters.search.replace(/\D/g, '');
    const phoneLike = /^[\d\s().+-]+$/.test(filters.search.trim());
    const phoneMatch = digits.length >= (phoneLike ? 3 : 4) ? `,phones_digits.ilike.%${digits}%` : '';
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
