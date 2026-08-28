import { describe, it, expect } from 'vitest';
import { segmentCount, DNC_LABELS } from './sms';

// The compliance guards themselves are SQL (sms_send_precheck, dnc_state,
// sms_within_quiet_hours in db/20260827_sms.sql) and are exercised against the database,
// not here — a JS reimplementation of them would be the same "second copy of the rule"
// mistake the filter mirror was. What's left in JS is the segment estimate.

describe('segmentCount', () => {
  it('is zero for nothing', () => {
    expect(segmentCount('')).toBe(0);
    expect(segmentCount(undefined)).toBe(0);
  });

  it('counts plain GSM-7 up to 160 as one segment', () => {
    expect(segmentCount('a'.repeat(160))).toBe(1);
    expect(segmentCount('a'.repeat(161))).toBe(2);
  });

  it('uses 153 per segment once concatenated', () => {
    expect(segmentCount('a'.repeat(306))).toBe(2);
    expect(segmentCount('a'.repeat(307))).toBe(3);
  });

  it('charges two septets for GSM-7 extended characters', () => {
    // 159 plain + one '€' = 161 septets, which no longer fits a single segment.
    expect(segmentCount(`${'a'.repeat(159)}€`)).toBe(2);
    expect(segmentCount(`${'a'.repeat(158)}€`)).toBe(1);
  });

  it('drops to UCS-2 lengths when a character is outside GSM-7', () => {
    // An emoji forces UCS-2 for the WHOLE message — the usual way a "short" text
    // silently becomes three segments.
    expect(segmentCount('a'.repeat(70))).toBe(1);
    expect(segmentCount(`${'a'.repeat(69)}🙂`)).toBe(2);
    expect(segmentCount(`${'a'.repeat(100)}🙂`)).toBe(2);
  });

  it('treats a curly apostrophe as UCS-2, not GSM-7', () => {
    // Pasting from Word is the realistic way this happens.
    expect(segmentCount(`${'a'.repeat(100)}’`)).toBe(2);
    expect(segmentCount(`${'a'.repeat(100)}'`)).toBe(1);
  });

  it('handles the disclosure the send function appends', () => {
    // sms-send appends "\n\nReply STOP to opt out." to the first message to a number, so
    // the composer's estimate is low by that much on message one.
    const disclosure = '\n\nReply STOP to opt out.';
    expect(segmentCount(`${'a'.repeat(140)}${disclosure}`)).toBe(2);
  });
});

describe('DNC_LABELS', () => {
  it('covers every state dnc_state() can return', () => {
    expect(Object.keys(DNC_LABELS).sort()).toEqual(['clear', 'invalid', 'listed', 'unknown']);
  });
});
