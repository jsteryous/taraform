import { supabase } from './supabase';
import { displayName } from './links';
import { strongest, knowsPhrase, whoLabel } from './waysIn';

// The dashboard's "what could I do today" cards (Connections workspaces only):
//
//   Introductions to ask for: a contact we're pursuing whom nobody knows, reachable
//     through someone who is known — a stored connection, or a known person at the same
//     company. A company counts as known when anyone linked to it is: knowing the CFO
//     *is* the relationship with the company, so it never needs an introduction.
//   Reasons to reach out: a contact we're pursuing who shares a group with you, a
//     teammate, or someone known; or someone you've marked as Met or Know well
//     who hasn't had a note in a while.
//
// Same rules as the contact page's warmth (contact_ways_in): "known" means Met or Know
// well (any level; "Know" was folded into Met 2026-11-20), a shared company is a path and never a stored connection, and nothing is
// inferred from note counts. planOutreach is pure; fetchOutreachData only gathers the
// neighbourhood it needs, so the read stays small however large an imported list gets.

const RANK = { met: 1, know_well: 3 };
const CHUNK = 200;

export const OUTREACH_DEFAULTS = { statuses: ['Target', 'Prospect'], quietDays: 60 };

async function inChunks(ids, fetchChunk) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...await fetchChunk(ids.slice(i, i + CHUNK)));
  return out;
}

async function rows(q) {
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function fetchOutreachData(clientId) {
  const [fam, conns, members] = await Promise.all([
    rows(supabase.from('contact_familiarity').select('contact_id,user_id,level').eq('client_id', clientId)),
    rows(supabase.from('contact_connections').select('a_id,b_id,description,referred_by,unsure').eq('client_id', clientId)),
    rows(supabase.from('contact_group_members').select('group_id,contact_id,user_id,contact_groups(name)').eq('client_id', clientId)),
  ]);
  const familiarity = fam.map(f => ({ contactId: f.contact_id, userId: f.user_id, level: f.level }));
  const known = [...new Set(familiarity.filter(f => RANK[f.level] >= 1).map(f => f.contactId))];

  // Companies a known person is at, then everyone at those companies.
  const theirLinks = await inChunks(known, ids =>
    rows(supabase.from('contact_links').select('company_id').eq('client_id', clientId).in('person_id', ids)));
  const companyIds = [...new Set(theirLinks.map(l => l.company_id))];
  const links = (await inChunks(companyIds, ids =>
    rows(supabase.from('contact_links').select('company_id,person_id,title').eq('client_id', clientId).in('company_id', ids))))
    .map(l => ({ companyId: l.company_id, personId: l.person_id, title: l.title || '' }));

  const ids = new Set(familiarity.map(f => f.contactId));
  for (const c of conns) { ids.add(c.a_id); ids.add(c.b_id); }
  for (const m of members) if (m.contact_id) ids.add(m.contact_id);
  for (const l of links) { ids.add(l.companyId); ids.add(l.personId); }
  const contactRows = await inChunks([...ids], chunk =>
    rows(supabase.from('property_crm_contacts').select('id,kind,first_name,last_name,status,last_note_at')
      .eq('client_id', clientId).in('id', chunk)));

  return {
    contacts: new Map(contactRows.map(c => [c.id, {
      id: c.id, kind: c.kind || 'person', status: c.status, lastNoteAt: c.last_note_at,
      name: displayName({ firstName: c.first_name, lastName: c.last_name }),
    }])),
    familiarity,
    connections: conns.map(c => ({ aId: c.a_id, bId: c.b_id, description: c.description || '', referredBy: c.referred_by, unsure: !!c.unsure })),
    links,
    groupMembers: members.map(m => ({ groupId: m.group_id, groupName: m.contact_groups?.name || 'a group', contactId: m.contact_id, userId: m.user_id })),
  };
}

// → { intros: [...], reasons: [...] }, each sorted best first.
export function planOutreach(data, { me, statuses = OUTREACH_DEFAULTS.statuses, quietDays = OUTREACH_DEFAULTS.quietDays, now = Date.now() } = {}) {
  const { contacts, familiarity = [], connections = [], links = [], groupMembers = [] } = data;
  const famBy = new Map();
  for (const f of familiarity) {
    if (!famBy.has(f.contactId)) famBy.set(f.contactId, []);
    famBy.get(f.contactId).push(f);
  }
  const best = id => strongest(famBy.get(id), me);
  const knownDirectly = id => (RANK[best(id)?.level] || 0) >= 1;
  // `links` holds every link of each company a known person is at (fetchOutreachData), so
  // this set is complete for the companies that matter.
  const knownCompanies = new Set(links.filter(l => knownDirectly(l.personId)).map(l => l.companyId));
  const isKnown = id => knownDirectly(id) || knownCompanies.has(id);
  const pursued = id => { const c = contacts.get(id); return !!c && statuses.includes(c.status); };
  const statusOrder = id => statuses.indexOf(contacts.get(id).status);

  // ── Introductions ──
  const intros = new Map(); // targetId → best path
  const score = p => [RANK[p.helperLevel], p.unsure ? 0 : 1, p.helperUserId === me ? 1 : 0, p.how === 'connection' ? 1 : 0];
  const better = (a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  function offer(targetId, helperId, path) {
    if (targetId === helperId || !pursued(targetId) || isKnown(targetId) || !contacts.get(helperId)) return;
    const k = best(helperId);
    const p = { targetId, helperId, helperUserId: k.userId, helperLevel: k.level, unsure: false, ...path };
    const cur = intros.get(targetId);
    if (!cur || better(p, cur)) intros.set(targetId, p);
  }
  for (const c of connections) {
    const how = { how: 'connection', description: c.description, unsure: c.unsure };
    if (isKnown(c.aId)) offer(c.bId, c.aId, { ...how, referred: c.referredBy === c.bId ? 'they' : c.referredBy === c.aId ? 'helper' : null });
    if (isKnown(c.bId)) offer(c.aId, c.bId, { ...how, referred: c.referredBy === c.aId ? 'they' : c.referredBy === c.bId ? 'helper' : null });
  }
  const byCompany = new Map();
  for (const l of links) {
    if (!byCompany.has(l.companyId)) byCompany.set(l.companyId, []);
    byCompany.get(l.companyId).push(l);
  }
  for (const [companyId, people] of byCompany) {
    for (const helper of people.filter(l => isKnown(l.personId))) {
      for (const other of people) {
        if (other.personId !== helper.personId) {
          offer(other.personId, helper.personId, { how: 'colleague', companyId, targetTitle: other.title });
        }
      }
    }
  }
  const introList = [...intros.values()].sort((a, b) =>
    (better(a, b) ? -1 : better(b, a) ? 1 : 0) ||
    statusOrder(b.targetId) - statusOrder(a.targetId) ||
    contacts.get(a.targetId).name.localeCompare(contacts.get(b.targetId).name));

  // ── Reasons to reach out ──
  const reasons = new Map(); // targetId → reason
  const byGroup = new Map();
  for (const m of groupMembers) {
    if (!byGroup.has(m.groupId)) byGroup.set(m.groupId, { name: m.groupName, users: [], contacts: [] });
    const g = byGroup.get(m.groupId);
    if (m.userId) g.users.push(m.userId); else if (m.contactId) g.contacts.push(m.contactId);
  }
  // Who in the group makes it common ground, best first: you, then someone known, then a teammate.
  const withRank = w => (w.type === 'you' ? 10 : w.type === 'contact' ? RANK[w.level] * 2 : 1);
  for (const g of byGroup.values()) {
    for (const t of g.contacts) {
      if (!pursued(t) || isKnown(t) || intros.has(t)) continue;
      const candidates = [];
      if (g.users.includes(me)) candidates.push({ type: 'you' });
      for (const c of g.contacts) {
        if (c !== t && isKnown(c) && contacts.get(c)) candidates.push({ type: 'contact', contactId: c, userId: best(c).userId, level: best(c).level });
      }
      for (const u of g.users) if (u !== me) candidates.push({ type: 'teammate', userId: u });
      if (!candidates.length) continue;
      const w = candidates.sort((a, b) => withRank(b) - withRank(a))[0];
      const r = { kind: 'group', targetId: t, groupName: g.name, with: w, rank: withRank(w) };
      const cur = reasons.get(t);
      if (!cur || r.rank > cur.rank) reasons.set(t, r);
    }
  }
  const cutoff = now - quietDays * 86400000;
  for (const f of familiarity) {
    if (f.userId !== me || !pursued(f.contactId) || reasons.has(f.contactId)) continue;
    const last = contacts.get(f.contactId).lastNoteAt;
    if (last && new Date(last).getTime() > cutoff) continue;
    reasons.set(f.contactId, { kind: 'known', targetId: f.contactId, level: f.level, lastNoteAt: last || null, rank: RANK[f.level] * 2 + 1 });
  }
  const reasonList = [...reasons.values()].sort((a, b) =>
    b.rank - a.rank ||
    statusOrder(b.targetId) - statusOrder(a.targetId) ||
    contacts.get(a.targetId).name.localeCompare(contacts.get(b.targetId).name));

  return { intros: introList, reasons: reasonList };
}

// One line under an intro: who to ask and why they can help.
export function introLine(p, contacts, ctx) {
  const helper = contacts.get(p.helperId).name;
  const company = p.companyId ? contacts.get(p.companyId)?.name : '';
  const who = whoLabel(p.helperUserId, ctx);
  const knows = knowsPhrase(who, p.helperLevel, helper);
  const ask = who === 'You' ? `Ask ${helper}` : `${who} can ask ${helper}`;
  if (p.how === 'colleague') {
    return `${ask}: they work together at ${company || 'the same company'}${p.targetTitle ? ` (${p.targetTitle})` : ''}. ${knows}.`;
  }
  const how = p.description.trim().replace(/[.\s]+$/, '');
  const referred = p.referred === 'they' ? 'they referred ' + helper : p.referred === 'helper' ? `${helper} referred them` : '';
  const detail = [how, referred].filter(Boolean).join(' · ');
  return `${ask}. ${knows}${detail ? ` · ${detail}` : ''}.${p.unsure ? ' Not confirmed.' : ''}`;
}

// One line under a reason to reach out.
export function reasonLine(r, contacts, ctx, now = Date.now()) {
  if (r.kind === 'group') {
    const w = r.with;
    if (w.type === 'you') return `You're both in ${r.groupName}.`;
    if (w.type === 'contact') {
      const name = contacts.get(w.contactId).name;
      return `In ${r.groupName} with ${name}. ${knowsPhrase(whoLabel(w.userId, ctx), w.level, name)}.`;
    }
    return `${whoLabel(w.userId, ctx)} is in ${r.groupName} too.`;
  }
  const lead = knowsPhrase('You', r.level, 'them');
  if (!r.lastNoteAt) return `${lead}, and there's no note yet.`;
  return `${lead}. Last note ${ago(r.lastNoteAt, now)}.`;
}

function ago(iso, now) {
  const days = Math.floor((now - new Date(iso).getTime()) / 86400000);
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months < 24 ? `${months} months ago` : `${Math.round(days / 365)} years ago`;
}
