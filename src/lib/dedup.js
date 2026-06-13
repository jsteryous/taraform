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
