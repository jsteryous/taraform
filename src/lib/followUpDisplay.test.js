import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
import { autoFollowUpDate } from './contactFilters';
import { importFollowUp } from './bankingImport';
import { BANKING_CONFIG } from './clientConfig';

const fu = BANKING_CONFIG.followUp;

describe('autoFollowUpDate', () => {
  it('is the last note plus the status window', () => {
    expect(autoFollowUpDate({ status: 'In Network', lastNoteAt: '2026-11-16T15:00:00', followUpOn: null }, fu))
      .toBe('2027-02-14');
  });
  it('is null when a date is set, never noted, or the status is not auto-eligible', () => {
    expect(autoFollowUpDate({ status: 'In Network', lastNoteAt: '2026-11-16T15:00:00', followUpOn: '2026-12-01' }, fu)).toBeNull();
    expect(autoFollowUpDate({ status: 'In Network', lastNoteAt: null }, fu)).toBeNull();
    expect(autoFollowUpDate({ status: 'Target', lastNoteAt: '2026-11-16T15:00:00' }, fu)).toBeNull();
  });
});

describe('importFollowUp', () => {
  const notes = [
    { target: 'person', key: 'barrett|wood' },
    { target: 'company', key: 'acme' },
  ];
  const now = new Date(2026, 10, 16);
  it('schedules a Target with a note 90 days out', () => {
    expect(importFollowUp(notes, 'person', 'barrett|wood', 'Target', fu, now)).toBe('2027-02-14');
  });
  it('leaves contacts without notes, off-cadence statuses, and a switched-off importer unscheduled', () => {
    expect(importFollowUp(notes, 'person', 'nobody|here', 'Target', fu, now)).toBeNull();
    expect(importFollowUp(notes, 'company', 'acme', 'Loan Customer', fu, now)).toBeNull();
    expect(importFollowUp(notes, 'person', 'barrett|wood', 'Target', null, now)).toBeNull();
  });
});
