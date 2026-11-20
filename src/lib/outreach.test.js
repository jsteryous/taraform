import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { planOutreach, introLine, reasonLine } from './outreach';

const ME = 'me', KIM = 'kim';
const NOW = new Date('2026-11-20T12:00:00Z').getTime();

function contacts(list) {
  return new Map(list.map(([id, name, status, kind = 'person', lastNoteAt = null]) =>
    [id, { id, name, status, kind, lastNoteAt }]));
}
const ctx = { me: ME, names: new Map([[KIM, 'kim']]) };

describe('planOutreach: introductions', () => {
  const base = contacts([
    [1, 'Pat Helper', 'In Network'],
    [2, 'Bo Target', 'Target'],
    [3, 'Cy Customer', 'Loan Customer'],
    [4, 'Di Known', 'Prospect'],
    [10, 'Acme LLC', 'Target', 'company'],
    [11, 'Ed Owner', 'Target'],
  ]);

  it('offers a pursued stranger through a known connection', () => {
    const { intros } = planOutreach({
      contacts: base,
      familiarity: [{ contactId: 1, userId: ME, level: 'know_well' }],
      connections: [{ aId: 1, bId: 2, description: 'Golf buddies', referredBy: null, unsure: false }],
    }, { me: ME, now: NOW });
    expect(intros.map(i => [i.targetId, i.helperId, i.how])).toEqual([[2, 1, 'connection']]);
    expect(introLine(intros[0], base, ctx)).toBe('Ask Pat Helper. You know Pat Helper well · Golf buddies.');
  });

  it('skips targets that are not pursued, already known, or reached only through a stranger', () => {
    const { intros } = planOutreach({
      contacts: base,
      familiarity: [
        { contactId: 1, userId: ME, level: 'met' },
        { contactId: 4, userId: KIM, level: 'met' },
      ],
      connections: [
        { aId: 1, bId: 3, description: '', unsure: false }, // customer: not pursued
        { aId: 1, bId: 4, description: '', unsure: false }, // already met by Kim
        { aId: 2, bId: 3, description: '', unsure: false }, // nobody has met the helper
      ],
    }, { me: ME, now: NOW });
    expect(intros).toEqual([]);
  });

  it('treats a company as known through its people, and reaches the unknown ones there', () => {
    const { intros } = planOutreach({
      contacts: base,
      familiarity: [{ contactId: 1, userId: KIM, level: 'met' }],
      links: [
        { companyId: 10, personId: 1, title: 'CFO' },
        { companyId: 10, personId: 11, title: 'Owner' },
      ],
    }, { me: ME, now: NOW });
    const byTarget = new Map(intros.map(i => [i.targetId, i]));
    expect(byTarget.has(10)).toBe(false); // Kim knows Pat, who is at Acme: no intro needed
    expect(byTarget.get(11).how).toBe('colleague');
    expect(introLine(byTarget.get(11), base, ctx)).toBe('kim can ask Pat Helper: they work together at Acme LLC (Owner). kim has met Pat Helper.');
  });

  it('keeps the warmest, confirmed path per target, and ranks warmer helpers first', () => {
    const cs = contacts([[1, 'A', 'In Network'], [5, 'B', 'In Network'], [2, 'T', 'Target'], [6, 'U', 'Prospect']]);
    const { intros } = planOutreach({
      contacts: cs,
      familiarity: [{ contactId: 1, userId: ME, level: 'met' }, { contactId: 5, userId: ME, level: 'know_well' }],
      connections: [
        { aId: 1, bId: 2, description: '', unsure: false },
        { aId: 2, bId: 5, description: '', unsure: true },
        { aId: 1, bId: 6, description: '', unsure: false },
      ],
    }, { me: ME, now: NOW });
    expect(intros.map(i => [i.targetId, i.helperId])).toEqual([[2, 5], [6, 1]]);
    expect(introLine(intros[0], cs, ctx)).toMatch(/Not confirmed\.$/);
  });
});

describe('planOutreach: reasons to reach out', () => {
  const cs = contacts([
    [1, 'Pat Known', 'In Network'],
    [2, 'Bo Member', 'Target'],
    [3, 'Cy Member', 'Prospect'],
    [4, 'Di Quiet', 'Prospect', 'person', '2026-06-01T00:00:00Z'],
    [5, 'Ed Recent', 'Prospect', 'person', '2026-11-10T00:00:00Z'],
    [6, 'Fay Never', 'Target'],
  ]);

  it('finds common ground in a group, preferring you over someone known over a teammate', () => {
    const { reasons } = planOutreach({
      contacts: cs,
      familiarity: [{ contactId: 1, userId: ME, level: 'know_well' }],
      groupMembers: [
        { groupId: 1, groupName: 'Rotary', userId: ME },
        { groupId: 1, groupName: 'Rotary', contactId: 2 },
        { groupId: 2, groupName: 'Country Club', userId: KIM },
        { groupId: 2, groupName: 'Country Club', contactId: 1 },
        { groupId: 2, groupName: 'Country Club', contactId: 3 },
      ],
    }, { me: ME, now: NOW });
    expect(reasons.map(r => reasonLine(r, cs, ctx, NOW))).toEqual([
      "You're both in Rotary.",
      'In Country Club with Pat Known. You know Pat Known well.',
    ]);
  });

  it('surfaces people you know who have gone quiet, never the recently noted', () => {
    const { reasons } = planOutreach({
      contacts: cs,
      familiarity: [
        { contactId: 4, userId: ME, level: 'met' },
        { contactId: 5, userId: ME, level: 'know_well' },
        { contactId: 6, userId: ME, level: 'met' },
        { contactId: 2, userId: KIM, level: 'met' }, // a teammate's, not mine
      ],
    }, { me: ME, now: NOW });
    expect(reasons.map(r => reasonLine(r, cs, ctx, NOW))).toEqual([
      'You have met them. Last note 6 months ago.',
      "You have met them, and there's no note yet.",
    ]);
  });

  it('never offers an intro to a company whose people are all known', () => {
    const cs2 = contacts([[10, 'Acme LLC', 'Target', 'company'], [1, 'A', 'Target'], [2, 'B', 'Target']]);
    const { intros, reasons } = planOutreach({
      contacts: cs2,
      familiarity: [{ contactId: 1, userId: ME, level: 'met' }, { contactId: 2, userId: ME, level: 'know_well' }],
      links: [{ companyId: 10, personId: 1, title: '' }, { companyId: 10, personId: 2, title: '' }],
    }, { me: ME, now: NOW });
    expect(intros).toEqual([]);
    expect(reasons.map(r => r.targetId)).not.toContain(10);
  });

  it('does not repeat an intro target as a reason', () => {
    const { intros, reasons } = planOutreach({
      contacts: cs,
      familiarity: [{ contactId: 1, userId: ME, level: 'met' }],
      connections: [{ aId: 1, bId: 2, description: '', unsure: false }],
      groupMembers: [{ groupId: 1, groupName: 'Rotary', userId: ME }, { groupId: 1, groupName: 'Rotary', contactId: 2 }],
    }, { me: ME, now: NOW });
    expect(intros.map(i => i.targetId)).toEqual([2]);
    expect(reasons).toEqual([]);
  });
});
