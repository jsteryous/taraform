// Call cadence — when the next attempt on a contact is due.
//
// contactFilters decides whether a contact IS due (follow_up_on has arrived, or its
// status went stale). This module decides what follow_up_on BECOMES after a call, so a
// contact schedules its own next attempt instead of falling through to the stale-note
// rule a quarter later. Each note in the activity log is one call attempt.
//
// Config lives at clientConfig followUp.cadence:
//   attemptDays  cumulative day offsets from the first attempt, written the way a cadence
//                is designed on paper: [0, 3, 7, 14, 30, 60] = call, then day 3, 7, 14,
//                30, 60. Must be ascending.
//   repeatEvery  spacing once attemptDays runs out (attempt 7 onward).
//   statuses     statuses a call schedules from. A call made outside them doesn't
//                schedule — see scheduleAfterNote.
//   minAttempts  display only ("attempt 3 of 7"); nothing enforces it.
//
// Gaps are derived from attemptDays but applied from the day the call ACTUALLY happened,
// not from a fixed day-0 anchor. The two agree when calls land on schedule and diverge
// when they don't, which they will: falling five days behind on attempt 2 should not
// leave two days until attempt 3. The cadence is spacing between calls, so spacing is
// what gets stored.
//
// Everything here is pure. The one place it meets the DB is ContactDetail writing the
// returned date to follow_up_on, which the existing queue filter already reads.

import { todayStr, isNoteEntry } from './contactFilters';

// Days to wait after `attempt` (1-based) before the next one is due. Returns null when
// the cadence isn't configured, so callers can tell "no cadence" from "wait 0 days".
export function attemptGap(attempt, cadence) {
  const days = cadence?.attemptDays;
  if (!Array.isArray(days) || days.length < 2 || attempt < 1) return null;
  // Attempt N sits at days[N-1]; the wait to N+1 is the step to days[N]. Past the end of
  // the table the cadence flattens to repeatEvery (the last authored step if unset).
  const gap = attempt < days.length
    ? days[attempt] - days[attempt - 1]
    : (cadence.repeatEvery ?? days[days.length - 1] - days[days.length - 2]);
  // A non-ascending attemptDays would schedule into the past and make the contact
  // permanently due. Clamp rather than trust the config.
  return Math.max(1, Math.round(gap));
}

// Attempts made so far = notes logged. Same predicate as lastNoteDate / the last_note_at
// generated column, imported rather than re-spelled: status and offer entries are an
// audit trail, not calls.
export function countAttempts(activityLog) {
  return (activityLog || []).filter(isNoteEntry).length;
}

// The date attempt N+1 comes due, as YYYY-MM-DD in the user's local calendar (the unit
// follow_up_on is stored in). `from` is when attempt N happened — today, for a live call.
export function nextFollowUpDate(attempt, cadence, from = new Date()) {
  const gap = attemptGap(attempt, cadence);
  if (gap == null) return null;
  const d = new Date(from);
  d.setDate(d.getDate() + gap); // rolls months/years, and DST can't shift a date-only value
  return todayStr(d);
}

// Does a call on this status schedule the next one? Outside the configured statuses the
// cadence is silent — an Offer Made contact is worked by its offer, not by a call clock.
export function schedulesFor(status, cadence) {
  return !!cadence?.attemptDays && (cadence.statuses || []).includes(status);
}

// What follow_up_on should become when a note is logged.
//
// Three-valued on purpose, because "leave it alone" and "clear it" are different answers:
//   undefined  don't touch the field (don't include it in the save)
//   null       clear it
//   'YYYY-MM-DD'  set it
//
// Precedence:
//   1. A future date is an explicit commitment ("call them the 3rd") and outranks the
//      cadence — interim notes never move it. This is the pre-cadence behaviour, kept.
//   2. On a cadence status, schedule attempt N+1 from today.
//   3. Off-cadence, fall back to the pre-cadence rule: logging a note while the date is
//      due counts as having done the follow-up, so clear it.
export function scheduleAfterNote(activityLog, status, followUpOn, followUp, now = new Date()) {
  const cadence = followUp?.cadence;
  if (followUpOn && followUpOn > todayStr(now)) return undefined;
  const attempts = countAttempts(activityLog);
  if (attempts >= 1 && schedulesFor(status, cadence)) {
    return nextFollowUpDate(attempts, cadence, now);
  }
  return followUpOn ? null : undefined;
}

// "Attempt 3 of 7" for the detail sidebar. Past minAttempts the "of N" is dropped rather
// than reading "9 of 7" — the minimum is a floor, not a cap.
export function attemptLabel(attempts, cadence) {
  if (attempts < 1) return null;
  const min = cadence?.minAttempts;
  return min && attempts < min ? `Attempt ${attempts} of ${min}` : `Attempt ${attempts}`;
}
