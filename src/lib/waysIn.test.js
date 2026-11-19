import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { normalizeWaysIn, describeWaysIn, knowsPhrase, strongest, whoLabel } from './waysIn';

const ME = 'u-me';
const KIM = 'u-kim';
const ctx = { me: ME, names: new Map([[ME, 'me'], [KIM, 'kim']]) };

const raw = (over = {}) => ({ warmth: 'cold', familiarity: [], connections: [], groups: [], ...over });
const w = (over) => normalizeWaysIn(raw(over));

describe('normalizeWaysIn', () => {
  it('maps the RPC shape and joins names', () => {
    const n = w({
      warmth: 'intro',
      connections: [{ id: 1, contact_id: 7, first_name: 'Pat', last_name: 'Two', description: 'college',
        referred_by: null, unsure: false, note_body: null, known_by: [{ user_id: ME, level: 'know' }] }],
      groups: [{ id: 3, name: 'Glen Club', kind: 'club', teammates: [KIM],
        known_contacts: [{ contact_id: 9, first_name: 'Lee', last_name: '', known_by: [{ user_id: KIM, level: 'know_well' }] }] }],
    });
    expect(n.connections[0]).toMatchObject({ contactId: 7, name: 'Pat Two', noteBody: '', knownBy: [{ userId: ME, level: 'know' }] });
    expect(n.groups[0].knownContacts[0]).toEqual({ contactId: 9, name: 'Lee', knownBy: [{ userId: KIM, level: 'know_well' }] });
  });

  it('tolerates missing arrays', () => {
    expect(normalizeWaysIn({ warmth: 'cold' })).toEqual({ warmth: 'cold', familiarity: [], connections: [], groups: [] });
  });
});

describe('whoLabel / knowsPhrase', () => {
  it('says You for the signed-in user', () => {
    expect(whoLabel(ME, ctx)).toBe('You');
    expect(whoLabel(KIM, ctx)).toBe('kim');
    expect(whoLabel('gone', ctx)).toBe('A former teammate');
  });

  it('conjugates for you and for a teammate', () => {
    expect(knowsPhrase('You', 'know_well', 'them')).toBe('You know them well');
    expect(knowsPhrase('kim', 'know_well', 'them')).toBe('kim knows them well');
    expect(knowsPhrase('You', 'met', 'Pat')).toBe('You have met Pat');
    expect(knowsPhrase('kim', 'met', 'Pat')).toBe('kim has met Pat');
    expect(knowsPhrase('kim', 'know', 'Pat')).toBe('kim knows Pat');
  });
});

describe('strongest', () => {
  it('picks the highest level, the signed-in user among equals', () => {
    expect(strongest([{ userId: KIM, level: 'know' }, { userId: ME, level: 'met' }], ME).userId).toBe(KIM);
    expect(strongest([{ userId: KIM, level: 'know' }, { userId: ME, level: 'know' }], ME).userId).toBe(ME);
    expect(strongest([], ME)).toBeNull();
  });
});

describe('describeWaysIn', () => {
  it('warm, you: call them yourself', () => {
    const d = describeWaysIn(w({ warmth: 'warm', familiarity: [{ user_id: ME, level: 'know_well' }] }), ctx);
    expect(d).toEqual({ headline: 'Call them yourself.', detail: 'You know them well.' });
  });

  it('warm, a teammate: ask them', () => {
    const d = describeWaysIn(w({ warmth: 'warm',
      familiarity: [{ user_id: KIM, level: 'know' }, { user_id: ME, level: 'met' }] }), ctx);
    expect(d).toEqual({ headline: 'Best way in: ask kim.', detail: 'kim knows them.' });
  });

  it('intro: names the connection, how they know each other, and who knows them', () => {
    const d = describeWaysIn(w({ warmth: 'intro', connections: [
      { id: 1, contact_id: 7, first_name: 'Pat', last_name: 'Two', description: 'college', known_by: [{ user_id: ME, level: 'know_well' }] },
    ] }), ctx);
    expect(d).toEqual({ headline: 'Best way in: ask Pat Two.', detail: 'You know Pat Two well. How they know each other: college.' });
  });

  it('intro through a teammate, flagged when not confirmed', () => {
    const d = describeWaysIn(w({ warmth: 'intro', connections: [
      { id: 1, contact_id: 7, first_name: 'Pat', last_name: '', unsure: true, known_by: [{ user_id: KIM, level: 'know' }] },
    ] }), ctx);
    expect(d).toEqual({ headline: 'Best way in: kim can ask Pat.', detail: 'kim knows Pat. Not confirmed.' });
  });

  it('intro prefers a confirmed connection that is just as warm', () => {
    const d = describeWaysIn(w({ warmth: 'intro', connections: [
      { id: 1, contact_id: 7, first_name: 'Hunch', last_name: '', unsure: true, known_by: [{ user_id: ME, level: 'know' }] },
      { id: 2, contact_id: 8, first_name: 'Sure', last_name: '', unsure: false, known_by: [{ user_id: ME, level: 'know' }] },
    ] }), ctx);
    expect(d.headline).toBe('Best way in: ask Sure.');
  });

  it('common: your own group first', () => {
    const d = describeWaysIn(w({ warmth: 'common', groups: [
      { id: 1, name: 'Board A', kind: 'other', teammates: [KIM], known_contacts: [] },
      { id: 2, name: 'Glen Club', kind: 'club', teammates: [KIM, ME], known_contacts: [] },
    ] }), ctx);
    expect(d.headline).toBe("Excuse to reach out: you're both in Glen Club.");
  });

  it('common: a teammate in the group', () => {
    const d = describeWaysIn(w({ warmth: 'common', groups: [
      { id: 1, name: 'Glen Club', kind: 'club', teammates: [KIM], known_contacts: [] },
    ] }), ctx);
    expect(d.headline).toBe('Excuse to reach out: kim is in Glen Club too.');
  });

  it('common: someone a teammate knows is in the group', () => {
    const d = describeWaysIn(w({ warmth: 'common', groups: [
      { id: 1, name: 'Glen Club', kind: 'club', teammates: [], known_contacts: [
        { contact_id: 9, first_name: 'Lee', last_name: 'Ray', known_by: [{ user_id: KIM, level: 'know_well' }] }] },
    ] }), ctx);
    expect(d).toEqual({ headline: 'Excuse to reach out: Lee Ray is in Glen Club too.', detail: 'kim knows Lee Ray well.' });
  });

  it('common: met', () => {
    expect(describeWaysIn(w({ warmth: 'common', familiarity: [{ user_id: ME, level: 'met' }] }), ctx).headline)
      .toBe("You've met them.");
    expect(describeWaysIn(w({ warmth: 'common', familiarity: [{ user_id: KIM, level: 'met' }] }), ctx).headline)
      .toBe('kim has met them.');
  });

  it('cold', () => {
    expect(describeWaysIn(w({}), ctx).headline).toBe('No way in yet.');
    expect(describeWaysIn(null, ctx)).toEqual({ headline: '', detail: '' });
  });
});
