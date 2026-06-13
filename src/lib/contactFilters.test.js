import { describe, it, expect } from 'vitest';
import { applyContactFilters, filterByNoteActivity } from './contactFilters';

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

  it('maps sms_never to an is-null check', () => {
    const q = mockQuery();
    applyContactFilters(q, { activity: 'sms_never' });
    expect(callsOf(q)).toEqual([{ method: 'is', args: ['last_sms_at', null] }]);
  });

  it('maps sms_7 to a gte cutoff ~7 days ago', () => {
    const q = mockQuery();
    applyContactFilters(q, { activity: 'sms_7' });
    const [call] = callsOf(q);
    expect(call.method).toBe('gte');
    expect(call.args[0]).toBe('last_sms_at');
    const cutoff = new Date(call.args[1]).getTime();
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff - expected)).toBeLessThan(5000);
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

  it('passes SMS activity filters through untouched (handled server-side)', () => {
    const contacts = [withNote(1, 1), noNotes(2)];
    expect(filterByNoteActivity(contacts, 'sms_7')).toBe(contacts);
    expect(filterByNoteActivity(contacts, 'sms_never')).toBe(contacts);
  });

  it('note_7 keeps only contacts with a note in the last 7 days', () => {
    const ids = filterByNoteActivity(
      [withNote(1, 2), withNote(2, 10), noNotes(3)],
      'note_7',
    ).map((c) => c.id);
    expect(ids).toEqual([1]);
  });

  it('note_30 keeps notes within 30 days but excludes older', () => {
    const ids = filterByNoteActivity(
      [withNote(1, 5), withNote(2, 29), withNote(3, 45)],
      'note_30',
    ).map((c) => c.id);
    expect(ids).toEqual([1, 2]);
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
    expect(filterByNoteActivity([contact], 'note_7')).toHaveLength(1);
  });

  it('counts untyped log entries with text as notes, ignores non-note types', () => {
    const untyped = { id: 1, activityLog: [{ text: 'legacy note', timestamp: daysAgoISO(2) }] };
    const smsOnly = { id: 2, activityLog: [{ type: 'sms', text: 'hi', timestamp: daysAgoISO(2) }] };
    const ids = filterByNoteActivity([untyped, smsOnly], 'note_7').map((c) => c.id);
    expect(ids).toEqual([1]);
  });
});
