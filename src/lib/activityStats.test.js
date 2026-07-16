import { describe, it, expect } from 'vitest';
import { summarizeNoteActivity } from './activityStats';

// Fixed "now": Wed 2026-07-15 14:00 local time.
const NOW = new Date(2026, 6, 15, 14, 0, 0);
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

describe('summarizeNoteActivity', () => {
  it('returns zeros for empty or missing rows', () => {
    expect(summarizeNoteActivity([], NOW)).toEqual({
      today: { notes: 0, contacts: 0 },
      week: { notes: 0, contacts: 0 },
      month: { notes: 0, contacts: 0 },
    });
    expect(summarizeNoteActivity(null, NOW).month.notes).toBe(0);
  });

  it('buckets notes into today / 7-day / 30-day windows cumulatively', () => {
    const rows = [
      { contact_id: 1, note_at: hoursAgo(2) },  // today (and week, month)
      { contact_id: 2, note_at: daysAgo(3) },   // week, month
      { contact_id: 3, note_at: daysAgo(20) },  // month only
    ];
    expect(summarizeNoteActivity(rows, NOW)).toEqual({
      today: { notes: 1, contacts: 1 },
      week: { notes: 2, contacts: 2 },
      month: { notes: 3, contacts: 3 },
    });
  });

  it('"today" means since local midnight, not last 24 hours', () => {
    const lateYesterday = new Date(2026, 6, 14, 23, 30).toISOString(); // 14.5h ago
    const { today, week } = summarizeNoteActivity([{ contact_id: 1, note_at: lateYesterday }], NOW);
    expect(today.notes).toBe(0);
    expect(week.notes).toBe(1);
  });

  it('counts unique contacts, not one per note', () => {
    const rows = [
      { contact_id: 7, note_at: hoursAgo(1) },
      { contact_id: 7, note_at: hoursAgo(3) },
      { contact_id: 8, note_at: hoursAgo(5) },
    ];
    const { today } = summarizeNoteActivity(rows, NOW);
    expect(today).toEqual({ notes: 3, contacts: 2 });
  });

  it('ignores rows older than 30 days and unparseable timestamps', () => {
    const rows = [
      { contact_id: 1, note_at: daysAgo(45) },
      { contact_id: 2, note_at: 'not-a-date' },
    ];
    expect(summarizeNoteActivity(rows, NOW).month).toEqual({ notes: 0, contacts: 0 });
  });
});
