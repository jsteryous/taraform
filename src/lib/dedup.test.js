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
