import { supabase } from './supabase';
import { displayName } from './links';

// Connections & Ways In (PLAN.md; db/20261118_connections.sql).
//
// The column reads everything in one call, contact_ways_in(contact_id): a SECURITY
// INVOKER function, so RLS still decides what comes back. The only write in this step is
// the caller's own "how well do you know them", through set_familiarity — the grants
// leave no other way to write that table. The wording below is pure so it can be tested.

export const LEVELS = [
  { value: null,        label: "Haven't met", hint: "We haven't met" },
  { value: 'met',       label: 'Met',         hint: "We've met" },
  { value: 'know',      label: 'Know',        hint: 'Would take my call' },
  { value: 'know_well', label: 'Know well',   hint: 'Could ask a favor' },
];

export const WARMTH = [
  { value: 'cold',   label: 'Cold' },
  { value: 'common', label: 'Common ground' },
  { value: 'intro',  label: '1 intro away' },
  { value: 'warm',   label: 'Warm' },
];

const RANK = { met: 1, know: 2, know_well: 3 };

export async function fetchWaysIn(contactId) {
  const { data, error } = await supabase.rpc('contact_ways_in', { p_contact_id: contactId });
  if (error) throw error;
  return data ? normalizeWaysIn(data) : null;
}

// level: 'met' | 'know' | 'know_well', or null for "Haven't met" (deletes the row).
export async function setFamiliarity(contactId, level) {
  const { error } = await supabase.rpc('set_familiarity', { p_contact_id: contactId, p_level: level });
  if (error) throw error;
  // The contact list shows each row's level; tell it, rather than make it refetch.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FAMILIARITY_CHANGED, { detail: { contactId, level } }));
  }
}

export const FAMILIARITY_CHANGED = 'taraform:familiarity';

// Every teammate's familiarity rows for a set of contacts (the list's loaded rows). RLS
// limits it to the caller's workspaces. Returns Map(contactId → [{ userId, level }]).
export async function fetchFamiliarityFor(contactIds) {
  const out = new Map();
  for (let i = 0; i < contactIds.length; i += 200) {
    const { data, error } = await supabase.from('contact_familiarity')
      .select('contact_id,user_id,level').in('contact_id', contactIds.slice(i, i + 200));
    if (error) throw error;
    for (const r of data || []) {
      if (!out.has(r.contact_id)) out.set(r.contact_id, []);
      out.get(r.contact_id).push({ userId: r.user_id, level: r.level });
    }
  }
  return out;
}

// What the list row shows: your own level when you've set one, otherwise the warmest
// teammate's (flagged mine: false so it reads as "the team knows them", not you).
// null when nobody on the team has met them.
export function listLevel(rows, me) {
  if (!rows?.length) return null;
  const own = rows.find(r => r.userId === me);
  if (own) return { level: own.level, mine: true };
  return { level: strongest(rows, me).level, mine: false };
}

export function levelLabel(level) {
  return LEVELS.find(l => l.value === level)?.label ?? '';
}

// The RPC returns snake_case jsonb; give the UI one camelCase shape with names joined.
export function normalizeWaysIn(d) {
  return {
    warmth: d.warmth || 'cold',
    familiarity: (d.familiarity || []).map(f => ({ userId: f.user_id, level: f.level })),
    connections: (d.connections || []).map(c => ({
      id: c.id,
      contactId: c.contact_id,
      name: displayName({ firstName: c.first_name, lastName: c.last_name }),
      description: c.description || '',
      referredBy: c.referred_by,
      unsure: !!c.unsure,
      noteBody: c.note_body || '',
      knownBy: (c.known_by || []).map(k => ({ userId: k.user_id, level: k.level })),
    })),
    // People at the same company. Derived from company links, never stored (PLAN.md:
    // a shared company is a path, not a connection), so they have no id and no edit.
    colleagues: (d.colleagues || []).map(c => ({
      contactId: c.contact_id,
      name: displayName({ firstName: c.first_name, lastName: c.last_name }),
      companyId: c.company_id,
      companyName: c.company_name || '',
      title: c.title || '',
      knownBy: (c.known_by || []).map(k => ({ userId: k.user_id, level: k.level })),
    })),
    groups: (d.groups || []).map(g => ({
      id: g.id,
      name: g.name,
      kind: g.kind,
      teammates: g.teammates || [],
      knownContacts: (g.known_contacts || []).map(k => ({
        contactId: k.contact_id,
        name: displayName({ firstName: k.first_name, lastName: k.last_name }),
        knownBy: (k.known_by || []).map(x => ({ userId: x.user_id, level: x.level })),
      })),
    })),
  };
}

// "You" for the signed-in user, otherwise the teammate's label. Labels come from
// fetchAuthorNames (email before the @) until display names exist (PLAN.md step 5);
// this is the one place to change when they do.
export function whoLabel(userId, { me, names }) {
  if (userId && userId === me) return 'You';
  return names?.get(userId) || 'A former teammate';
}

// "You know Pat well" / "Kim has met Pat". `who` is the output of whoLabel.
export function knowsPhrase(who, level, object) {
  const you = who === 'You';
  switch (level) {
    case 'know_well': return `${who} ${you ? 'know' : 'knows'} ${object} well`;
    case 'know':      return `${who} ${you ? 'know' : 'knows'} ${object}`;
    case 'met':       return `${who} ${you ? 'have' : 'has'} met ${object}`;
    default:          return '';
  }
}

// The strongest familiarity in a list, the signed-in user first among equals: "you know
// them well" is a better way in than "a teammate does", because it needs no one else.
export function strongest(list, me) {
  return [...(list || [])].sort((a, b) =>
    (RANK[b.level] || 0) - (RANK[a.level] || 0) ||
    (b.userId === me) - (a.userId === me)
  )[0] || null;
}

// "Both at Gallo Company" (with the colleague's title when there is one).
export function colleagueLine(c) {
  return `Both at ${c.companyName || 'the same company'}${c.title ? ` · ${c.name} is ${c.title}` : ''}`;
}

// A colleague in the shape describeWaysIn reads a connection in.
function asConnection(c) {
  return { ...c, description: `Both at ${c.companyName || 'the same company'}`, referredBy: null, unsure: false };
}

// How two people know each other, as one line: the description, then who referred whom.
// A bare "Referred" description with a direction set says nothing the direction doesn't.
export function howTheyKnow(c) {
  const direction = c.referredBy == null ? ''
    : c.referredBy === c.contactId ? `${c.name} referred them` : `They referred ${c.name}`;
  const desc = direction && /^referred\.?$/i.test(c.description.trim()) ? '' : c.description.trim().replace(/[.\s]+$/, '');
  return [desc, direction].filter(Boolean).join(' · ');
}

// The one sentence under the meter: the best way in, or an excuse to reach out.
// Follows the same order as the warmth rule in contact_ways_in, so the sentence always
// explains the step the meter shows.
export function describeWaysIn(w, ctx) {
  if (!w) return { headline: '', detail: '' };
  const label = id => whoLabel(id, ctx);

  if (w.warmth === 'warm') {
    const f = strongest(w.familiarity.filter(x => RANK[x.level] >= 2), ctx.me);
    if (f.userId === ctx.me) {
      return { headline: 'Call them yourself.', detail: `${knowsPhrase('You', f.level, 'them')}.` };
    }
    return { headline: `Best way in: ask ${label(f.userId)}.`, detail: `${knowsPhrase(label(f.userId), f.level, 'them')}.` };
  }

  if (w.warmth === 'intro') {
    // Connections and colleagues alike; a stored connection wins a tie, being the more
    // specific fact. Prefer a confirmed one if it is just as warm.
    const pool = [...w.connections, ...(w.colleagues || []).map(asConnection)];
    const best = Math.max(...pool.map(c => RANK[strongest(c.knownBy, ctx.me)?.level] || 0));
    const c = pool.find(x => !x.unsure && (RANK[strongest(x.knownBy, ctx.me)?.level] || 0) === best)
      || pool.find(x => (RANK[strongest(x.knownBy, ctx.me)?.level] || 0) === best);
    const k = strongest(c.knownBy, ctx.me);
    const how = howTheyKnow(c) ? ` How they know each other: ${howTheyKnow(c)}.` : '';
    const unsure = c.unsure ? ' Not confirmed.' : '';
    const ask = k.userId === ctx.me ? `ask ${c.name}` : `${label(k.userId)} can ask ${c.name}`;
    return {
      headline: `Best way in: ${ask}.`,
      detail: `${knowsPhrase(label(k.userId), k.level, c.name)}.${how}${unsure}`,
    };
  }

  if (w.warmth === 'common') {
    const mine = w.groups.find(g => g.teammates.includes(ctx.me));
    if (mine) return { headline: `Excuse to reach out: you're both in ${mine.name}.`, detail: '' };
    const team = w.groups.find(g => g.teammates.length);
    if (team) {
      return { headline: `Excuse to reach out: ${label(team.teammates[0])} is in ${team.name} too.`, detail: '' };
    }
    const viaContact = w.groups.find(g => g.knownContacts.length);
    if (viaContact) {
      const kc = viaContact.knownContacts[0];
      const k = strongest(kc.knownBy, ctx.me);
      return {
        headline: `Excuse to reach out: ${kc.name} is in ${viaContact.name} too.`,
        detail: `${knowsPhrase(label(k.userId), k.level, kc.name)}.`,
      };
    }
    const met = strongest(w.familiarity, ctx.me);
    if (met) {
      return {
        headline: met.userId === ctx.me ? "You've met them." : `${label(met.userId)} has met them.`,
        detail: 'Having met is a reason to call.',
      };
    }
  }

  return { headline: 'No way in yet.', detail: 'Say how well you know them, below.' };
}

// ── Writing connections (step 3: the Add connection form) ──────────────────────────────

// Quick picks for "how they know each other". Plain text in `description`; "Referred"
// also asks which of the two did the referring (referred_by).
export const HOW_PICKS = ['Work together', 'Family', 'Friends', 'Neighbors', 'Did a deal together', 'Referred'];

function connectionError(error) {
  if (error?.code === '23505') return new Error('They are already connected.');
  return error;
}

// Connect two people. Either order: the trigger sorts the pair and stamps the rest.
// sourceNoteId: the note it was found in, quoted on the column as the reason.
export async function connectPeople({ contactId, otherId, description, referredBy = null, unsure = false, sourceNoteId = null }) {
  const { data, error } = await supabase
    .from('contact_connections')
    .insert({ a_id: contactId, b_id: otherId, description: description?.trim() || null, referred_by: referredBy, unsure,
      ...(sourceNoteId ? { source_note_id: sourceNoteId } : {}) })
    .select('id')
    .single();
  if (error) throw connectionError(error);
  return data.id;
}

// Only how they know each other, who referred whom and "not confirmed" can change. To
// connect someone else, remove this one and add another.
export async function updatePeopleConnection(id, { description, referredBy = null, unsure = false }) {
  const { error } = await supabase
    .from('contact_connections')
    .update({ description: description?.trim() || null, referred_by: referredBy, unsure })
    .eq('id', id);
  if (error) throw error;
}

export async function disconnectPeople(id) {
  const { error } = await supabase.from('contact_connections').delete().eq('id', id);
  if (error) throw error;
}
