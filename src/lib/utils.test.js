import { describe, it, expect } from 'vitest';
import {
  formatPhone,
  normalizePhone,
  normalizeCounty,
  mapDbContact,
  mapContactToDb,
  parseCSV,
  parseCSVRaw,
  parseCustomFieldDefs,
} from './utils';

describe('formatPhone', () => {
  it('formats a 10-digit number', () => {
    expect(formatPhone('8645551234')).toBe('(864) 555-1234');
  });
  it('strips a leading US country code (11 digits)', () => {
    expect(formatPhone('18645551234')).toBe('(864) 555-1234');
  });
  it('formats input that already has punctuation', () => {
    expect(formatPhone('864-555-1234')).toBe('(864) 555-1234');
  });
  it('returns the raw input when it is not a recognizable phone', () => {
    expect(formatPhone('12345')).toBe('12345');
  });
});

describe('normalizePhone', () => {
  it('reduces formatted numbers to bare 10 digits', () => {
    expect(normalizePhone('(864) 555-1234')).toBe('8645551234');
  });
  it('drops a leading country code by keeping the last 10 digits', () => {
    expect(normalizePhone('1-864-555-1234')).toBe('8645551234');
  });
  it('lets two differently-formatted versions of the same number compare equal', () => {
    expect(normalizePhone('+1 (864) 555-1234')).toBe(normalizePhone('864.555.1234'));
  });
});

describe('normalizeCounty', () => {
  it('maps known aliases to the canonical name', () => {
    expect(normalizeCounty('gvl')).toBe('Greenville');
    expect(normalizeCounty('greer')).toBe('Greenville');
    expect(normalizeCounty('SPARTANBURG COUNTY')).toBe('Spartanburg');
  });
  it('title-cases an unknown county', () => {
    expect(normalizeCounty('marlboro')).toBe('Marlboro');
  });
  it('passes through falsy values untouched', () => {
    expect(normalizeCounty('')).toBe('');
    expect(normalizeCounty(null)).toBe(null);
    expect(normalizeCounty(undefined)).toBe(undefined);
  });
});

describe('mapDbContact / mapContactToDb', () => {
  const dbRow = {
    id: 1717000000000,
    first_name: 'Jane',
    last_name: 'Doe',
    phones: ['8645551234'],
    email: 'jane@example.com',
    owner_address: '1 Main St',
    property_addresses: ['2 Farm Rd'],
    county: 'gvl',
    tax_map_ids: ['0123-45-6789'],
    status: 'New Lead',
    notes: 'hi',
    activity_log: [{ t: 'note' }],
    custom_fields: { foo: 'bar' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    client_id: 'client-uuid',
  };

  it('maps snake_case DB columns to camelCase app shape', () => {
    const c = mapDbContact(dbRow);
    expect(c.firstName).toBe('Jane');
    expect(c.ownerAddress).toBe('1 Main St');
    expect(c.taxMapIds).toEqual(['0123-45-6789']);
    expect(c.customFields).toEqual({ foo: 'bar' });
  });

  it('normalizes county on the way in', () => {
    expect(mapDbContact(dbRow).county).toBe('Greenville');
  });

  it('defaults array/object/string columns when the DB sends null', () => {
    const c = mapDbContact({ ...dbRow, phones: null, email: null, property_addresses: null, custom_fields: null });
    expect(c.phones).toEqual([]);
    expect(c.email).toBe('');
    expect(c.propertyAddresses).toEqual([]);
    expect(c.customFields).toEqual({});
  });

  it('round-trips the camelCase shape back to DB columns', () => {
    const c = mapDbContact(dbRow);
    const back = mapContactToDb(c, 'user-1', 'client-uuid');
    expect(back.first_name).toBe('Jane');
    expect(back.tax_map_ids).toEqual(['0123-45-6789']);
    expect(back.client_id).toBe('client-uuid');
    expect(back.user_id).toBe('user-1');
  });

  it('writes empty email as null (not empty string) on the way to the DB', () => {
    const back = mapContactToDb({ ...mapDbContact(dbRow), email: '' }, 'u', 'c');
    expect(back.email).toBeNull();
  });

  it('round-trips bad_phones and defaults it to [] when the DB sends null', () => {
    expect(mapDbContact({ ...dbRow, bad_phones: null }).badPhones).toEqual([]);
    expect(mapDbContact({ ...dbRow, bad_phones: ['8645551234'] }).badPhones).toEqual(['8645551234']);
    const back = mapContactToDb(mapDbContact({ ...dbRow, bad_phones: ['8645551234'] }), 'u', 'c');
    expect(back.bad_phones).toEqual(['8645551234']);
  });
});

describe('parseCSV', () => {
  it('returns keyed row objects', () => {
    const { headers, rows } = parseCSV('First,Last\nJane,Doe\nJohn,Smith');
    expect(headers).toEqual(['First', 'Last']);
    expect(rows).toEqual([
      { First: 'Jane', Last: 'Doe' },
      { First: 'John', Last: 'Smith' },
    ]);
  });
  it('honors quoted fields containing commas', () => {
    const { rows } = parseCSV('Name,Addr\n"Doe, Jane","1 Main St, Unit 2"');
    expect(rows[0]).toEqual({ Name: 'Doe, Jane', Addr: '1 Main St, Unit 2' });
  });
  it('tolerates Windows CRLF line endings', () => {
    const { rows } = parseCSV('A,B\r\n1,2');
    expect(rows[0]).toEqual({ A: '1', B: '2' });
  });
});

describe('parseCSVRaw', () => {
  it('returns rows as positional value arrays for the mapping UI', () => {
    const { headers, rows } = parseCSVRaw('First,Last\nJane,Doe');
    expect(headers).toEqual(['First', 'Last']);
    expect(rows).toEqual([['Jane', 'Doe']]);
  });
});

describe('parseCustomFieldDefs', () => {
  it('returns [] for empty input', () => {
    expect(parseCustomFieldDefs('')).toEqual([]);
    expect(parseCustomFieldDefs(null)).toEqual([]);
  });
  it('parses a JSON string', () => {
    expect(parseCustomFieldDefs('[{"key":"a","label":"A"}]')).toEqual([{ key: 'a', label: 'A' }]);
  });
  it('returns [] on malformed JSON instead of throwing', () => {
    expect(parseCustomFieldDefs('{not json')).toEqual([]);
  });
  it('passes through an already-parsed array', () => {
    const defs = [{ key: 'a' }];
    expect(parseCustomFieldDefs(defs)).toBe(defs);
  });
});
