import { supabase } from './supabase';
import { displayName } from './links';
import { fetchGroups } from './groups';
import { buildNameIndex } from './noteFinder';

// The note finder's view of a workspace: every person's and company's name, every group
// and its other names, and the terms the team said to stop offering. Loaded once per
// workspace per session (PLAN.md: Bank is small enough) and refreshed after something is
// added. The same index answers @-mentions.
//
// Reads the corpus, never the loaded list page (src/components/CLAUDE.md: `contacts` is
// one page), or a name on page two would never be recognised.

const cache = new Map(); // clientId -> Promise<{ index, ignored }>

async function load(clientId) {
  const CHUNK = 1000;
  const rows = [];
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from('property_crm_contacts')
      .select('id,first_name,last_name,kind,status')
      .eq('client_id', clientId)
      .order('id')
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < CHUNK) break;
  }
  const [groups, ignoredRows] = await Promise.all([
    fetchGroups(clientId),
    supabase.from('finder_ignored').select('term').eq('client_id', clientId)
      .then(({ data, error }) => { if (error) throw error; return data || []; }),
  ]);
  const toEntry = r => ({ id: r.id, name: displayName({ firstName: r.first_name, lastName: r.last_name }), status: r.status });
  return {
    index: buildNameIndex({
      people: rows.filter(r => r.kind !== 'company').map(toEntry),
      companies: rows.filter(r => r.kind === 'company').map(toEntry),
      groups,
    }),
    ignored: new Set(ignoredRows.map(r => r.term)),
  };
}

export function fetchFinderIndex(clientId) {
  if (!clientId) return Promise.resolve({ index: buildNameIndex(), ignored: new Set() });
  if (!cache.has(clientId)) {
    const p = load(clientId);
    cache.set(clientId, p);
    p.catch(() => cache.delete(clientId)); // a failed load is retried next time
  }
  return cache.get(clientId);
}

// Call after adding a contact or group, so the next note recognises it.
export function invalidateFinderIndex(clientId) {
  cache.delete(clientId);
}

// "Stop offering this" for the whole workspace. Stored lowercased.
export async function ignoreTerm(clientId, term) {
  const t = String(term || '').trim().toLowerCase();
  if (!t) return;
  const { error } = await supabase.from('finder_ignored').insert({ client_id: clientId, term: t });
  if (error && error.code !== '23505') throw error;
  invalidateFinderIndex(clientId);
}
