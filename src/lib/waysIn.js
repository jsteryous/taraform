import { supabase } from './supabase';
import { displayName, fetchConnections } from './links';

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

// You've marked them Met (Know / Know well are 'warm' and handled before this).
export function metByMe(w, me) {
  return !!w?.familiarity?.some(f => f.userId === me && f.level === 'met');
}

// The meter step to show. The server's warmth ranks an intro above having met; for the
// person who has met them it's the other way round, so their meter reads "You've met"
// at the intro step instead of "1 intro away". Teammates still see the server's step.
export function meterStep(w, me) {
  const i = WARMTH.findIndex(s => s.value === (w?.warmth || 'cold'));
  if (w?.warmth !== 'warm' && metByMe(w, me)) return { index: WARMTH.findIndex(s => s.value === 'intro'), label: "You've met" };
  return { index: i, label: WARMTH[i].label };
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

  // You've met them yourself: call them. An introduction is for someone you can't reach,
  // and asking a third party to introduce you to a person you've already met is odd. Who
  // else knows them is still listed under "Who they know".
  if (metByMe(w, ctx.me)) {
    return { headline: "You've met them, so reach out yourself.", detail: 'Having met is a reason to call.' };
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

  return { headline: 'Way in: the front door.', detail: 'Reach out directly. If someone does know them, say so below.' };
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

// ── Companies ──────────────────────────────────────────────────────────────────────────
//
// A company has no ways in of its own: you know a company through the people at it. So
// its column is built from its linked people's — each one's contact_ways_in, read in
// parallel — and summarised by the pure companyWaysIn below. Nothing is stored for the
// company itself, and every edit (familiarity, connections, groups) happens on a person.

const WARMTH_RANK = Object.fromEntries(WARMTH.map((w, i) => [w.value, i]));
const MAX_PEOPLE = 40; // a company page reads one call per person; past this, the warmest few are enough

export async function fetchCompanyWaysIn(company, me) {
  const links = (await fetchConnections(company)).slice(0, MAX_PEOPLE);
  const ways = await Promise.all(links.map(l => fetchWaysIn(l.contact.id).catch(() => null)));
  return companyWaysIn(
    links.map(l => ({ id: l.contact.id, name: l.contact.name, title: l.title })),
    new Map(links.map((l, i) => [l.contact.id, ways[i]])),
    me,
  );
}

// people: [{ id, name, title }]; waysById: Map(id → normalizeWaysIn shape, or null).
// → { warmth, people: [{ id, name, title, warmth, familiarity, ways }] warmest first,
//     best (the warmest person, or null), outside: connections to people not at this
//     company, each with `via`, groups: each with the people here who are in it }.
export function companyWaysIn(people, waysById, me) {
  const here = new Set(people.map(p => p.id));
  const list = people.map(p => {
    const w = waysById.get(p.id) || null;
    return { ...p, ways: w, warmth: w?.warmth || 'cold', familiarity: w?.familiarity || [] };
  });
  const familiarityRank = p => RANK[strongest(p.familiarity, me)?.level] || 0;
  list.sort((a, b) =>
    WARMTH_RANK[b.warmth] - WARMTH_RANK[a.warmth] ||
    familiarityRank(b) - familiarityRank(a) ||
    a.name.localeCompare(b.name));

  const outside = [];
  const seen = new Set();
  for (const p of list) {
    for (const c of p.ways?.connections || []) {
      if (here.has(c.contactId) || seen.has(`${c.contactId}:${p.id}`)) continue;
      seen.add(`${c.contactId}:${p.id}`);
      outside.push({ ...c, via: { id: p.id, name: p.name } });
    }
  }
  const knownRank = c => RANK[strongest(c.knownBy, me)?.level] || 0;
  outside.sort((a, b) => knownRank(b) - knownRank(a) || a.name.localeCompare(b.name));

  const groups = new Map();
  for (const p of list) {
    for (const g of p.ways?.groups || []) {
      if (!groups.has(g.id)) groups.set(g.id, { ...g, people: [] });
      groups.get(g.id).people.push({ id: p.id, name: p.name });
    }
  }

  return {
    warmth: list[0]?.warmth || 'cold',
    people: list,
    best: list[0] || null,
    outside,
    groups: [...groups.values()],
  };
}

// The sentence under a company's meter: the best way in is the best way in to its
// warmest person, said with their name.
export function describeCompanyWaysIn(cw, ctx) {
  if (!cw.people.length) return { headline: 'Nobody linked yet.', detail: 'Link the people who work here, in the People panel.' };
  const p = cw.best;
  if (!p.ways) return { headline: 'Way in: the front door.', detail: 'Reach out directly.' };
  if (p.warmth === 'warm') {
    const f = strongest(p.familiarity.filter(x => RANK[x.level] >= 2), ctx.me);
    const title = p.title ? `, ${p.title}` : '';
    if (f.userId === ctx.me) return { headline: `Call ${p.name}${title} yourself.`, detail: `${knowsPhrase('You', f.level, p.name)}.` };
    const who = whoLabel(f.userId, ctx);
    return { headline: `Best way in: ask ${who} about ${p.name}${title}.`, detail: `${knowsPhrase(who, f.level, p.name)}.` };
  }
  if (p.warmth === 'cold') return { headline: 'Way in: the front door.', detail: 'Nobody on the team knows anyone here, so reach out directly.' };
  // Name the person in the person-level sentence ("Best way in to Pat Smith: …").
  const inner = describeWaysIn(p.ways, ctx);
  const headline = inner.headline
    .replace(/^Best way in:/, `Best way in to ${p.name}:`)
    .replace(/^Excuse to reach out:/, `Excuse to call ${p.name}:`)
    .replace(/ met them\.$/, ` met ${p.name}.`)
    .replace(/^You've met them, so reach out yourself\.$/, `You've met ${p.name}, so reach out yourself.`);
  return { headline, detail: inner.detail };
}
