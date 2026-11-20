import { insertContact } from './contacts';
import { addConnection } from './links';
import { addNote } from './notes';
import { scheduleAfterNote } from './followUpCadence';
import { formatPhone } from './utils';

// CSV import for workspaces with companies (the banking preset). The land importer maps
// columns onto one contact per row; a relationship sheet is shaped differently: each row
// is a conversation with a person at a business. So one row can produce a company, a
// person, the link between them, and a note — and two rows naming the same business must
// land on ONE company, because a second copy in a shared book is exactly the double call
// this app exists to prevent.
//
// planBankingImport is pure (everything here but runBankingImport is) so the rules can be
// tested without a database. runBankingImport carries the plan out through the same lib
// functions the UI uses, so RLS, the same-workspace link trigger and the note stamp all
// apply exactly as they do for a hand-entered contact.

export const BANKING_FIELDS = [
  { key: 'name',      label: 'Full name' },
  { key: 'firstName', label: 'First name' },
  { key: 'lastName',  label: 'Last name' },
  { key: 'company',   label: 'Company' },
  { key: 'title',     label: 'Title at company' },
  { key: 'phone',     label: 'Phone' },
  { key: 'email',     label: 'Email' },
  { key: 'status',    label: 'Status' },
  { key: 'note',      label: 'Note' },
  { key: 'date',      label: 'Date of contact' },
  { key: 'method',    label: 'How (call, text…)' },
  // About the business, not the person (a purchased list such as Data Axle). They land
  // on the company: its main line in phones, the rest as fields on its page.
  { key: 'companyPhone',    label: 'Company phone' },
  { key: 'address',         label: 'Street address' },
  { key: 'city',            label: 'City' },
  { key: 'state',           label: 'State' },
  { key: 'zip',             label: 'ZIP' },
  { key: 'website',         label: 'Website' },
  { key: 'industry',        label: 'Industry' },
  { key: 'employees',       label: 'Employees' },
  { key: 'sales',           label: 'Annual sales' },
  { key: 'yearEstablished', label: 'Year established' },
];

// Company fields that become entries in the company's custom_fields. The key is what the
// contact page shows as the label (underscores read as spaces).
const COMPANY_DETAILS = [
  ['website', 'Website'], ['industry', 'Industry'], ['employees', 'Employees'],
  ['sales', 'Annual_sales'], ['yearEstablished', 'Year_established'],
];

const HEADER_GUESSES = {
  name:      ['customer name', 'full name', 'name', 'contact name', 'contact', 'person', 'executive name', 'executive full name'],
  firstName: ['first name', 'firstname', 'first', 'executive first name', 'contact first name'],
  lastName:  ['last name', 'lastname', 'last', 'executive last name', 'contact last name'],
  company:   ['business name', 'company', 'company name', 'business', 'organization', 'employer', 'firm'],
  title:     ['title', 'role', 'position', 'job title', 'executive title', 'executive title description', 'contact title'],
  // Before `phone`: on a business list the only number is the location's main line.
  companyPhone: ['phone number combined', 'company phone', 'business phone', 'main phone', 'location phone'],
  phone:     ['phone', 'phone number', 'cell', 'mobile', 'telephone', 'executive phone', 'direct phone'],
  email:     ['email', 'email address', 'e-mail'],
  status:    ['status', 'relationship', 'category'],
  note:      ['notes', 'note', 'comments', 'comment'],
  date:      ['date', 'last contact', 'last contacted', 'date contacted'],
  method:    ['method', 'contact method', 'channel', 'how'],
  address:   ['address', 'street address', 'location address', 'physical address', 'address line 1'],
  city:      ['city', 'location city', 'physical city'],
  state:     ['state', 'location state', 'physical state'],
  zip:       ['zip code', 'zip', 'postal code', 'location zip code', 'physical zip'],
  website:   ['website', 'web address', 'url', 'web site'],
  industry:  ['primary sic description', 'primary naics description', 'naics description', 'sic description', 'industry', 'primary sic code description'],
  employees: ['location employee size actual', 'employee size actual', 'location employee size range', 'employee size range', 'employees', 'number of employees'],
  sales:     ['location sales volume actual', 'sales volume actual', 'location sales volume range', 'sales volume range', 'annual sales', 'sales volume'],
  yearEstablished: ['year established', 'year started', 'year founded'],
};

export function autoMapBanking(headers) {
  const h = headers.map(x => String(x || '').toLowerCase().replace(/[_\s]+/g, ' ').trim());
  const mapping = {};
  const used = new Set();
  for (const [field, guesses] of Object.entries(HEADER_GUESSES)) {
    for (const g of guesses) {
      const idx = h.indexOf(g);
      if (idx >= 0 && !used.has(idx)) { mapping[field] = idx; used.add(idx); break; }
    }
  }
  // A full-name column and split first/last columns are alternatives, not both.
  if (mapping.firstName !== undefined || mapping.lastName !== undefined) delete mapping.name;
  return mapping;
}

const PLACEHOLDER = /^(tbd|tba|n\/?a|unknown|none|\?+|-+)$/i;
const clean = (v) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return PLACEHOLDER.test(s) ? '' : s;
};

// "Chase de la Houssaye" -> Chase / de la Houssaye; "John Wright CCIM" -> John / Wright CCIM.
// First word is the first name, the rest is the last name — except a couple
// ("Kim & Steve Johnston"), where the shared surname is the last word.
export function splitName(full) {
  const s = clean(full);
  if (!s) return { firstName: '', lastName: '' };
  const words = s.split(' ');
  if (words.length === 1) return { firstName: s, lastName: '' };
  if (/\s(&|and)\s/i.test(s)) {
    return { firstName: words.slice(0, -1).join(' '), lastName: words[words.length - 1] };
  }
  return { firstName: words[0], lastName: words.slice(1).join(' ') };
}

// Case-insensitive match to one of the workspace's statuses. Blank means "use the
// default". Anything else that doesn't match is reported as `unknown` — so a sheet's own
// vocabulary ("Personally Know") or a typo can't silently become the default — and
// resolved through `aliases` (lowercased sheet value -> status), which the preview lets
// the user fill in per value.
export function matchStatus(raw, statuses, aliases = {}) {
  const s = clean(raw).toLowerCase();
  if (!s) return { value: statuses[0], unknown: null };
  const hit = statuses.find(v => v.toLowerCase() === s);
  if (hit) return { value: hit, unknown: null };
  const alias = statuses.includes(aliases[s]) ? aliases[s] : statuses[0];
  return { value: alias, unknown: clean(raw) };
}

// The note table stamps every note with the time it is inserted (contact_notes_stamp);
// a client cannot backdate one. So the sheet's own date goes into the text, where a
// reader sees it: "10/26/26 · phone call: called, putting me in touch with …".
export function noteBody({ date, method, note }) {
  const head = [clean(date), clean(method)].filter(Boolean).join(' · ');
  const text = String(note ?? '').trim();
  if (text) return head ? `${head}: ${text}` : text;
  return head;
}

// "12 Main St, Greenville, SC 29601" from whichever parts the sheet has.
export function joinAddress(street, city, state, zip) {
  const stateZip = [clean(state), clean(zip)].filter(Boolean).join(' ');
  return [clean(street), clean(city), stateZip].filter(Boolean).join(', ');
}

export const personKey  = (first, last) => `${first.toLowerCase()}|${last.toLowerCase()}`;
export const companyKey = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim();

// rows: arrays of cell values; mapping: field -> column index; existing: every contact in
// the workspace (fetchDedupIndex); statuses: the workspace's status values, default first;
// statusAliases: see matchStatus.
//
// Returns a plan:
//   companies: [{ key, name, status, existingId, phones, address, details }]  one per distinct business
//              (address goes to the company's `address` column, which the map is built from)
//   people:    [{ key, firstName, lastName, phones, email, status, existingId }]
//   links:     [{ companyKey, personKey, title }]       distinct pairs
//   notes:     [{ target: 'person'|'company', key, body, row }]
//   skipped:   [{ row, reason }]                         row = 1-based sheet line
//   notesNotAdded: [{ row, name, body }]  notes for people/companies already in Taraform
//   unknownStatuses: [{ value, count }]   sheet values that are not statuses, keyed
//                                          case-insensitively, aliased or not
//
// A contact that already exists is never modified. Its link to the company is still
// added (harmless if present), but its note is not: importing the same sheet twice must
// not double every note, and the preview lists those notes so they can be added by hand.
export function planBankingImport({ rows, mapping, existing = [], statuses, statusAliases = {} }) {
  const cell = (row, field) => (mapping[field] === undefined ? '' : row[mapping[field]] ?? '');

  const existingPeople = new Map();
  const existingCompanies = new Map();
  for (const c of existing) {
    if (c.kind === 'company') {
      const k = companyKey(c.firstName || '');
      if (k && !existingCompanies.has(k)) existingCompanies.set(k, c.id);
    } else {
      const k = personKey(c.firstName || '', c.lastName || '');
      if (k !== '|' && !existingPeople.has(k)) existingPeople.set(k, c.id);
    }
  }

  const companies = new Map();
  const people = new Map();
  const links = new Map();
  const notes = [];
  const skipped = [];
  const notesNotAdded = [];
  const unknown = new Map();

  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const { firstName, lastName } = mapping.name !== undefined
      ? splitName(cell(row, 'name'))
      : { firstName: clean(cell(row, 'firstName')), lastName: clean(cell(row, 'lastName')) };
    const companyName = clean(cell(row, 'company'));

    if (!firstName && !lastName && !companyName) {
      if (row.some(v => String(v || '').trim())) skipped.push({ row: line, reason: 'No name or company' });
      return;
    }

    const { value: status, unknown: bad } = matchStatus(cell(row, 'status'), statuses, statusAliases);
    if (bad) {
      const k = bad.toLowerCase();
      const u = unknown.get(k) || { value: bad, count: 0 };
      u.count++;
      unknown.set(k, u);
    }

    let cKey = null;
    if (companyName) {
      cKey = companyKey(companyName);
      if (!companies.has(cKey)) {
        companies.set(cKey, { key: cKey, name: companyName, status, existingId: existingCompanies.get(cKey) ?? null, phones: [], address: '', details: {} });
      }
      // A business list repeats the company once per executive; the first row with a
      // value wins, and any new number is added.
      const co = companies.get(cKey);
      const cPhone = clean(cell(row, 'companyPhone'));
      if (cPhone && !co.phones.includes(formatPhone(cPhone))) co.phones.push(formatPhone(cPhone));
      const addr = joinAddress(cell(row, 'address'), cell(row, 'city'), cell(row, 'state'), cell(row, 'zip'));
      if (addr && !co.address) co.address = addr;
      for (const [field, label] of COMPANY_DETAILS) {
        const v = clean(cell(row, field));
        if (v && !co.details[label]) co.details[label] = v;
      }
    }

    let pKey = null;
    if (firstName || lastName) {
      pKey = personKey(firstName, lastName);
      const phone = clean(cell(row, 'phone'));
      const email = clean(cell(row, 'email'));
      if (!people.has(pKey)) {
        people.set(pKey, {
          key: pKey, firstName, lastName,
          phones: phone ? [formatPhone(phone)] : [],
          email,
          status,
          existingId: existingPeople.get(pKey) ?? null,
        });
      } else {
        // Same person on two rows: keep the first status, gather any new contact details.
        const p = people.get(pKey);
        if (phone && !p.phones.includes(formatPhone(phone))) p.phones.push(formatPhone(phone));
        if (email && !p.email) p.email = email;
      }
    }

    if (cKey && pKey) {
      const lk = `${cKey}::${pKey}`;
      if (!links.has(lk)) links.set(lk, { companyKey: cKey, personKey: pKey, title: clean(cell(row, 'title')) });
    }

    const body = noteBody({ date: cell(row, 'date'), method: cell(row, 'method'), note: cell(row, 'note') });
    if (body) {
      // The conversation was with the person; a company's page shows its people's notes
      // anyway. A company-only row keeps the note on the company.
      const target = pKey ? 'person' : 'company';
      const key = pKey || cKey;
      const owner = target === 'person' ? people.get(key) : companies.get(key);
      if (owner.existingId) {
        const name = target === 'person' ? `${owner.firstName} ${owner.lastName}`.trim() : owner.name;
        notesNotAdded.push({ row: line, name, body });
      } else {
        notes.push({ target, key, body, row: line });
      }
    }
  });

  return {
    companies: [...companies.values()],
    people: [...people.values()],
    links: [...links.values()],
    notes,
    skipped,
    notesNotAdded,
    unknownStatuses: [...unknown.values()],
  };
}

// follow_up_on for a contact the import creates: what scheduleAfterNote would have set
// after logging its notes today. null when nothing is scheduled.
export function importFollowUp(notes, target, key, status, followUp, now = new Date()) {
  if (!followUp) return null;
  const count = notes.filter(n => n.target === target && n.key === key).length;
  if (!count) return null;
  return scheduleAfterNote(count, status, null, followUp, now) ?? null;
}

// First calls for a list nobody has called yet (a purchased list has no notes, so
// importFollowUp schedules nothing, and a Target with no date never comes due).
// Spreads the new contacts over weekdays, `perDay` a day from `start`. Follow-ups live on
// people, never companies, so a new company's first call goes to its first new person
// (one call per company, not one per executive); a person with no company gets their own.
// Only statuses in `statuses` (the cadence's; a company row uses the company's status),
// and never where the company or that person has a note in this import — those are
// already scheduled from their notes.
// → Map('person:key' → 'YYYY-MM-DD'), in sheet order.
export function planFirstCalls(plan, { perDay, start = new Date(), statuses = [] } = {}) {
  const out = new Map();
  if (!plan || !(perDay > 0)) return out;
  const noted = new Set(plan.notes.map(n => `${n.target}:${n.key}`));
  const linked = new Set(plan.links.map(l => l.personKey));
  const newPeople = new Map(plan.people.filter(p => !p.existingId).map(p => [p.key, p]));
  const firstPerson = new Map();
  for (const l of plan.links) {
    if (!firstPerson.has(l.companyKey) && newPeople.has(l.personKey)) firstPerson.set(l.companyKey, l.personKey);
  }
  const due = [
    ...plan.companies.filter(c => !c.existingId && firstPerson.has(c.key) && !noted.has(`company:${c.key}`))
      .map(c => ({ id: `person:${firstPerson.get(c.key)}`, status: c.status })),
    ...[...newPeople.values()].filter(p => !linked.has(p.key)).map(p => ({ id: `person:${p.key}`, status: p.status })),
  ].filter(x => statuses.includes(x.status) && !noted.has(x.id));
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const weekday = () => { while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1); };
  weekday();
  due.forEach((x, i) => {
    if (i > 0 && i % perDay === 0) { day.setDate(day.getDate() + 1); weekday(); }
    out.set(x.id, ymd(day));
  });
  return out;
}

const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function blankContact(fields) {
  const now = new Date().toISOString();
  return {
    kind: 'person', firstName: '', lastName: '', phones: [], email: '',
    county: '', ownerAddress: '', propertyAddresses: [], taxMapIds: [],
    notes: '', customFields: {}, createdAt: now, updatedAt: now,
    ...fields,
  };
}

// Small worker pool: a few hundred one-row requests finish in seconds without hammering
// the API with all of them at once.
async function eachLimited(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

// Carries out a plan. Keeps going past individual failures and reports them, rather than
// stopping halfway: a half-run import is safe to re-run for contacts and links (they
// dedupe), but notes on the contacts it created would then be "already in Taraform" and
// skipped — so it is better to finish everything that can finish and list what didn't.
export async function runBankingImport(plan, { userId, clientId, onProgress, followUp = null, firstCalls = new Map() } = {}) {
  const ids = { company: new Map(), person: new Map() };
  // Each imported note is a call, so a new contact starts out scheduled exactly as if
  // those notes had been logged by hand. Without this, a status whose only way into the
  // queue is a date (banking Target) would never come due. Pass followUp = null when the
  // importer's own auto-schedule switch is off.
  // Companies never get one: follow-ups live on people.
  const followUpFor = (target, key, status) => target === 'company' ? null :
    importFollowUp(plan.notes, target, key, status, followUp) ?? firstCalls.get(`${target}:${key}`) ?? null;
  const created = [];
  const failures = [];
  const total = plan.companies.length + plan.people.length + plan.links.length + plan.notes.length;
  let done = 0;
  const tick = () => onProgress?.(++done, total);

  await eachLimited(plan.companies, 4, async (c) => {
    try {
      if (c.existingId) { ids.company.set(c.key, c.existingId); return; }
      const saved = await insertContact(blankContact({ kind: 'company', firstName: c.name, status: c.status, phones: c.phones || [], address: c.address || undefined, customFields: c.details || {}, followUpOn: followUpFor('company', c.key, c.status) }), userId, clientId);
      ids.company.set(c.key, saved.id);
      created.push(saved);
    } catch (e) {
      failures.push({ what: `Company “${c.name}”`, error: e.message || String(e) });
    } finally { tick(); }
  });

  await eachLimited(plan.people, 4, async (p) => {
    try {
      if (p.existingId) { ids.person.set(p.key, p.existingId); return; }
      const saved = await insertContact(blankContact({
        firstName: p.firstName, lastName: p.lastName, phones: p.phones, email: p.email, status: p.status,
        followUpOn: followUpFor('person', p.key, p.status),
      }), userId, clientId);
      ids.person.set(p.key, saved.id);
      created.push(saved);
    } catch (e) {
      failures.push({ what: `${p.firstName} ${p.lastName}`.trim(), error: e.message || String(e) });
    } finally { tick(); }
  });

  let linksAdded = 0;
  await eachLimited(plan.links, 4, async (l) => {
    try {
      const companyId = ids.company.get(l.companyKey);
      const personId = ids.person.get(l.personKey);
      if (!companyId || !personId) return; // one side failed above and is already reported
      await addConnection({ companyId, personId, title: l.title });
      linksAdded++;
    } catch (e) {
      if (e.message !== 'They are already linked.') failures.push({ what: 'Company link', error: e.message || String(e) });
    } finally { tick(); }
  });

  let notesAdded = 0;
  await eachLimited(plan.notes, 4, async (n) => {
    try {
      const contactId = ids[n.target].get(n.key);
      if (!contactId) return;
      await addNote(contactId, n.body);
      notesAdded++;
    } catch (e) {
      failures.push({ what: `Note on line ${n.row}`, error: e.message || String(e) });
    } finally { tick(); }
  });

  return {
    companiesAdded: created.filter(c => c.kind === 'company').length,
    peopleAdded: created.filter(c => c.kind !== 'company').length,
    linksAdded,
    notesAdded,
    created,
    failures,
  };
}
