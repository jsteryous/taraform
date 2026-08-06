import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake supabase client: every builder method is recorded and chainable, and the builder
// is thenable so `await`ing it yields a PostgREST-shaped response we control.
const h = vi.hoisted(() => ({ state: { rows: [], error: null, calls: [] } }));

vi.mock('./supabase', () => {
  const builder = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve) => resolve({ data: h.state.rows, error: h.state.error });
      }
      if (typeof prop === 'symbol') return undefined;
      return (...args) => { h.state.calls.push({ method: prop, args }); return builder; };
    },
  });
  return {
    supabase: {
      from: (...args) => { h.state.calls.push({ method: 'from', args }); return builder; },
    },
  };
});

const { contactStillMatches, fetchDedupIndex, fetchDuplicateCandidates } = await import('./contacts');

const reset = (rows = [], error = null) => { h.state.rows = rows; h.state.error = error; h.state.calls = []; };
const methodArgs = (name) => h.state.calls.filter(c => c.method === name).map(c => c.args);

beforeEach(() => reset());

// contactStillMatches is what replaced contactMatchesFilters — the hand-maintained JS copy
// of every filter predicate. Its whole value is that it asks the SAME query the list was
// built from, so these tests pin that it really does go through applyContactFilters rather
// than growing its own notion of what "matches" means.
describe('contactStillMatches', () => {
  it('is true when the filtered query still returns the row', async () => {
    reset([{ id: 42 }]);
    await expect(contactStillMatches(42, 'client-1', { phone: 'has' })).resolves.toBe(true);
  });

  it('is false when the row has dropped out of the filter', async () => {
    reset([]);
    await expect(contactStillMatches(42, 'client-1', { phone: 'has' })).resolves.toBe(false);
  });

  it('scopes the probe to the one contact within its client', async () => {
    reset([{ id: 42 }]);
    await contactStillMatches(42, 'client-1', {});
    expect(h.state.calls[0]).toEqual({ method: 'from', args: ['property_crm_contacts'] });
    expect(methodArgs('eq')).toEqual([['client_id', 'client-1'], ['id', 42]]);
    expect(methodArgs('limit')).toEqual([[1]]);
    // Only the id is needed — never drag the full row back for a yes/no question.
    expect(methodArgs('select')).toEqual([['id', {}]]);
  });

  it('routes the active filters through applyContactFilters', async () => {
    reset([{ id: 42 }]);
    await contactStillMatches(42, 'client-1', {
      statuses: ['Contacted'], counties: ['Greenville'], phone: 'has', activity: 'note_never',
    });
    // The exact operators applyContactFilters emits for these facets — if the drift check
    // ever stopped sharing that function, these disappear.
    expect(methodArgs('in')).toEqual([['status', ['Contacted']], ['county', ['Greenville']]]);
    expect(methodArgs('eq')).toContainEqual(['has_good_phone', true]);
    expect(methodArgs('is')).toEqual([['last_note_at', null]]);
  });

  it('throws on a query error so the caller can leave the row alone', async () => {
    reset([], { message: 'boom' });
    await expect(contactStillMatches(42, 'client-1', {})).rejects.toEqual({ message: 'boom' });
  });
});

// Regression guard for a live bug: both dedup callsites scanned AppContext's `contacts`,
// which holds ONE PAGE of the list. A CSV import therefore compared each row against ~50
// contacts and inserted the rest as duplicates, and address matching never worked at all
// because property_addresses isn't in LIST_FIELDS. Dedup now fetches its own corpus.
describe('dedup corpus', () => {
  it('fetchDedupIndex selects the matching keys, including property_addresses', async () => {
    reset([{ id: 1, first_name: 'Ada', last_name: 'Lovelace', county: 'Greenville' }]);
    const rows = await fetchDedupIndex('client-1');

    const fields = methodArgs('select')[0][0];
    // property_addresses is the one whose absence silently disabled address matching.
    for (const f of ['id', 'first_name', 'last_name', 'county', 'tax_map_ids', 'property_addresses', 'phones']) {
      expect(fields).toContain(f);
    }
    expect(methodArgs('eq')).toEqual([['client_id', 'client-1']]);
    // Paged, not capped at PAGE_SIZE — the whole point is that it isn't one page.
    expect(methodArgs('range')).toEqual([[0, 999]]);
    // Returned app-shaped so it can feed buildLookupMaps directly.
    expect(rows[0].firstName).toBe('Ada');
  });

  it('fetchDuplicateCandidates probes name, tax map id and address together', async () => {
    reset([]);
    await fetchDuplicateCandidates('client-1', {
      firstName: 'Ada', lastName: 'Lovelace',
      taxMapIds: ['0123-45'], propertyAddresses: ['12 Oak St'],
    });
    const expr = methodArgs('or')[0][0];
    expect(expr).toContain('and(first_name.ilike.Ada,last_name.ilike.Lovelace)');
    expect(expr).toContain('tax_map_ids.cs.["0123-45"]');
    expect(expr).toContain('property_addresses.cs.["12 Oak St"]');
    expect(methodArgs('eq')).toEqual([['client_id', 'client-1']]);
  });

  it('fetchDuplicateCandidates makes no query when there is nothing to match on', async () => {
    reset([]);
    await expect(fetchDuplicateCandidates('client-1', { firstName: 'Ada' })).resolves.toEqual([]);
    expect(h.state.calls).toEqual([]);
  });

  it('fetchDuplicateCandidates strips PostgREST metacharacters from user input', async () => {
    reset([]);
    await fetchDuplicateCandidates('client-1', {
      firstName: 'Ada', lastName: 'Love),lace"', propertyAddresses: ['12 Oak (St)'],
    });
    const expr = methodArgs('or')[0][0];
    // The injected punctuation is gone; what's left can't break out of or()/cs.[].
    expect(expr).toContain('last_name.ilike.Lovelace');
    expect(expr).toContain('property_addresses.cs.["12 Oak St"]');
  });
});
