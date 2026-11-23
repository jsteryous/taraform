import { normalizePhone } from './utils';

// Import duplicate detection — pure functions extracted from ImportModal so they can
// be unit-tested (see dedup.test.js). O(n+m): build lookup maps once, then probe.
//
// Tax map IDs are only unique within a county, so byTaxId is keyed by `county|id`
// (see src/lib/CLAUDE.md). Name and property-address matches are global.

// Build O(1) lookup maps from existing contacts — used in ImportModal.handlePreview.
export function buildLookupMaps(contacts) {
  const byName = new Map();
  const byAddress = new Map();
  const byTaxId = new Map();
  for (const c of contacts) {
    if (c.firstName && c.lastName) {
      byName.set(`${c.firstName.toLowerCase()}|${c.lastName.toLowerCase()}`, c);
    }
    for (const a of c.propertyAddresses || []) byAddress.set(a.toLowerCase(), c);
    // Tax map IDs are only unique within a county — key by county|id so same parcel ID
    // in a different county isn't flagged as a duplicate.
    const cKey = (c.county || '').toLowerCase();
    for (const t of c.taxMapIds || []) byTaxId.set(`${cKey}|${t.toLowerCase()}`, c);
  }
  return { byName, byAddress, byTaxId };
}

export function findDuplicate(contact, { byName, byAddress, byTaxId }) {
  if (contact.firstName && contact.lastName) {
    const match = byName.get(`${contact.firstName.toLowerCase()}|${contact.lastName.toLowerCase()}`);
    if (match) return match;
  }
  for (const a of contact.propertyAddresses || []) {
    const match = byAddress.get(a.toLowerCase());
    if (match) return match;
  }
  const cKey = (contact.county || '').toLowerCase();
  for (const t of contact.taxMapIds || []) {
    const match = byTaxId.get(`${cKey}|${t.toLowerCase()}`);
    if (match) return match;
  }
  return null;
}

// ── Add-contact warning ─────────────────────────────────────────────────────────────
//
// One new contact against the rows fetchDuplicateCandidates pulled back. Looser than the
// import rules on purpose: this is a warning the person can wave through with "Save
// anyway", so a false alarm costs one click and a missed duplicate costs a second card
// that splits the history. Each match says why, so the warning can show it.


// Words that say what kind of entity a company is rather than which one. "Acme", "Acme,
// Inc." and "The Acme Co" are the same business to anyone reading a Google Maps listing.
const COMPANY_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'pllc', 'pc', 'pa', 'ltd', 'limited',
  'co', 'corp', 'corporation', 'company', 'companies', 'group', 'holdings',
]);

export function companyNameKey(name) {
  const words = String(name || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter(Boolean);
  if (words[0] === 'the' && words.length > 1) words.shift();
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

const STREET_WORDS = {
  street: 'st', road: 'rd', avenue: 'ave', av: 'ave', drive: 'dr', boulevard: 'blvd',
  highway: 'hwy', lane: 'ln', parkway: 'pkwy', court: 'ct', place: 'pl', circle: 'cir',
  terrace: 'ter', trail: 'trl', square: 'sq', way: 'way', pike: 'pike', center: 'ctr',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};
const UNIT_WORDS = new Set(['suite', 'ste', 'unit', 'apt', 'bldg', 'building', 'floor', 'fl', 'rm', 'room']);

// The street line of an address ("123 Main Street, Suite 4, Greenville, SC" → street
// "123 main st", unit "4"). Only the part before the first comma that isn't a unit:
// Google Maps, a typed address and a CSV all agree on the street far more often than on
// how they spell the city/state/zip.
export function streetKey(address) {
  const parts = String(address || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const words = parts[0].replace(/#/g, ' # ').replace(/[^a-z0-9# ]+/g, ' ').split(/\s+/).filter(Boolean);
  let unit = '';
  const street = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (UNIT_WORDS.has(w) || w === '#') { unit = words.slice(i + 1).join(' ').replace(/^#\s*/, ''); break; }
    street.push(STREET_WORDS[w] || w);
  }
  // "Suite 4" written as its own comma part.
  if (!unit && parts[1]) {
    const m = parts[1].match(/^(?:suite|ste|unit|apt|bldg|building|floor|fl|rm|room|#)\s*#?\s*(.+)$/);
    if (m) unit = m[1].trim();
  }
  // A street with no house number is too vague to call two businesses the same.
  if (street.length < 2 || !/\d/.test(street[0])) return null;
  return { street: street.join(' '), unit };
}

// Same building, and not two different suites in it. One side with a suite and the other
// without is still flagged — that's usually the same place typed with less detail.
function sameStreetAddress(a, b) {
  const ka = streetKey(a), kb = streetKey(b);
  if (!ka || !kb || ka.street !== kb.street) return false;
  return !(ka.unit && kb.unit && ka.unit !== kb.unit);
}

const phoneKeys = phones => (phones || []).map(p => normalizePhone(String(p))).filter(d => d.length === 10);

// Returns the matching rows, each with `why`: the reasons it matched, for the warning.
export function findAddDuplicates(contact, existing) {
  const isCompany = contact.kind === 'company';
  const nameKey = isCompany ? companyNameKey(contact.firstName) : '';
  const phones = phoneKeys(contact.phones);
  const out = [];
  for (const c of existing) {
    if (c.id === contact.id) continue;
    const why = [];
    if (!isCompany && contact.firstName && contact.lastName &&
        c.firstName?.toLowerCase() === contact.firstName.toLowerCase() &&
        c.lastName?.toLowerCase() === contact.lastName.toLowerCase()) why.push('same name');
    // A company has one name. Only another company can be its duplicate — a person who
    // happens to share the first name is not.
    if (isCompany && nameKey && c.kind === 'company' && companyNameKey(c.firstName) === nameKey) why.push('same name');
    if (phones.length && phoneKeys(c.phones).some(p => phones.includes(p))) why.push('same phone');
    if (isCompany && contact.address && c.kind === 'company' && c.address && sameStreetAddress(contact.address, c.address)) why.push('same address');
    if (contact.email && c.email?.trim().toLowerCase() === contact.email.trim().toLowerCase()) why.push('same email');
    if (contact.propertyAddresses?.length && c.propertyAddresses?.length &&
        contact.propertyAddresses.some(a1 => c.propertyAddresses.some(a2 => a1.toLowerCase() === a2.toLowerCase()))) why.push('same property');
    // Tax map IDs are only unique within a county — same parcel ID in different counties is fine.
    if (contact.taxMapIds?.length && c.taxMapIds?.length && contact.county && c.county &&
        contact.county.toLowerCase() === c.county.toLowerCase() &&
        contact.taxMapIds.some(t1 => c.taxMapIds.some(t2 => t1.toLowerCase() === t2.toLowerCase()))) why.push('same parcel');
    if (why.length) out.push({ ...c, why });
  }
  return out;
}
