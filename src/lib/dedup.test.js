import { describe, it, expect } from 'vitest';
import { buildLookupMaps, findDuplicate } from './dedup';

const existing = [
  {
    id: 1,
    firstName: 'Jane',
    lastName: 'Doe',
    county: 'Greenville',
    propertyAddresses: ['100 Farm Rd'],
    taxMapIds: ['0123-45-6789'],
  },
  {
    id: 2,
    firstName: 'John',
    lastName: 'Smith',
    county: 'Spartanburg',
    propertyAddresses: ['200 Hill St'],
    taxMapIds: ['9999-00-0000'],
  },
];

describe('buildLookupMaps', () => {
  it('keys names case-insensitively as first|last', () => {
    const { byName } = buildLookupMaps(existing);
    expect(byName.get('jane|doe').id).toBe(1);
  });
  it('keys tax map IDs by county|id (IDs are only unique within a county)', () => {
    const { byTaxId } = buildLookupMaps(existing);
    expect(byTaxId.get('greenville|0123-45-6789').id).toBe(1);
    expect(byTaxId.has('0123-45-6789')).toBe(false);
  });
  it('skips contacts missing a first or last name in the name map', () => {
    const { byName } = buildLookupMaps([{ id: 9, firstName: 'Jane', lastName: '' }]);
    expect(byName.size).toBe(0);
  });
});

describe('findDuplicate', () => {
  const maps = buildLookupMaps(existing);

  it('matches an existing contact by name', () => {
    const hit = findDuplicate({ firstName: 'JANE', lastName: 'doe' }, maps);
    expect(hit?.id).toBe(1);
  });

  it('matches by property address when the name differs', () => {
    const hit = findDuplicate({ firstName: 'New', lastName: 'Owner', propertyAddresses: ['100 farm rd'] }, maps);
    expect(hit?.id).toBe(1);
  });

  it('matches by tax map ID within the same county', () => {
    const hit = findDuplicate({ county: 'Greenville', taxMapIds: ['0123-45-6789'] }, maps);
    expect(hit?.id).toBe(1);
  });

  it('does NOT match the same tax map ID in a different county', () => {
    const hit = findDuplicate({ county: 'Anderson', taxMapIds: ['0123-45-6789'] }, maps);
    expect(hit).toBeNull();
  });

  it('returns null for a genuinely new contact', () => {
    const hit = findDuplicate(
      { firstName: 'Brand', lastName: 'New', county: 'York', propertyAddresses: ['1 New Way'], taxMapIds: ['1-1-1'] },
      maps,
    );
    expect(hit).toBeNull();
  });

  it('tolerates a contact with no usable identity fields', () => {
    expect(findDuplicate({}, maps)).toBeNull();
  });
});

import { findAddDuplicates, companyNameKey, streetKey } from './dedup';

describe('companyNameKey', () => {
  it('ignores case, punctuation, a leading "The" and entity suffixes', () => {
    expect(companyNameKey('The Acme Co.')).toBe('acme');
    expect(companyNameKey('ACME, Inc')).toBe('acme');
    expect(companyNameKey('Smith & Sons LLC')).toBe('smith and sons');
  });
  it('keeps a name that is only a suffix word', () => {
    expect(companyNameKey('Company')).toBe('company');
  });
});

describe('streetKey', () => {
  it('reads the street line and abbreviates street words', () => {
    expect(streetKey('123 Main Street, Greenville, SC 29601')).toEqual({ street: '123 main st', unit: '' });
    expect(streetKey('123 Main St.')).toEqual({ street: '123 main st', unit: '' });
  });
  it('splits off a suite, inline or as its own part', () => {
    expect(streetKey('10 N Church St Suite 200, Greenville')).toEqual({ street: '10 n church st', unit: '200' });
    expect(streetKey('10 North Church Street, Ste 200, Greenville')).toEqual({ street: '10 n church st', unit: '200' });
  });
  it('refuses an address without a house number', () => {
    expect(streetKey('Main Street, Greenville')).toBeNull();
    expect(streetKey('')).toBeNull();
  });
});

describe('findAddDuplicates', () => {
  const book = [
    { id: 1, kind: 'company', firstName: 'Acme Corp', phones: ['(864) 555-1234'], address: '123 Main Street, Greenville, SC 29601' },
    { id: 2, kind: 'company', firstName: 'Blue Ridge Paving', phones: [], address: '10 N Church St Suite 200, Greenville, SC' },
    { id: 3, kind: 'person', firstName: 'Acme', lastName: 'Jones', phones: ['864-555-9999'] },
  ];
  const company = over => ({ kind: 'company', firstName: '', phones: [], ...over });

  it('flags a company name written differently', () => {
    const r = findAddDuplicates(company({ firstName: 'The ACME Company' }), book);
    expect(r.map(d => [d.id, d.why])).toEqual([[1, ['same name']]]);
  });
  it('flags the same phone in any format, person or company', () => {
    expect(findAddDuplicates(company({ firstName: 'Other', phones: ['+1 864.555.1234'] }), book).map(d => d.id)).toEqual([1]);
    expect(findAddDuplicates(company({ firstName: 'Other', phones: ['8645559999'] }), book).map(d => d.id)).toEqual([3]);
  });
  it('flags the same street address typed differently', () => {
    const r = findAddDuplicates(company({ firstName: 'New Name', address: '123 Main St, Greenville SC' }), book);
    expect(r.map(d => [d.id, d.why])).toEqual([[1, ['same address']]]);
  });
  it('treats a different suite in the same building as a different company', () => {
    expect(findAddDuplicates(company({ firstName: 'X', address: '10 North Church Street, Suite 300' }), book)).toEqual([]);
    expect(findAddDuplicates(company({ firstName: 'X', address: '10 North Church Street' }), book).map(d => d.id)).toEqual([2]);
  });
  it('lists every reason a row matched', () => {
    const r = findAddDuplicates(company({ firstName: 'Acme', phones: ['864 555 1234'], address: '123 Main St' }), book);
    expect(r[0].why).toEqual(['same name', 'same phone', 'same address']);
  });
  it('does not call a person a duplicate of a company that shares the first name', () => {
    expect(findAddDuplicates({ kind: 'person', firstName: 'Acme', lastName: 'Smith', phones: [] }, book)).toEqual([]);
  });
});
