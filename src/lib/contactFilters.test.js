import { describe, it, expect } from 'vitest';
import { applyContactFilters, matchesNoteActivity, contactMatchesFilters, hasGoodPhone, isFollowUpDue, todayStr } from './contactFilters';

// Records every PostgREST builder method call and stays chainable, so we can assert
// exactly which query operators applyContactFilters emits without a live DB.
function mockQuery() {
  const calls = [];
  const proxy = new Proxy({}, {
    get(_t, prop) {
      if (prop === '__calls') return calls;
      if (typeof prop === 'symbol') return undefined;
      return (...args) => {
        calls.push({ method: prop, args });
        return proxy;
      };
    },
  });
  return proxy;
}
const callsOf = (q) => q.__calls;

describe('applyContactFilters', () => {
  it('emits no operators for empty filters', () => {
    const q = mockQuery();
    applyContactFilters(q, {});
    expect(callsOf(q)).toHaveLength(0);
  });

  it('filters statuses and counties with .in()', () => {
    const q = mockQuery();
    applyContactFilters(q, { statuses: ['New Lead'], counties: ['Greenville'] });
    expect(callsOf(q)).toEqual([
      { method: 'in', args: ['status', ['New Lead']] },
      { method: 'in', args: ['county', ['Greenville']] },
    ]);
  });

  it('filters phone has/missing on the has_good_phone column', () => {
    const has = mockQuery();
    applyContactFilters(has, { phone: 'has' });
    expect(callsOf(has)).toEqual([{ method: 'eq', args: ['has_good_phone', true] }]);

    const missing = mockQuery();
    applyContactFilters(missing, { phone: 'missing' });
    expect(callsOf(missing)).toEqual([{ method: 'eq', args: ['has_good_phone', false] }]);
  });

  it('handles email has/missing', () => {
    const has = mockQuery();
    applyContactFilters(has, { email: 'has' });
    expect(callsOf(has)).toEqual([
      { method: 'not', args: ['email', 'is', null] },
      { method: 'neq', args: ['email', ''] },
    ]);
  });

  it('maps note_never to a last_note_at is-null check', () => {
    const q = mockQuery();
    applyContactFilters(q, { activity: 'note_never' });
    expect(callsOf(q)).toEqual([{ method: 'is', args: ['last_note_at', null] }]);
  });

  it('maps note_lt_N to a last_note_at gte cutoff ~N days ago', () => {
    const q = mockQuery();
    applyContactFilters(q, { activity: 'note_lt_15' });
    const [call] = callsOf(q);
    expect(call.method).toBe('gte');
    expect(call.args[0]).toBe('last_note_at');
    const cutoff = new Date(call.args[1]).getTime();
    const expected = Date.now() - 15 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff - expected)).toBeLessThan(5000);
  });

  it('maps note_gt_N to "older than cutoff OR never noted"', () => {
    const q = mockQuery();
    applyContactFilters(q, { activity: 'note_gt_15' });
    const [call] = callsOf(q);
    expect(call.method).toBe('or');
    expect(call.args[0]).toMatch(/^last_note_at\.lt\..+,last_note_at\.is\.null$/);
  });

  it('emits no note operator for a malformed day count', () => {
    const q = mockQuery();
    applyContactFilters(q, { activity: 'note_lt_abc' });
    expect(callsOf(q)).toHaveLength(0);
  });

  it('builds a single-word search across text and jsonb columns', () => {
    const q = mockQuery();
    applyContactFilters(q, { search: 'smith' });
    const [call] = callsOf(q);
    expect(call.method).toBe('or');
    expect(call.args[0]).toContain('first_name.ilike.%smith%');
    expect(call.args[0]).toContain('tax_map_ids.cs.["smith"]');
  });

  it('splits a two-word search into a first/last AND group', () => {
    const q = mockQuery();
    applyContactFilters(q, { search: 'jane doe' });
    const [call] = callsOf(q);
    expect(call.args[0]).toContain('and(first_name.ilike.%jane%,last_name.ilike.%doe%)');
  });

  it('matches phones format-agnostically against the digit-only column', () => {
    // Any of these formats should produce the same digit-only phone clause.
    for (const term of ['8645551234', '864-555-1234', '(864) 555-1234', '864.555.1234']) {
      const q = mockQuery();
      applyContactFilters(q, { search: term });
      expect(callsOf(q)[0].args[0]).toContain('phones_digits.ilike.%8645551234%');
    }
  });

  it('treats a partial digit string (e.g. last 4) as a phone match', () => {
    const q = mockQuery();
    applyContactFilters(q, { search: '1234' });
    expect(callsOf(q)[0].args[0]).toContain('phones_digits.ilike.%1234%');
  });

  it('does not add a phone clause for short/no-digit searches', () => {
    const name = mockQuery();
    applyContactFilters(name, { search: 'smith' });
    expect(callsOf(name)[0].args[0]).not.toContain('phones_digits');

    const short = mockQuery();
    applyContactFilters(short, { search: '12' });
    expect(callsOf(short)[0].args[0]).not.toContain('phones_digits');
  });

  it('treats a bare 3-digit area code as a phone search', () => {
    for (const term of ['919', '(919)', '919-']) {
      const q = mockQuery();
      applyContactFilters(q, { search: term });
      expect(callsOf(q)[0].args[0]).toContain('phones_digits.ilike.%919%');
    }
  });

  it('keeps the 4-digit threshold when 3 digits are mixed with text', () => {
    const q = mockQuery();
    applyContactFilters(q, { search: '104 Main St' });
    expect(callsOf(q)[0].args[0]).not.toContain('phones_digits');
  });

  it('finds a phone even when typed with spaces (multi-word path)', () => {
    const q = mockQuery();
    applyContactFilters(q, { search: '864 555 1234' });
    expect(callsOf(q)[0].args[0]).toContain('phones_digits.ilike.%8645551234%');
  });

  it('builds the follow-up queue clause: manual date OR (eligible status + stale/no notes)', () => {
    const q = mockQuery();
    applyContactFilters(q, { followUp: { days: 90, statuses: ['Contacted', 'Offer Rejected/NFS'] } });
    const [call] = callsOf(q);
    expect(call.method).toBe('or');
    const expr = call.args[0];
    expect(expr).toContain(`follow_up_on.lte.${todayStr()}`);
    // Values with spaces/slashes must be quoted inside in.()
    expect(expr).toContain('status.in.("Contacted","Offer Rejected/NFS")');
    expect(expr).toContain('and(follow_up_on.is.null,');
    expect(expr).toContain('or(last_note_at.is.null,last_note_at.lt.');
    // Auto cutoff ~90 days ago
    const cutoff = new Date(expr.match(/last_note_at\.lt\.([^)]+)\)/)[1]).getTime();
    expect(Math.abs(cutoff - (Date.now() - 90 * 86400000))).toBeLessThan(5000);
  });

  it('follow-up with no eligible statuses is manual-date-only', () => {
    const q = mockQuery();
    applyContactFilters(q, { followUp: { days: 90, statuses: [] } });
    expect(callsOf(q)).toEqual([{ method: 'or', args: [`follow_up_on.lte.${todayStr()}`] }]);
  });

  it('emits no follow-up clause when the facet is off', () => {
    const off = mockQuery();
    applyContactFilters(off, { followUp: null });
    expect(callsOf(off)).toHaveLength(0);
  });

  it('strips PostgREST/JSON control chars from search input (injection guard)', () => {
    const q = mockQuery();
    applyContactFilters(q, { search: 'a,b)c(d"e]' });
    const expr = callsOf(q)[0].args[0];
    // The user input collapses to a clean token that is slotted into the filter
    // grammar verbatim — none of its metacharacters survive to break out of or()/cs.[].
    expect(expr).toContain('first_name.ilike.%abcde%');
    expect(expr).toContain('tax_map_ids.cs.["abcde"]');
  });
});

// matchesNoteActivity mirrors the server-side last_note_at filter; it's the per-contact
// predicate used by contactMatchesFilters for the detail-overlay drift re-check.
describe('matchesNoteActivity', () => {
  const daysAgoISO = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  const withNote = (days) => ({ activityLog: [{ type: 'note', text: 'x', timestamp: daysAgoISO(days) }] });
  const noNotes = { activityLog: [] };

  it('matches everything when there is no activity filter or a non-note value', () => {
    expect(matchesNoteActivity(withNote(1), '')).toBe(true);
    expect(matchesNoteActivity(withNote(1), undefined)).toBe(true);
    expect(matchesNoteActivity(withNote(1), 'sms_7')).toBe(true);
  });

  it('note_lt_N is true only for a note within the last N days', () => {
    expect(matchesNoteActivity(withNote(2), 'note_lt_7')).toBe(true);
    expect(matchesNoteActivity(withNote(10), 'note_lt_7')).toBe(false);
    expect(matchesNoteActivity(noNotes, 'note_lt_7')).toBe(false);
    // arbitrary day count
    expect(matchesNoteActivity(withNote(12), 'note_lt_14')).toBe(true);
    expect(matchesNoteActivity(withNote(20), 'note_lt_14')).toBe(false);
  });

  it('note_gt_N is true when the last note is older than N days, incl. never-noted', () => {
    expect(matchesNoteActivity(withNote(20), 'note_gt_14')).toBe(true);
    expect(matchesNoteActivity(withNote(5), 'note_gt_14')).toBe(false);
    expect(matchesNoteActivity(noNotes, 'note_gt_14')).toBe(true);
    expect(matchesNoteActivity({}, 'note_gt_14')).toBe(true);
  });

  it('note_never is true only with no notes at all', () => {
    expect(matchesNoteActivity(noNotes, 'note_never')).toBe(true);
    expect(matchesNoteActivity({}, 'note_never')).toBe(true);
    expect(matchesNoteActivity(withNote(1), 'note_never')).toBe(false);
  });

  it('matches everything on a malformed day count', () => {
    expect(matchesNoteActivity(withNote(5), 'note_lt_abc')).toBe(true);
    expect(matchesNoteActivity(noNotes, 'note_gt_abc')).toBe(true);
  });

  it('uses the most recent note when a contact has several', () => {
    const contact = { activityLog: [
      { type: 'note', text: 'old', timestamp: daysAgoISO(40) },
      { type: 'note', text: 'recent', timestamp: daysAgoISO(3) },
    ] };
    expect(matchesNoteActivity(contact, 'note_lt_7')).toBe(true);
  });

  it('counts untyped log entries with text as notes, ignores non-note types', () => {
    const untyped = { activityLog: [{ text: 'legacy note', timestamp: daysAgoISO(2) }] };
    const smsOnly = { activityLog: [{ type: 'sms', text: 'hi', timestamp: daysAgoISO(2) }] };
    expect(matchesNoteActivity(untyped, 'note_lt_7')).toBe(true);
    expect(matchesNoteActivity(smsOnly, 'note_lt_7')).toBe(false);
  });
});

describe('contactMatchesFilters', () => {
  const base = { status: 'Contacted', county: 'Greenville', phones: ['(864) 555-1234'], email: 'a@b.com', activityLog: [] };

  it('matches everything under empty filters', () => {
    expect(contactMatchesFilters(base, {})).toBe(true);
    expect(contactMatchesFilters(base, { statuses: null, counties: [], phone: '', email: '', activity: '' })).toBe(true);
  });

  it('drops a contact whose status is not in the selected statuses', () => {
    expect(contactMatchesFilters(base, { statuses: ['Contacted'] })).toBe(true);
    expect(contactMatchesFilters({ ...base, status: 'Dead/Pass' }, { statuses: ['Contacted'] })).toBe(false);
  });

  it('drops a contact whose county is not selected', () => {
    expect(contactMatchesFilters(base, { counties: ['Greenville'] })).toBe(true);
    expect(contactMatchesFilters(base, { counties: ['Pickens'] })).toBe(false);
  });

  it('applies phone has/missing on good (non-struck) phones', () => {
    expect(contactMatchesFilters(base, { phone: 'has' })).toBe(true);
    expect(contactMatchesFilters(base, { phone: 'missing' })).toBe(false);
    expect(contactMatchesFilters({ ...base, phones: [] }, { phone: 'missing' })).toBe(true);
    expect(contactMatchesFilters({ ...base, phones: [] }, { phone: 'has' })).toBe(false);
    // Every number struck through → not "has phone", counts as "missing".
    const allStruck = { ...base, phones: ['(864) 555-1234'], badPhones: ['8645551234'] };
    expect(contactMatchesFilters(allStruck, { phone: 'has' })).toBe(false);
    expect(contactMatchesFilters(allStruck, { phone: 'missing' })).toBe(true);
  });

  it('applies email has/missing (whitespace-only counts as missing)', () => {
    expect(contactMatchesFilters(base, { email: 'has' })).toBe(true);
    expect(contactMatchesFilters({ ...base, email: '' }, { email: 'missing' })).toBe(true);
    expect(contactMatchesFilters({ ...base, email: '  ' }, { email: 'has' })).toBe(false);
  });

  it('applies the note-activity facet — a fresh note drops a "none in last N days" row', () => {
    const stale = { ...base, activityLog: [{ type: 'note', text: 'x', timestamp: new Date(Date.now() - 20 * 86400000).toISOString() }] };
    const fresh = { ...base, activityLog: [{ type: 'note', text: 'x', timestamp: new Date().toISOString() }] };
    expect(contactMatchesFilters(stale, { activity: 'note_gt_15' })).toBe(true);
    expect(contactMatchesFilters(fresh, { activity: 'note_gt_15' })).toBe(false);
  });

  it('requires every active facet to pass (AND semantics)', () => {
    expect(contactMatchesFilters(base, { statuses: ['Contacted'], phone: 'has' })).toBe(true);
    expect(contactMatchesFilters(base, { statuses: ['Contacted'], phone: 'missing' })).toBe(false);
  });
});

// The client-side mirror of the server followUp clause — used for the drift re-check
// (queue shrinks live as contacts are touched) and the ContactDetail "Due" badge.
describe('isFollowUpDue', () => {
  const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString();
  const dateStr = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return todayStr(d);
  };
  const cfg = { days: 90, statuses: ['Contacted'] };
  const noted = (days) => ({ status: 'Contacted', activityLog: [{ type: 'note', text: 'x', timestamp: daysAgoISO(days) }] });

  it('is never due without config (auto rule unset)', () => {
    expect(isFollowUpDue(noted(200), null)).toBe(false);
    expect(isFollowUpDue(noted(200), undefined)).toBe(false);
  });

  it('manual date: due when today or past, not when future', () => {
    expect(isFollowUpDue({ status: 'Contacted', followUpOn: dateStr(0) }, cfg)).toBe(true);
    expect(isFollowUpDue({ status: 'Contacted', followUpOn: dateStr(-10) }, cfg)).toBe(true);
    expect(isFollowUpDue({ status: 'Contacted', followUpOn: dateStr(10) }, cfg)).toBe(false);
  });

  it('manual date works on any status, and overrides the auto rule both ways', () => {
    // Hot Lead isn't auto-eligible, but a manual date makes it due.
    expect(isFollowUpDue({ status: 'Hot Lead', followUpOn: dateStr(-1) }, cfg)).toBe(true);
    // A future date suppresses the auto rule even for a stale Contacted contact.
    expect(isFollowUpDue({ ...noted(200), followUpOn: dateStr(30) }, cfg)).toBe(false);
  });

  it('auto rule: due when the last note is older than the window, or never noted', () => {
    expect(isFollowUpDue(noted(100), cfg)).toBe(true);
    expect(isFollowUpDue(noted(10), cfg)).toBe(false);
    expect(isFollowUpDue({ status: 'Contacted', activityLog: [] }, cfg)).toBe(true);
    expect(isFollowUpDue({ status: 'Contacted' }, cfg)).toBe(true);
  });

  it('auto rule only applies to eligible statuses', () => {
    expect(isFollowUpDue({ ...noted(200), status: 'Hot Lead' }, cfg)).toBe(false);
    expect(isFollowUpDue({ ...noted(200), status: 'Dead/Pass' }, cfg)).toBe(false);
    expect(isFollowUpDue({ status: 'Contacted', activityLog: [] }, { days: 90, statuses: [] })).toBe(false);
  });

  it('drift re-check: contactMatchesFilters drops a touched contact from the queue', () => {
    const filters = { followUp: cfg };
    expect(contactMatchesFilters(noted(100), filters)).toBe(true);
    // Logging a note today (what happens after a call) drops the row live.
    expect(contactMatchesFilters(noted(0), filters)).toBe(false);
    // So does pushing the manual date into the future ("snooze").
    expect(contactMatchesFilters({ ...noted(100), followUpOn: dateStr(14) }, filters)).toBe(false);
    // Facet off → pass-through.
    expect(contactMatchesFilters(noted(100), { followUp: null })).toBe(true);
  });
});

describe('hasGoodPhone', () => {
  it('is true when at least one number is not struck through', () => {
    expect(hasGoodPhone({ phones: ['(864) 555-1234'], badPhones: [] })).toBe(true);
    expect(hasGoodPhone({ phones: ['(864) 555-1234', '(803) 111-2222'], badPhones: ['8645551234'] })).toBe(true);
  });

  it('is false when there are no numbers or all are struck through', () => {
    expect(hasGoodPhone({ phones: [], badPhones: [] })).toBe(false);
    expect(hasGoodPhone({ phones: ['(864) 555-1234'], badPhones: ['8645551234'] })).toBe(false);
    expect(hasGoodPhone({})).toBe(false);
  });

  it('matches bad_phones regardless of the stored phone format (normalizePhone)', () => {
    // badPhones holds last-10-digit form; phone can be stored any way.
    expect(hasGoodPhone({ phones: ['864.555.1234'], badPhones: ['8645551234'] })).toBe(false);
    expect(hasGoodPhone({ phones: ['1 (864) 555-1234'], badPhones: ['8645551234'] })).toBe(false);
  });
});
