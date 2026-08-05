import { describe, it, expect } from 'vitest';
import {
  goodPhoneDigits,
  toE164,
  nameParts,
  buildPerson,
  phoneKey,
  dedupeByPhone,
  groupMembership,
  isInGroup,
  taraformResourceNames,
  taraformIdOf,
  personSignature,
  diffContacts,
  chunk,
  contactUrl,
  SYNC_KEY,
  URL_LABEL,
} from './phoneSync.js';

const contact = (over = {}) => ({
  id: 42,
  first_name: 'John',
  last_name: 'Parker',
  status: 'Offer Made',
  county: 'Spartanburg',
  phones: ['(864) 491-0532'],
  bad_phones: [],
  tax_map_ids: [],
  ...over,
});

describe('goodPhoneDigits', () => {
  it('normalizes to last 10 digits', () => {
    expect(goodPhoneDigits(contact({ phones: ['(864) 491-0532'] }))).toEqual(['8644910532']);
    expect(goodPhoneDigits(contact({ phones: ['1-864-491-0532'] }))).toEqual(['8644910532']);
  });

  // bad_phones stores normalized digits, not the formatted string (db/20260613_bad_phones.sql).
  it('drops numbers struck through in bad_phones', () => {
    const c = contact({ phones: ['(864) 491-0532', '864-520-3626'], bad_phones: ['8644910532'] });
    expect(goodPhoneDigits(c)).toEqual(['8645203626']);
  });

  it('de-duplicates the same number formatted two ways', () => {
    const c = contact({ phones: ['(864) 491-0532', '8644910532', '+1 864 491 0532'] });
    expect(goodPhoneDigits(c)).toEqual(['8644910532']);
  });

  it('survives non-array / empty / junk values', () => {
    expect(goodPhoneDigits(contact({ phones: null }))).toEqual([]);
    expect(goodPhoneDigits(contact({ phones: ['', 'n/a'], bad_phones: null }))).toEqual([]);
  });
});

describe('toE164', () => {
  it('accepts a clean 10-digit NANP number', () => {
    expect(toE164('8644910532')).toBe('+18644910532');
  });

  // Guessing a country code would produce a number that silently never matches a call.
  it('refuses anything that is not exactly 10 digits', () => {
    expect(toE164('8644910')).toBeNull();
    expect(toE164('')).toBeNull();
  });
});

describe('nameParts', () => {
  it('puts the status in the name so it shows on the call screen', () => {
    expect(nameParts(contact())).toEqual({ givenName: 'John', familyName: 'Parker (Offer Made)' });
  });

  it('handles a single-name contact without a leading space', () => {
    expect(nameParts(contact({ first_name: '', last_name: 'Parker' })))
      .toEqual({ givenName: 'Parker', familyName: '(Offer Made)' });
  });

  it('falls back when there is no name at all', () => {
    expect(nameParts(contact({ first_name: '', last_name: '', status: '' })))
      .toEqual({ givenName: 'Unknown', familyName: 'Contact' });
  });
});

describe('buildPerson', () => {
  it('builds an E.164 person stamped with the taraform id', () => {
    const p = buildPerson(contact({ tax_map_ids: ['4-49-00-039.39'] }), 'Personal List');
    expect(p.phoneNumbers).toEqual([{ value: '+18644910532', type: 'mobile' }]);
    expect(p.userDefined).toEqual([{ key: SYNC_KEY, value: '42' }]);
    expect(p.organizations[0].name).toBe('Personal List');
    expect(p.biographies[0].value).toContain('Parcel: 4-49-00-039.39');
  });

  // has_good_phone passes a 7-digit number, but it can't be dialed as E.164.
  it('returns null when nothing is dialable', () => {
    expect(buildPerson(contact({ phones: ['491-0532'] }), 'Personal List')).toBeNull();
    expect(buildPerson(contact({ phones: ['(864) 491-0532'], bad_phones: ['8644910532'] }), 'x')).toBeNull();
  });

  // The tap-through half of caller ID: the call screen gives the name, the contact card
  // gives a link straight to the record. Must be the HashRouter form App.jsx syncs to.
  it('carries a deep link back to the contact overlay', () => {
    const p = buildPerson(contact(), 'Personal List');
    expect(p.urls).toEqual([{ value: 'https://taraform.org/#/contact/42', type: URL_LABEL }]);
    expect(contactUrl(42)).toBe('https://taraform.org/#/contact/42');
  });

  // After dedupe the survivor is the row whose status is current, so its id is the one
  // worth opening — not whichever duplicate happened to be merged away.
  it('links to the surviving row after a merge', () => {
    const winner = contact({ id: 2, client_id: 'personal' });
    const loser = contact({ id: 1, client_id: 'trp' });
    const [{ contact: survivor }] = dedupeByPhone([loser, winner], ['personal', 'trp']);
    expect(buildPerson(survivor, 'Personal List').urls[0].value).toContain('/#/contact/2');
  });
});

describe('dedupeByPhone', () => {
  const PERSONAL = 'personal-list-id';
  const TRP = 'table-rock-id';
  const PRIORITY = [PERSONAL, TRP]; // order is priority

  // The exact case created by the 2026-08-04 TRP -> Personal List copy: same owner, same
  // numbers, two rows. Without this they sync as two Google contacts sharing a number.
  it('collapses the same owner across two lists, preferring the priority list', () => {
    const trp = contact({ id: 1, client_id: TRP, status: 'Offer Made' });
    const personal = contact({ id: 2, client_id: PERSONAL, status: 'Offer Made' });
    const out = dedupeByPhone([trp, personal], PRIORITY);
    expect(out).toHaveLength(1);
    expect(out[0].contact.id).toBe(2);
    expect(out[0].mergedFrom.map((c) => c.id)).toEqual([1]);
  });

  it('is stable regardless of input order', () => {
    const trp = contact({ id: 1, client_id: TRP });
    const personal = contact({ id: 2, client_id: PERSONAL });
    expect(dedupeByPhone([trp, personal], PRIORITY)[0].contact.id).toBe(2);
    expect(dedupeByPhone([personal, trp], PRIORITY)[0].contact.id).toBe(2);
  });

  it('breaks ties within one list on lowest id, so the winner never flips', () => {
    const a = contact({ id: 9, client_id: PERSONAL });
    const b = contact({ id: 4, client_id: PERSONAL });
    expect(dedupeByPhone([a, b], PRIORITY)[0].contact.id).toBe(4);
  });

  // Spouses/relatives share a landline; matching on the whole number set keeps them apart.
  it('keeps contacts that merely overlap on one of several numbers', () => {
    const a = contact({ id: 1, phones: ['(864) 491-0532', '(864) 520-3626'] });
    const b = contact({ id: 2, phones: ['(864) 491-0532'] });
    expect(dedupeByPhone([a, b], PRIORITY)).toHaveLength(2);
  });

  it('keeps unrelated contacts separate', () => {
    const a = contact({ id: 1, phones: ['(864) 491-0532'] });
    const b = contact({ id: 2, phones: ['(864) 520-3626'] });
    expect(dedupeByPhone([a, b], PRIORITY)).toHaveLength(2);
  });

  it('drops contacts with nothing dialable', () => {
    expect(dedupeByPhone([contact({ phones: ['491-0532'] })], PRIORITY)).toEqual([]);
  });

  it('treats a list outside the priority order as lowest priority', () => {
    const known = contact({ id: 5, client_id: PERSONAL });
    const other = contact({ id: 1, client_id: 'some-other-client' });
    expect(dedupeByPhone([other, known], PRIORITY)[0].contact.id).toBe(5);
  });

  it('records the merged-away copy so its name and status are not lost', () => {
    const trp = contact({ id: 1, client_id: TRP, status: 'Offer Made' });
    const personal = contact({ id: 2, client_id: PERSONAL, status: 'Contacted' });
    const { mergedFrom } = dedupeByPhone([trp, personal], PRIORITY)[0];
    const person = buildPerson(personal, 'Personal List', mergedFrom.map((c) => `${c.first_name} (${c.status}) — TRP`));
    expect(person.biographies[0].value).toContain('Also: John (Offer Made) — TRP');
  });
});

describe('personSignature', () => {
  it('ignores phone formatting differences so nightly runs do not churn', () => {
    const a = { names: [{ givenName: 'A', familyName: 'B' }], phoneNumbers: [{ value: '+18644910532' }] };
    const b = { names: [{ givenName: 'A', familyName: 'B' }], phoneNumbers: [{ value: '(864) 491-0532' }] };
    expect(personSignature(a)).toBe(personSignature(b));
  });

  it('ignores phone ordering', () => {
    const a = { phoneNumbers: [{ value: '+18644910532' }, { value: '+18645203626' }] };
    const b = { phoneNumbers: [{ value: '+18645203626' }, { value: '+18644910532' }] };
    expect(personSignature(a)).toBe(personSignature(b));
  });

  it('notices a status change, which lives in the name', () => {
    const before = { names: [{ givenName: 'John', familyName: 'Parker (Hot Lead)' }] };
    const after = { names: [{ givenName: 'John', familyName: 'Parker (Offer Made)' }] };
    expect(personSignature(before)).not.toBe(personSignature(after));
  });

  // Without this, contacts synced before the deep link existed would never be updated to
  // gain one — the diff would consider them already correct.
  it('notices a missing deep link, so old contacts get back-filled', () => {
    const withUrl = { urls: [{ value: 'https://taraform.org/#/contact/42' }] };
    expect(personSignature(withUrl)).not.toBe(personSignature({}));
  });
});

describe('diffContacts', () => {
  const person = (id, family = 'Parker (Offer Made)') => ({
    names: [{ givenName: 'John', familyName: family }],
    phoneNumbers: [{ value: '+18644910532' }],
    organizations: [],
    biographies: [{ value: '' }],
    userDefined: [{ key: SYNC_KEY, value: String(id) }],
  });
  const onGoogle = (id, family) => ({ ...person(id, family), resourceName: `people/c${id}`, etag: `e${id}` });

  it('creates contacts Google has never seen', () => {
    const { toCreate, toUpdate, toDelete } = diffContacts(new Map([['1', person(1)]]), []);
    expect(toCreate).toHaveLength(1);
    expect(toUpdate).toEqual([]);
    expect(toDelete).toEqual([]);
  });

  it('leaves untouched contacts alone', () => {
    const { toCreate, toUpdate, toDelete } = diffContacts(new Map([['1', person(1)]]), [onGoogle(1)]);
    expect(toCreate).toEqual([]);
    expect(toUpdate).toEqual([]);
    expect(toDelete).toEqual([]);
  });

  it('updates when the status changed, carrying the etag Google requires', () => {
    const { toUpdate } = diffContacts(new Map([['1', person(1, 'Parker (UC)')]]), [onGoogle(1)]);
    expect(toUpdate).toHaveLength(1);
    expect(toUpdate[0]).toMatchObject({ resourceName: 'people/c1', etag: 'e1' });
  });

  it('deletes contacts that no longer qualify', () => {
    const { toDelete } = diffContacts(new Map(), [onGoogle(1)]);
    expect(toDelete).toEqual(['people/c1']);
  });

  // The safety rule: a contact the user typed into that Google account by hand has no
  // taraform_id, so the sync must never delete or rewrite it.
  it('never touches hand-added contacts', () => {
    const manual = { resourceName: 'people/manual', names: [{ givenName: 'Mom' }], userDefined: [] };
    const { toCreate, toUpdate, toDelete } = diffContacts(new Map(), [manual]);
    expect(toCreate).toEqual([]);
    expect(toUpdate).toEqual([]);
    expect(toDelete).toEqual([]);
  });

  it('cleans up stray duplicates of a contact it owns', () => {
    const { toDelete, toUpdate } = diffContacts(new Map([['1', person(1)]]), [onGoogle(1), onGoogle(1)]);
    expect(toDelete).toEqual(['people/c1']);
    expect(toUpdate).toEqual([]);
  });
});

describe('label + purge helpers', () => {
  const GROUP = 'contactGroups/abc123';

  it('builds a membership, and nothing when there is no group', () => {
    expect(groupMembership(GROUP)).toEqual([
      { contactGroupMembership: { contactGroupResourceName: GROUP } },
    ]);
    expect(groupMembership(null)).toEqual([]);
  });

  it('detects whether a contact already carries the label', () => {
    expect(isInGroup({ memberships: [{ contactGroupMembership: { contactGroupResourceName: GROUP } }] }, GROUP)).toBe(true);
    expect(isInGroup({ memberships: [{ contactGroupMembership: { contactGroupResourceName: 'contactGroups/other' } }] }, GROUP)).toBe(false);
    expect(isInGroup({}, GROUP)).toBe(false);
  });

  // What --purge deletes. The guarantee that makes a personal Google account safe: a
  // contact without the stamp is never in this set.
  it('selects only contacts the sync owns', () => {
    const people = [
      { resourceName: 'people/c1', userDefined: [{ key: SYNC_KEY, value: '1' }] },
      { resourceName: 'people/mom', userDefined: [] },
      { resourceName: 'people/dentist' },
      { resourceName: 'people/c2', userDefined: [{ key: SYNC_KEY, value: '2' }] },
    ];
    expect(taraformResourceNames(people)).toEqual(['people/c1', 'people/c2']);
  });

  it('is empty for an address book the sync has never written to', () => {
    expect(taraformResourceNames([{ resourceName: 'people/mom' }])).toEqual([]);
    expect(taraformResourceNames(null)).toEqual([]);
  });
});

describe('taraformIdOf / chunk', () => {
  it('reads the stamped id, or null for foreign contacts', () => {
    expect(taraformIdOf({ userDefined: [{ key: SYNC_KEY, value: '7' }] })).toBe('7');
    expect(taraformIdOf({ userDefined: [{ key: 'other', value: '7' }] })).toBeNull();
    expect(taraformIdOf({})).toBeNull();
  });

  it('splits batches at the Google API caps', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 200)).toEqual([]);
  });
});
