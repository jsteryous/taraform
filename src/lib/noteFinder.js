// The note finder (PLAN.md, Connections & Ways In: "the note is the input"). Pure: note
// text + the workspace's name index in, what the note mentions out. No AI and no guessing
// at meaning — it matches names the workspace already has, exactly, and points out
// capitalised phrases it doesn't know so they can be added with one tap.
//
//   people     a full name matching exactly one person         → linked at once, with Undo
//   ambiguous  a full name matching two or more people         → "which one?"
//   groups     a group's name or any other name it has          → added at once, with Undo
//   companies  a company's name                                 → one tap: "works there"
//   unknown    a capitalised phrase nobody has ("Drew Parker")  → add contact / group / ignore
//
// First names alone are never matched, on purpose: "talked with Matt" is not a link.

// Words and runs of words, with "&" kept as its own token so "Lee & Associates" matches.
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*|&/gu;

// "Parker's" → "parker", "Inc." → "inc". The key a token is matched on.
function keyOf(raw) {
  return raw.toLowerCase().replace(/['’]s$/, '').replace(/[.'’-]+$/, '');
}

export function tokenize(text) {
  const out = [];
  for (const m of String(text || '').matchAll(TOKEN)) {
    out.push({ raw: m[0], key: keyOf(m[0]), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// A name as the finder stores it: its tokens' keys joined by single spaces.
export function nameKey(name) {
  return tokenize(name).map(t => t.key).join(' ');
}

const MAX_WORDS = 8;

// people / companies: [{ id, name, status? }]; groups: [{ id, name, aliases }].
// Built once per workspace and reused for every note.
export function buildNameIndex({ people = [], companies = [], groups = [] } = {}) {
  const byKey = new Map(); // key -> { people: [], companies: [], groups: [] }
  const slot = k => {
    if (!byKey.has(k)) byKey.set(k, { people: [], companies: [], groups: [] });
    return byKey.get(k);
  };
  for (const p of people) {
    const k = nameKey(p.name);
    if (k.split(' ').length >= 2) slot(k).people.push(p); // full names only
  }
  for (const c of companies) {
    const k = nameKey(c.name);
    if (k) slot(k).companies.push(c);
  }
  for (const g of groups) {
    for (const n of [g.name, ...(g.aliases || [])]) {
      const k = nameKey(n);
      if (k && !slot(k).groups.some(x => x.id === g.id)) slot(k).groups.push(g);
    }
  }
  return { byKey, people, companies, groups };
}

// Words that start a sentence or a phrase without being part of a name: "Called Drew
// Parker" is about Drew Parker. Stripped from the front of an unknown phrase.
const LEAD_WORDS = new Set(`a an the i we he she they it his her their our my your this that these those
  called call met meet talked talk spoke speak left sent send emailed email texted text saw see had have got get
  lunch coffee dinner drinks breakfast introduced intro asked ask told tell heard hear went go
  and but or so if when then also just per re fyi via with from to at for on in by of about after before
  mr mrs ms dr
  monday tuesday wednesday thursday friday saturday sunday today tomorrow yesterday
  january february march april may june july august september october november december
  jan feb mar apr jun jul aug sep sept oct nov dec`.split(/\s+/).filter(Boolean));

// Joining words allowed inside a capitalised phrase ("Bank of America", "Lee & Associates").
const JOINERS = new Set(['&', 'of', 'and', 'the', 'de', 'la', 'van', 'von']);

const GROUPISH = /\b(club|cc|country club|church|parish|chapel|synagogue|temple|ministry|university|college|school|academy|alumni|rotary|lions|kiwanis|association|society|chamber|league|board|foundation|lodge|fellowship|team)\b/i;
const COMPANYISH = /\b(associates|llc|inc|corp|corporation|company|co|partners|group|holdings|properties|realty|construction|capital|industries|enterprises|services|bank|trust|law|firm|ltd|lp|llp|pllc|pa|development|investments|management|solutions|consulting|builders|homes|farms)\b/i;

const isCap = t => /^\p{Lu}/u.test(t.raw);

// What a phrase most likely names, for the order of the buttons. Only an order: every
// choice is offered.
export function guessPhraseType(phrase) {
  if (GROUPISH.test(phrase)) return 'group';
  if (COMPANYISH.test(phrase)) return 'company';
  return 'person';
}

// opts:
//   selfId    the note's own contact: never linked to itself, its name never "unknown"
//   ignored   Set of lowercased terms the workspace said to stop offering
//   picked    Map of name key -> person id, from @-mentions: settles "which one?"
export function findInNote(text, index, { selfId = null, ignored = new Set(), picked = new Map() } = {}) {
  const tokens = tokenize(text);
  const used = new Array(tokens.length).fill(false);
  const out = { people: [], ambiguous: [], groups: [], companies: [], unknown: [], spans: [] };
  const seen = new Set();
  const once = (key) => (seen.has(key) ? false : (seen.add(key), true));

  // Known names, longest first at each position.
  for (let i = 0; i < tokens.length; i++) {
    for (let n = Math.min(MAX_WORDS, tokens.length - i); n >= 1; n--) {
      const words = tokens.slice(i, i + n);
      if (words[0].raw === '&' || words[n - 1].raw === '&') continue;
      const key = words.map(t => t.key).join(' ');
      const hit = index.byKey.get(key);
      if (!hit) continue;
      const start = words[0].start;
      const end = words[n - 1].end;
      const said = String(text).slice(start, end);

      const people = hit.people.filter(p => p.id !== selfId);
      const isSelf = hit.people.some(p => p.id === selfId);
      // A one-word company or group must be written with a capital in the note, so a
      // group called "Golf" still matches "golf" but a company called "Apple" doesn't
      // match "an apple". Groups are interests too, so they match in any case.
      const companies = n === 1 && !isCap(words[0]) ? [] : hit.companies;
      const groups = hit.groups;

      let matched = false;
      if (people.length || isSelf) {
        matched = true;
        const pick = picked.get(key);
        const chosen = pick != null ? people.find(p => p.id === pick) : people.length === 1 ? people[0] : null;
        if (chosen) {
          if (once(`p${chosen.id}`)) out.people.push({ id: chosen.id, name: chosen.name, text: said });
          out.spans.push({ start, end, kind: 'person', id: chosen.id });
        } else if (people.length > 1 && once(`a${key}`)) {
          out.ambiguous.push({ name: said, key, candidates: people });
        }
      } else if (groups.length) {
        matched = true;
        const g = groups[0];
        if (once(`g${g.id}`)) out.groups.push({ id: g.id, name: g.name, text: said });
        out.spans.push({ start, end, kind: 'group', id: g.id });
      } else if (companies.length) {
        matched = true;
        const c = companies[0];
        if (once(`c${c.id}`)) out.companies.push({ id: c.id, name: c.name, text: said });
        out.spans.push({ start, end, kind: 'company', id: c.id });
      }
      if (matched) {
        for (let j = i; j < i + n; j++) used[j] = true;
        i += n - 1;
        break;
      }
    }
  }

  // Capitalised phrases nobody has: runs of capitalised words (joiners allowed inside),
  // with sentence-starting words like "Called" taken off the front.
  let i = 0;
  while (i < tokens.length) {
    if (used[i] || !isCap(tokens[i])) { i++; continue; }
    let j = i;
    while (j + 1 < tokens.length && !used[j + 1] &&
           (isCap(tokens[j + 1]) || (JOINERS.has(tokens[j + 1].key) && j + 2 < tokens.length && isCap(tokens[j + 2]) && !used[j + 2]))) {
      // Stop at a sentence break: "…Parker. Then…".
      if (/[.!?;:]$/.test(tokens[j].raw) && !/^(?:\p{Lu}\.)+$/u.test(tokens[j].raw)) break;
      if (/[,]/.test(text.slice(tokens[j].end, tokens[j + 1].start))) break;
      j++;
    }
    let run = tokens.slice(i, j + 1);
    while (run.length && (LEAD_WORDS.has(run[0].key) || JOINERS.has(run[0].key))) run = run.slice(1);
    while (run.length && (JOINERS.has(run[run.length - 1].key) || LEAD_WORDS.has(run[run.length - 1].key))) run = run.slice(0, -1);
    if (run.length >= 2) {
      const phrase = text.slice(run[0].start, run[run.length - 1].end).replace(/['’]s$/, '').replace(/[.,;:!?]+$/, '');
      const key = nameKey(phrase);
      if (!ignored.has(key) && !ignored.has(phrase.toLowerCase()) && once(`u${key}`)) {
        out.unknown.push({ phrase, key, type: guessPhraseType(phrase) });
      }
    }
    i = j + 1;
  }

  out.spans.sort((a, b) => a.start - b.start);
  return out;
}

// Split a note into plain text and recognised names, for rendering names as links.
export function segmentNote(text, spans) {
  const out = [];
  let at = 0;
  for (const s of spans) {
    if (s.start < at) continue;
    if (s.start > at) out.push({ text: text.slice(at, s.start) });
    out.push({ text: text.slice(s.start, s.end), kind: s.kind, id: s.id });
    at = s.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

// "First Middle Last" → { firstName: 'First Middle', lastName: 'Last' }, the split Add
// Contact would make for a typed full name.
export function splitName(phrase) {
  const words = String(phrase || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { firstName: words[0] || '', lastName: '' };
  return { firstName: words.slice(0, -1).join(' '), lastName: words[words.length - 1] };
}

// @-mention suggestions: everything whose name has a word starting with what was typed
// after the @, people first. `query` may be several words ("drew par").
export function mentionMatches(index, query, { selfId = null, limit = 6 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const parts = q.split(/\s+/);
  const hits = (name) => {
    const words = name.toLowerCase().split(/\s+/);
    return parts.every(p => words.some(w => w.startsWith(p))) || name.toLowerCase().startsWith(q);
  };
  const people = index.people.filter(p => p.id !== selfId && hits(p.name)).map(p => ({ kind: 'person', ...p }));
  const companies = index.companies.filter(c => hits(c.name)).map(c => ({ kind: 'company', ...c }));
  const groups = index.groups.filter(g => [g.name, ...(g.aliases || [])].some(hits)).map(g => ({ kind: 'group', ...g }));
  return [...people, ...companies, ...groups].slice(0, limit);
}
