import { describe, it, expect } from 'vitest';
import { applyContactFilters, hasActiveFilters, isFollowUpDue, followUpWindow, todayStr } from './contactFilters';
import { LAND_CONFIG } from './clientConfig';

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

  it('emits one and(...) branch per distinct window so cadences do not share a cutoff', () => {
    const q = mockQuery();
    applyContactFilters(q, { followUp: { days: 90, statuses: ['Contacted', 'Hot Lead'], statusDays: { 'Hot Lead': 7 } } });
    const expr = callsOf(q)[0].args[0];
    expect(expr).toContain('status.in.("Contacted")');
    expect(expr).toContain('status.in.("Hot Lead")');
    const cutoffs = [...expr.matchAll(/status\.in\.\("([^"]+)"\),or\(last_note_at\.is\.null,last_note_at\.lt\.([^)]+)\)/g)];
    expect(cutoffs).toHaveLength(2);
    const byStatus = Object.fromEntries(cutoffs.map(([, s, t]) => [s, new Date(t).getTime()]));
    expect(Math.abs(byStatus['Contacted'] - (Date.now() - 90 * 86400000))).toBeLessThan(5000);
    expect(Math.abs(byStatus['Hot Lead']  - (Date.now() -  7 * 86400000))).toBeLessThan(5000);
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

// hasActiveFilters decides whether a post-save drift re-check is worth a round trip
// (AppContext.dropIfDrifted) and whether an export is labelled "(filtered)".
describe('hasActiveFilters', () => {
  const EMPTY = { search: '', statuses: null, counties: [], phone: '', activity: '', email: '', followUp: null };

  it('is false for the empty filter object, null, and a bare {}', () => {
    expect(hasActiveFilters(EMPTY)).toBe(false);
    expect(hasActiveFilters(null)).toBe(false);
    expect(hasActiveFilters(undefined)).toBe(false);
    // A partial object must not read as filtered just because `statuses` is absent.
    expect(hasActiveFilters({})).toBe(false);
  });

  it('is true for any single active facet', () => {
    expect(hasActiveFilters({ ...EMPTY, search: 'smith' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY, counties: ['Greenville'] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY, phone: 'has' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY, email: 'missing' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY, activity: 'note_never' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY, followUp: { days: 90, statuses: ['Contacted'] } })).toBe(true);
  });

  it('treats any explicit status selection as active, including "none"', () => {
    // null means "all statuses" (the default); an array is always an explicit choice.
    expect(hasActiveFilters({ ...EMPTY, statuses: ['Contacted'] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY, statuses: [] })).toBe(true);
  });
});

// The follow-up rule exists twice on purpose: this JS version renders the ContactDetail
// "Due" badge, while applyContactFilters emits the clause that decides the actual queue.
// Only the badge depends on the code below.
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
    // Dead/Pass isn't auto-eligible, but a manual date makes it due.
    expect(isFollowUpDue({ status: 'Dead/Pass', followUpOn: dateStr(-1) }, cfg)).toBe(true);
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
    expect(isFollowUpDue({ ...noted(200), status: 'New Lead' }, cfg)).toBe(false);
    expect(isFollowUpDue({ ...noted(200), status: 'Dead/Pass' }, cfg)).toBe(false);
    expect(isFollowUpDue({ status: 'Contacted', activityLog: [] }, { days: 90, statuses: [] })).toBe(false);
  });

  // Hot Leads go stale in a week; everything else on the default 90-day window.
  it('statusDays gives a status its own window', () => {
    const hot = { days: 90, statuses: ['Contacted', 'Hot Lead'], statusDays: { 'Hot Lead': 7 } };
    expect(isFollowUpDue({ ...noted(8), status: 'Hot Lead' }, hot)).toBe(true);
    expect(isFollowUpDue({ ...noted(6), status: 'Hot Lead' }, hot)).toBe(false);
    // The override is per-status: Contacted still waits the full 90.
    expect(isFollowUpDue(noted(8), hot)).toBe(false);
    expect(isFollowUpDue(noted(100), hot)).toBe(true);
    // Eligible but no override → falls back to `days`.
    expect(followUpWindow('Contacted', hot)).toBe(90);
    expect(followUpWindow('Hot Lead', hot)).toBe(7);
    expect(followUpWindow('Dead/Pass', hot)).toBe(null);
  });

  it('the LAND preset puts Hot Leads on a weekly cycle', () => {
    const { followUp } = LAND_CONFIG;
    expect(isFollowUpDue({ ...noted(8), status: 'Hot Lead' }, followUp)).toBe(true);
    expect(isFollowUpDue({ ...noted(6), status: 'Hot Lead' }, followUp)).toBe(false);
  });

  // The badge and the queue clause should agree at the window boundary; they're written
  // separately, so pin the cases where a disagreement would be visible to a user.
  it('agrees with the server clause about what a fresh note does', () => {
    expect(isFollowUpDue(noted(100), cfg)).toBe(true);
    // Logging a note today (what happens after a call) clears the badge...
    expect(isFollowUpDue(noted(0), cfg)).toBe(false);
    // ...and so does snoozing via a future manual date.
    expect(isFollowUpDue({ ...noted(100), followUpOn: dateStr(14) }, cfg)).toBe(false);

    // Same two transitions, as the server sees them: the auto branch only matches rows
    // whose last_note_at is null or older than the cutoff, and a future follow_up_on
    // fails both the manual lte(today) branch and the follow_up_on.is.null guard.
    const q = mockQuery();
    applyContactFilters(q, { followUp: cfg });
    const expr = callsOf(q).find(c => c.method === 'or').args[0];
    expect(expr).toContain(`follow_up_on.lte.${todayStr()}`);
    expect(expr).toContain('and(follow_up_on.is.null,status.in.("Contacted")');
    expect(expr).toContain('last_note_at.is.null');
  });
});
