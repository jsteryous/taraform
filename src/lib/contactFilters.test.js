import { describe, it, expect } from 'vitest';
import { applyContactFilters, filterByNoteActivity, contactMatchesFilters } from './contactFilters';

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

  it('treats the empty jsonb array [] as "no phone"', () => {
    const has = mockQuery();
    applyContactFilters(has, { phone: 'has' });
    expect(callsOf(has)).toEqual([{ method: 'not', args: ['phones', 'eq', '[]'] }]);

    const missing = mockQuery();
    applyContactFilters(missing, { phone: 'missing' });
    expect(callsOf(missing)).toEqual([{ method: 'or', args: ['phones.is.null,phones.eq.[]'] }]);
  });

  it('handles email has/missing', () => {
    const has = mockQuery();
    applyContactFilters(has, { email: 'has' });
    expect(callsOf(has)).toEqual([
      { method: 'not', args: ['email', 'is', null] },
      { method: 'neq', args: ['email', ''] },
    ]);
  });

  it('emits no server operators for a note-activity filter (client-side only)', () => {
    const q = mockQuery();
    applyContactFilters(q, { activity: 'note_gt_15' });
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

  it('finds a phone even when typed with spaces (multi-word path)', () => {
    const q = mockQuery();
    applyContactFilters(q, { search: '864 555 1234' });
    expect(callsOf(q)[0].args[0]).toContain('phones_digits.ilike.%8645551234%');
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

describe('filterByNoteActivity', () => {
  const daysAgoISO = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  const withNote = (id, days) => ({
    id,
    activityLog: [{ type: 'note', text: 'x', timestamp: daysAgoISO(days) }],
  });
  const noNotes = (id) => ({ id, activityLog: [] });

  it('returns all contacts unchanged when there is no activity filter', () => {
    const contacts = [withNote(1, 1), noNotes(2)];
    expect(filterByNoteActivity(contacts, '')).toBe(contacts);
    expect(filterByNoteActivity(contacts, undefined)).toBe(contacts);
  });

  it('passes non-note activity values through untouched (only note_* is client-filtered)', () => {
    const contacts = [withNote(1, 1), noNotes(2)];
    expect(filterByNoteActivity(contacts, 'sms_7')).toBe(contacts);
    expect(filterByNoteActivity(contacts, 'other')).toBe(contacts);
  });

  it('note_lt_7 keeps only contacts with a note in the last 7 days', () => {
    const ids = filterByNoteActivity(
      [withNote(1, 2), withNote(2, 10), noNotes(3)],
      'note_lt_7',
    ).map((c) => c.id);
    expect(ids).toEqual([1]);
  });

  it('note_lt_30 keeps notes within 30 days but excludes older', () => {
    const ids = filterByNoteActivity(
      [withNote(1, 5), withNote(2, 29), withNote(3, 45)],
      'note_lt_30',
    ).map((c) => c.id);
    expect(ids).toEqual([1, 2]);
  });

  it('note_lt honors an arbitrary day count', () => {
    const ids = filterByNoteActivity(
      [withNote(1, 5), withNote(2, 12), withNote(3, 20)],
      'note_lt_14',
    ).map((c) => c.id);
    expect(ids).toEqual([1, 2]);
  });

  it('note_gt keeps contacts whose last note is older than N days, including never-noted', () => {
    const ids = filterByNoteActivity(
      [withNote(1, 5), withNote(2, 20), noNotes(3), { id: 4 }],
      'note_gt_14',
    ).map((c) => c.id);
    expect(ids).toEqual([2, 3, 4]);
  });

  it('passes contacts through on a malformed day count', () => {
    const contacts = [withNote(1, 5), noNotes(2)];
    expect(filterByNoteActivity(contacts, 'note_lt_abc')).toHaveLength(2);
  });

  it('note_never keeps only contacts with no notes at all', () => {
    const ids = filterByNoteActivity(
      [withNote(1, 1), noNotes(2), { id: 3 }],
      'note_never',
    ).map((c) => c.id);
    expect(ids).toEqual([2, 3]);
  });

  it('uses the most recent note when a contact has several', () => {
    const contact = {
      id: 1,
      activityLog: [
        { type: 'note', text: 'old', timestamp: daysAgoISO(40) },
        { type: 'note', text: 'recent', timestamp: daysAgoISO(3) },
      ],
    };
    expect(filterByNoteActivity([contact], 'note_lt_7')).toHaveLength(1);
  });

  it('counts untyped log entries with text as notes, ignores non-note types', () => {
    const untyped = { id: 1, activityLog: [{ text: 'legacy note', timestamp: daysAgoISO(2) }] };
    const smsOnly = { id: 2, activityLog: [{ type: 'sms', text: 'hi', timestamp: daysAgoISO(2) }] };
    const ids = filterByNoteActivity([untyped, smsOnly], 'note_lt_7').map((c) => c.id);
    expect(ids).toEqual([1]);
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

  it('applies phone has/missing', () => {
    expect(contactMatchesFilters(base, { phone: 'has' })).toBe(true);
    expect(contactMatchesFilters(base, { phone: 'missing' })).toBe(false);
    expect(contactMatchesFilters({ ...base, phones: [] }, { phone: 'missing' })).toBe(true);
    expect(contactMatchesFilters({ ...base, phones: [] }, { phone: 'has' })).toBe(false);
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
