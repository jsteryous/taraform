import { describe, it, expect } from 'vitest';
import {
  attemptGap, countAttempts, nextFollowUpDate, schedulesFor, scheduleAfterNote, attemptLabel,
  clearOnStatusChange, isExcluded,
} from './followUpCadence';
import { todayStr } from './contactFilters';
import { LAND_CONFIG } from './clientConfig';

const CADENCE = LAND_CONFIG.followUp.cadence;
const at = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return todayStr(d);
};
const note = (text = 'Left voicemail') => ({ type: 'note', text, timestamp: new Date().toISOString() });

describe('attemptGap', () => {
  // The spec, verbatim: attempt 1 day 0, then days 3, 7, 14, 30, 60, then every 60.
  // Stored as spacing, so this table is the derivative of the day table in the config.
  it('reproduces the authored schedule', () => {
    expect(attemptGap(1, CADENCE)).toBe(3);   // day 0  -> day 3
    expect(attemptGap(2, CADENCE)).toBe(4);   // day 3  -> day 7
    expect(attemptGap(3, CADENCE)).toBe(7);   // day 7  -> day 14
    expect(attemptGap(4, CADENCE)).toBe(16);  // day 14 -> day 30
    expect(attemptGap(5, CADENCE)).toBe(30);  // day 30 -> day 60
  });

  it('flattens to repeatEvery past the table, forever', () => {
    expect(attemptGap(6, CADENCE)).toBe(60);
    expect(attemptGap(7, CADENCE)).toBe(60);
    expect(attemptGap(40, CADENCE)).toBe(60);
  });

  // Walking the gaps from day 0 has to land back on the authored day numbers, or the
  // "attempt 5 is at day 30" promise quietly stops being true.
  it('accumulates back to the authored day offsets', () => {
    let day = 0;
    const landed = [0];
    for (let n = 1; n <= 6; n++) { day += attemptGap(n, CADENCE); landed.push(day); }
    expect(landed).toEqual([0, 3, 7, 14, 30, 60, 120]);
  });

  it('returns null rather than 0 when there is no cadence', () => {
    expect(attemptGap(1, null)).toBe(null);
    expect(attemptGap(1, {})).toBe(null);
    expect(attemptGap(1, { attemptDays: [0] })).toBe(null); // too short to have a step
    expect(attemptGap(0, CADENCE)).toBe(null);
  });

  it('clamps a mis-authored descending table instead of scheduling into the past', () => {
    expect(attemptGap(1, { attemptDays: [10, 2], repeatEvery: 5 })).toBe(1);
  });

  it('falls back to the last authored step when repeatEvery is unset', () => {
    expect(attemptGap(9, { attemptDays: [0, 3, 7] })).toBe(4);
  });
});

describe('countAttempts', () => {
  it('counts notes, not status or offer audit entries', () => {
    const log = [
      note(), { type: 'status_change', text: 'New Lead -> Contacted' },
      { type: 'offer', text: '$40,000' }, note('Called — no answer'),
      { text: 'legacy untyped note' }, // pre-type entries are notes
      { type: 'status_change' },
    ];
    expect(countAttempts(log)).toBe(3);
  });

  it('is 0 for an empty or absent log', () => {
    expect(countAttempts([])).toBe(0);
    expect(countAttempts(null)).toBe(0);
    expect(countAttempts(undefined)).toBe(0);
  });
});

describe('nextFollowUpDate', () => {
  it('schedules from the day the call happened, not from a fixed day-0 anchor', () => {
    expect(nextFollowUpDate(1, CADENCE)).toBe(at(3));
    expect(nextFollowUpDate(4, CADENCE)).toBe(at(16));
    expect(nextFollowUpDate(9, CADENCE)).toBe(at(60));
  });

  // Falling behind must not compress the schedule: attempt 2 made 5 days late still
  // buys the full 4-day gap to attempt 3, not the 2 days a cumulative anchor would give.
  it('preserves spacing when a call lands late', () => {
    const late = new Date();
    late.setDate(late.getDate() - 5);
    expect(nextFollowUpDate(2, CADENCE, late)).toBe(at(-1));
  });

  it('rolls across month and year boundaries', () => {
    expect(nextFollowUpDate(5, CADENCE, new Date(2026, 11, 20))).toBe('2027-01-19');
  });
});

describe('schedulesFor', () => {
  it('covers the unanswered-call funnel and nothing past it', () => {
    for (const s of ['New Lead', 'Contacted', 'Hot Lead']) expect(schedulesFor(s, CADENCE)).toBe(true);
    for (const s of ['Offer Made', 'UC', 'Closed', 'Dead/Pass', 'Buyer']) {
      expect(schedulesFor(s, CADENCE)).toBe(false);
    }
  });
  it('is false with no cadence configured', () => {
    expect(schedulesFor('Contacted', null)).toBe(false);
    expect(schedulesFor('Contacted', { statuses: ['Contacted'] })).toBe(false);
  });
});

describe('scheduleAfterNote', () => {
  const fu = LAND_CONFIG.followUp;

  // Offsets are gaps from today, not the cumulative day numbers: a 2nd call logged
  // today earns the day-3-to-day-7 step (4 days), not 7.
  it('schedules the next call off the number of notes logged', () => {
    expect(scheduleAfterNote([note()], 'Contacted', null, fu)).toBe(at(3));
    expect(scheduleAfterNote([note(), note()], 'Contacted', null, fu)).toBe(at(4));
    expect(scheduleAfterNote([note(), note(), note()], 'Contacted', null, fu)).toBe(at(7));
  });

  // The whole point of the change: one call used to mean three months of silence.
  it('replaces the old 90-day wait with 3 days after the first call', () => {
    expect(scheduleAfterNote([note()], 'Contacted', null, fu)).toBe(at(3));
    expect(fu.days).toBe(90); // the backstop is still there, it just stops being reached
  });

  it('reschedules over a date that has already come due', () => {
    expect(scheduleAfterNote([note()], 'Contacted', at(-2), fu)).toBe(at(3));
    expect(scheduleAfterNote([note()], 'Contacted', at(0), fu)).toBe(at(3));
  });

  // "Call them the 3rd" is a commitment; interim notes must not drag it forward.
  it('leaves a future date alone', () => {
    expect(scheduleAfterNote([note()], 'Contacted', at(30), fu)).toBe(undefined);
    expect(scheduleAfterNote([note(), note()], 'New Lead', at(1), fu)).toBe(undefined);
  });

  it('off-cadence, keeps the old rule: a due date clears, no date stays no date', () => {
    expect(scheduleAfterNote([note()], 'Offer Made', at(-1), fu)).toBe(null);
    expect(scheduleAfterNote([note()], 'Offer Made', null, fu)).toBe(undefined);
    expect(scheduleAfterNote([note()], 'Dead/Pass', at(-1), fu)).toBe(null);
  });

  it('does nothing when the log holds no calls at all', () => {
    expect(scheduleAfterNote([{ type: 'status_change' }], 'Contacted', null, fu)).toBe(undefined);
  });

  it('is inert for a client with no cadence configured', () => {
    const noCadence = { days: 90, statuses: ['Contacted'] };
    expect(scheduleAfterNote([note()], 'Contacted', null, noCadence)).toBe(undefined);
    expect(scheduleAfterNote([note()], 'Contacted', at(-1), noCadence)).toBe(null);
  });
});

describe('attemptLabel', () => {
  it('shows progress toward the 7-attempt minimum, then drops the ceiling', () => {
    expect(attemptLabel(1, CADENCE)).toBe('Attempt 1 of 7');
    expect(attemptLabel(6, CADENCE)).toBe('Attempt 6 of 7');
    expect(attemptLabel(7, CADENCE)).toBe('Attempt 7');
    expect(attemptLabel(12, CADENCE)).toBe('Attempt 12');
    expect(attemptLabel(0, CADENCE)).toBe(null);
  });
});

// Reported 2026-08-18: logging a note scheduled +3d correctly, then marking the contact
// Dead/Pass left the date sitting there. The queue filter hid it, but the contact still
// read as if it were on the cadence.
describe('clearOnStatusChange', () => {
  const fu = LAND_CONFIG.followUp;

  it('retires the scheduled call when the lead stops', () => {
    for (const s of ['Dead/Pass', 'Closed', 'Offer Rejected/NFS']) {
      expect(clearOnStatusChange(s, at(3), fu)).toBe(null);
    }
  });

  it('leaves the date alone for statuses that are still being worked', () => {
    for (const s of ['New Lead', 'Contacted', 'Hot Lead', 'Offer Made', 'UC', 'Buyer']) {
      expect(clearOnStatusChange(s, at(3), fu)).toBe(undefined);
    }
  });

  it('is a no-op when there was no date to clear', () => {
    expect(clearOnStatusChange('Dead/Pass', null, fu)).toBe(undefined);
    expect(clearOnStatusChange('Dead/Pass', '', fu)).toBe(undefined);
  });

  it('is inert without config', () => {
    expect(clearOnStatusChange('Dead/Pass', at(3), null)).toBe(undefined);
    expect(clearOnStatusChange('Dead/Pass', at(3), { days: 90 })).toBe(undefined);
  });

  // An offer out is an active deal, not a stop — its date is a real appointment.
  it('does not treat Offer Made as terminal', () => {
    expect(isExcluded('Offer Made', fu)).toBe(false);
    expect(isExcluded('Offer Rejected/NFS', fu)).toBe(true);
  });
});

describe('scheduleAfterNote on a stopped lead', () => {
  const fu = LAND_CONFIG.followUp;
  const note = () => ({ type: 'note', text: 'pass', timestamp: new Date().toISOString() });

  it('clears rather than reschedules, whatever the date was', () => {
    for (const s of ['Dead/Pass', 'Closed', 'Offer Rejected/NFS']) {
      expect(scheduleAfterNote([note()], s, at(-1), fu)).toBe(null);
      // Even a future date: a commitment made before the lead died isn't worth keeping.
      expect(scheduleAfterNote([note()], s, at(30), fu)).toBe(null);
      expect(scheduleAfterNote([note()], s, null, fu)).toBe(undefined);
    }
  });

  // The reported sequence, end to end: note schedules, then the status change retires it.
  it('survives the note-then-mark-dead sequence with no date left behind', () => {
    const log = [note()];
    const scheduled = scheduleAfterNote(log, 'Contacted', null, fu);
    expect(scheduled).toBe(at(3));
    expect(clearOnStatusChange('Dead/Pass', scheduled, fu)).toBe(null);
  });
});
