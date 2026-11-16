import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { autoMapBanking, splitName, matchStatus, noteBody, planBankingImport } from './bankingImport';
import { parseCSVRaw } from './utils';

const STATUSES = ['Target', 'Prospect', 'Loan Customer', 'Deposit Customer', 'In Network', 'Former Customer', 'Not a Fit'];

// Shaped like a real relationship sheet: full name, business, date, notes, method, and a
// legend column off to the side that must be ignored. Names are invented.
const HEADERS = ['Customer Name', 'Business Name', 'Date', 'Notes', 'Method', '', 'Legend', 'Status'];

describe('autoMapBanking', () => {
  it('maps a relationship sheet without help', () => {
    expect(autoMapBanking(HEADERS)).toEqual({ name: 0, company: 1, date: 2, note: 3, method: 4, status: 7 });
  });

  it('prefers split first/last columns over a full-name guess', () => {
    const m = autoMapBanking(['First Name', 'Last Name', 'Name', 'Company']);
    expect(m.firstName).toBe(0);
    expect(m.lastName).toBe(1);
    expect(m.name).toBeUndefined();
  });
});

describe('splitName', () => {
  it('first word is the first name, the rest is the last name', () => {
    expect(splitName('Pat Rivers')).toEqual({ firstName: 'Pat', lastName: 'Rivers' });
    expect(splitName('Chase de la Mer')).toEqual({ firstName: 'Chase', lastName: 'de la Mer' });
    expect(splitName('Sam Stone CCIM')).toEqual({ firstName: 'Sam', lastName: 'Stone CCIM' });
  });

  it('keeps a couple together with the shared surname last', () => {
    expect(splitName('Kim & Lee Park')).toEqual({ firstName: 'Kim & Lee', lastName: 'Park' });
  });

  it('a single name is a first name; a placeholder is no name', () => {
    expect(splitName('Jo')).toEqual({ firstName: 'Jo', lastName: '' });
    expect(splitName('TBD')).toEqual({ firstName: '', lastName: '' });
    expect(splitName('  ')).toEqual({ firstName: '', lastName: '' });
  });
});

describe('matchStatus', () => {
  it('matches case-insensitively and defaults a blank to the first status', () => {
    expect(matchStatus('in network', STATUSES)).toEqual({ value: 'In Network', unknown: null });
    expect(matchStatus('', STATUSES)).toEqual({ value: 'Target', unknown: null });
  });

  it('reports a value it cannot match instead of quietly defaulting it', () => {
    expect(matchStatus('Personally Know', STATUSES)).toEqual({ value: 'Target', unknown: 'Personally Know' });
  });

  it('ignores an alias that is not a real status', () => {
    expect(matchStatus('x', STATUSES, { x: 'Prospect' }).value).toBe('Prospect');
    expect(matchStatus('x', STATUSES, { x: 'Bogus' }).value).toBe('Target');
  });
});

describe('noteBody', () => {
  it('puts the sheet date and method in the text, since the note is stamped today', () => {
    expect(noteBody({ date: '10/26/26', method: 'phone call', note: 'called, intro to a CPA' }))
      .toBe('10/26/26 · phone call: called, intro to a CPA');
  });

  it('keeps a contact with no note text as a dated touch', () => {
    expect(noteBody({ date: '10/9/26', method: 'text', note: '' })).toBe('10/9/26 · text');
  });

  it('is empty when there is nothing to say', () => {
    expect(noteBody({ date: '', method: '', note: '  ' })).toBe('');
  });
});

describe('planBankingImport', () => {
  const mapping = autoMapBanking(HEADERS);
  const plan = (rows, existing = []) => planBankingImport({ rows, mapping, existing, statuses: STATUSES });

  it('makes a company, a person, a link and a note from one row', () => {
    const p = plan([['Pat Rivers', 'Rivers Homes', '11/3/26', 'asked for coffee', 'text', '', '', 'In Network']]);
    expect(p.companies).toEqual([{ key: 'rivers homes', name: 'Rivers Homes', status: 'In Network', existingId: null }]);
    expect(p.people).toMatchObject([{ firstName: 'Pat', lastName: 'Rivers', status: 'In Network', existingId: null }]);
    expect(p.links).toEqual([{ companyKey: 'rivers homes', personKey: 'pat|rivers', title: '' }]);
    expect(p.notes).toEqual([{ target: 'person', key: 'pat|rivers', body: '11/3/26 · text: asked for coffee', row: 2 }]);
  });

  it('two rows at one business make one company with two people', () => {
    const p = plan([
      ['Pat Rivers', 'Rivers Homes'],
      ['Al Rivers', 'rivers  homes'],
    ]);
    expect(p.companies).toHaveLength(1);
    expect(p.people).toHaveLength(2);
    expect(p.links).toHaveLength(2);
  });

  it('a person with no business is just a person; a business with no name is just a company', () => {
    const p = plan([
      ['Jo Banks', '', '', 'asked to catch up', 'text'],
      ['TBD', 'Horton Law'],
    ]);
    expect(p.people.map(x => x.firstName)).toEqual(['Jo']);
    expect(p.companies.map(x => x.name)).toEqual(['Horton Law']);
    expect(p.links).toEqual([]);
    expect(p.notes[0]).toMatchObject({ target: 'person', key: 'jo|banks' });
  });

  it('a company-only row keeps its note on the company', () => {
    const p = plan([['', 'Horton Law', '', 'good relationship']]);
    expect(p.notes).toEqual([{ target: 'company', key: 'horton law', body: 'good relationship', row: 2 }]);
  });

  it('reuses what already exists and does not re-add its notes', () => {
    const existing = [
      { id: 10, kind: 'company', firstName: 'Rivers Homes', lastName: '' },
      { id: 11, kind: 'person', firstName: 'Pat', lastName: 'Rivers' },
      // A person named like a company is not that company.
      { id: 12, kind: 'person', firstName: 'Horton Law', lastName: '' },
    ];
    const p = plan([
      ['Pat Rivers', 'Rivers Homes', '', 'got coffee'],
      ['', 'Horton Law'],
    ], existing);
    expect(p.companies.find(c => c.key === 'rivers homes').existingId).toBe(10);
    expect(p.companies.find(c => c.key === 'horton law').existingId).toBeNull();
    expect(p.people[0].existingId).toBe(11);
    expect(p.links).toHaveLength(1); // still linked; adding an existing link is a no-op
    expect(p.notes).toEqual([]);
    expect(p.notesNotAdded).toEqual([{ row: 2, name: 'Pat Rivers', body: 'got coffee' }]);
  });

  it('counts unmatched statuses and skips rows with nothing to import', () => {
    const p = plan([
      ['Pat Rivers', '', '', '', '', '', '', 'Personally Know'],
      ['Al Rivers', '', '', '', '', '', '', 'personally know'],
      ['', '', '', 'orphan note'],
      ['', '', '', '', '', '', '', ''],
    ]);
    expect(p.unknownStatuses).toEqual([{ value: 'Personally Know', count: 2 }]);
    expect(p.people.every(x => x.status === 'Target')).toBe(true);
    expect(p.skipped).toEqual([{ row: 4, reason: 'No name or company' }]);
  });

  it('applies the status the user chose for a sheet value, and keeps listing it', () => {
    const p = planBankingImport({
      rows: [['Pat Rivers', 'Rivers Homes', '', '', '', '', '', 'Personally Know']],
      mapping, statuses: STATUSES, statusAliases: { 'personally know': 'In Network' },
    });
    expect(p.people[0].status).toBe('In Network');
    expect(p.companies[0].status).toBe('In Network');
    expect(p.unknownStatuses).toEqual([{ value: 'Personally Know', count: 1 }]);
  });
});

describe('parseCSVRaw with Excel output', () => {
  it('strips the byte-order mark so the first header still auto-maps', () => {
    const { headers } = parseCSVRaw('﻿Customer Name,Business Name\r\nPat Rivers,Rivers Homes\r\n');
    expect(headers[0]).toBe('Customer Name');
  });

  it('keeps a line break and a quote inside a cell, and drops blank padding rows', () => {
    const { rows } = parseCSVRaw('Name,Notes\r\nPat,"line one\nline ""two"", ok"\r\n,\r\n');
    expect(rows).toEqual([['Pat', 'line one\nline "two", ok']]);
  });
});
