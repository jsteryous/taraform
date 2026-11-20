import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { normalizeWaysIn, describeWaysIn, knowsPhrase, strongest, listLevel, levelLabel, whoLabel, howTheyKnow, colleagueLine, companyWaysIn, describeCompanyWaysIn } from './waysIn';

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
        referred_by: null, unsure: false, note_body: null, known_by: [{ user_id: ME, level: 'met' }] }],
      groups: [{ id: 3, name: 'Glen Club', kind: 'club', teammates: [KIM],
        known_contacts: [{ contact_id: 9, first_name: 'Lee', last_name: '', known_by: [{ user_id: KIM, level: 'know_well' }] }] }],
    });
    expect(n.connections[0]).toMatchObject({ contactId: 7, name: 'Pat Two', noteBody: '', knownBy: [{ userId: ME, level: 'met' }] });
    expect(n.groups[0].knownContacts[0]).toEqual({ contactId: 9, name: 'Lee', knownBy: [{ userId: KIM, level: 'know_well' }] });
  });

  it('tolerates missing arrays', () => {
    expect(normalizeWaysIn({ warmth: 'cold' })).toEqual({ warmth: 'cold', familiarity: [], connections: [], colleagues: [], groups: [] });
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
  });
});

describe('strongest', () => {
  it('picks the highest level, the signed-in user among equals', () => {
    expect(strongest([{ userId: KIM, level: 'know_well' }, { userId: ME, level: 'met' }], ME).userId).toBe(KIM);
    expect(strongest([{ userId: KIM, level: 'met' }, { userId: ME, level: 'met' }], ME).userId).toBe(ME);
    expect(strongest([], ME)).toBeNull();
  });
});

describe('listLevel', () => {
  it('shows your own level, even when a teammate knows them better', () => {
    expect(listLevel([{ userId: KIM, level: 'know_well' }, { userId: ME, level: 'met' }], ME))
      .toEqual({ level: 'met', mine: true });
  });
  it("falls back to the team's warmest when you haven't set one", () => {
    expect(listLevel([{ userId: KIM, level: 'met' }, { userId: 'x', level: 'met' }], ME))
      .toEqual({ level: 'met', mine: false });
  });
  it('is null when nobody has met them', () => {
    expect(listLevel([], ME)).toBeNull();
    expect(listLevel(undefined, ME)).toBeNull();
  });
  it('labels levels the way the contact page does', () => {
    expect(levelLabel('know_well')).toBe('Know well');
    expect(levelLabel(null)).toBe("Haven't met");
  });
});

describe('describeWaysIn', () => {
  it('warm, you: call them yourself', () => {
    const d = describeWaysIn(w({ warmth: 'warm', familiarity: [{ user_id: ME, level: 'know_well' }] }), ctx);
    expect(d).toEqual({ headline: 'Call them yourself.', detail: 'You know them well.' });
  });

  it('warm, a teammate: ask them', () => {
    const d = describeWaysIn(w({ warmth: 'warm', familiarity: [{ user_id: KIM, level: 'met' }] }), ctx);
    expect(d).toEqual({ headline: 'Best way in: ask kim.', detail: 'kim has met them.' });
  });

  it('warm, you have met them and a teammate knows them well: still call them yourself', () => {
    const d = describeWaysIn(w({ warmth: 'warm',
      familiarity: [{ user_id: KIM, level: 'know_well' }, { user_id: ME, level: 'met' }] }), ctx);
    expect(d).toEqual({ headline: 'Call them yourself.', detail: 'You have met them.' });
  });

  it('intro: names the connection, how they know each other, and who knows them', () => {
    const d = describeWaysIn(w({ warmth: 'intro', connections: [
      { id: 1, contact_id: 7, first_name: 'Pat', last_name: 'Two', description: 'college', known_by: [{ user_id: ME, level: 'know_well' }] },
    ] }), ctx);
    expect(d).toEqual({ headline: 'Best way in: ask Pat Two.', detail: 'You know Pat Two well. How they know each other: college.' });
  });

  it('intro through a teammate, flagged when not confirmed', () => {
    const d = describeWaysIn(w({ warmth: 'intro', connections: [
      { id: 1, contact_id: 7, first_name: 'Pat', last_name: '', unsure: true, known_by: [{ user_id: KIM, level: 'met' }] },
    ] }), ctx);
    expect(d).toEqual({ headline: 'Best way in: kim can ask Pat.', detail: 'kim has met Pat. Not confirmed.' });
  });

  it('intro prefers a confirmed connection that is just as warm', () => {
    const d = describeWaysIn(w({ warmth: 'intro', connections: [
      { id: 1, contact_id: 7, first_name: 'Hunch', last_name: '', unsure: true, known_by: [{ user_id: ME, level: 'met' }] },
      { id: 2, contact_id: 8, first_name: 'Sure', last_name: '', unsure: false, known_by: [{ user_id: ME, level: 'met' }] },
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

  it('cold', () => {
    expect(describeWaysIn(w({}), ctx).headline).toBe('Way in: the front door.');
    expect(describeWaysIn(null, ctx)).toEqual({ headline: '', detail: '' });
  });
});

describe('howTheyKnow', () => {
  const c = (over) => ({ contactId: 7, name: 'Pat', description: '', referredBy: null, ...over });
  it('is the description alone when nobody referred anybody', () => {
    expect(howTheyKnow(c({ description: 'College roommates.' }))).toBe('College roommates');
  });
  it('says who referred whom', () => {
    expect(howTheyKnow(c({ referredBy: 7 }))).toBe('Pat referred them');
    expect(howTheyKnow(c({ referredBy: 1 }))).toBe('They referred Pat');
  });
  it('drops a bare "Referred" once the direction says it', () => {
    expect(howTheyKnow(c({ description: 'Referred', referredBy: 7 }))).toBe('Pat referred them');
    expect(howTheyKnow(c({ description: 'Referred' }))).toBe('Referred');
  });
  it('keeps a description that says more', () => {
    expect(howTheyKnow(c({ description: 'Referred the farm loan', referredBy: 1 }))).toBe('Referred the farm loan · They referred Pat');
  });
});

describe('colleagues', () => {
  const tyler = { contact_id: 8, first_name: 'Tyler', last_name: 'H', company_id: 3, company_name: 'Gallo Company',
    title: 'VP', known_by: [{ user_id: ME, level: 'met' }] };

  it('maps colleagues from the RPC', () => {
    expect(w({ colleagues: [tyler] }).colleagues[0]).toEqual({ contactId: 8, name: 'Tyler H', companyId: 3,
      companyName: 'Gallo Company', title: 'VP', knownBy: [{ userId: ME, level: 'met' }] });
  });

  it('says where they work together', () => {
    const c = w({ colleagues: [tyler] }).colleagues[0];
    expect(colleagueLine(c)).toBe('Both at Gallo Company · Tyler H is VP');
    expect(colleagueLine({ ...c, title: '' })).toBe('Both at Gallo Company');
  });

  it('intro through a colleague you know', () => {
    const d = describeWaysIn(w({ warmth: 'intro', colleagues: [tyler] }), ctx);
    expect(d).toEqual({ headline: 'Best way in: ask Tyler H.', detail: 'You have met Tyler H. How they know each other: Both at Gallo Company.' });
  });

  it('a stored connection beats an equally warm colleague', () => {
    const d = describeWaysIn(w({ warmth: 'intro', colleagues: [tyler], connections: [
      { id: 1, contact_id: 7, first_name: 'Pat', last_name: '', known_by: [{ user_id: ME, level: 'met' }] },
    ] }), ctx);
    expect(d.headline).toBe('Best way in: ask Pat.');
  });
});

describe('companyWaysIn', () => {
  const people = [{ id: 1, name: 'Ann Cold', title: '' }, { id: 2, name: 'Bo Warm', title: 'CFO' }, { id: 3, name: 'Cy Intro', title: '' }];
  const ways = new Map([
    [1, w({})],
    [2, w({ warmth: 'warm', familiarity: [{ user_id: ME, level: 'know_well' }],
      connections: [{ id: 9, contact_id: 3, first_name: 'Cy', last_name: 'Intro', known_by: [] }],
      groups: [{ id: 7, name: 'Rotary', kind: 'civic', teammates: [ME], known_contacts: [] }] })],
    [3, w({ warmth: 'intro',
      connections: [{ id: 10, contact_id: 50, first_name: 'Out', last_name: 'Side', known_by: [{ user_id: KIM, level: 'met' }] }],
      groups: [{ id: 7, name: 'Rotary', kind: 'civic', teammates: [ME], known_contacts: [] }] })],
  ]);

  it('takes the warmest person as the company warmth and puts them first', () => {
    const cw = companyWaysIn(people, ways, ME);
    expect(cw.warmth).toBe('warm');
    expect(cw.people.map(p => p.id)).toEqual([2, 3, 1]);
    expect(describeCompanyWaysIn(cw, ctx).headline).toBe('Call Bo Warm, CFO yourself.');
  });

  it('lists connections outside the company with who they come through, and merges groups', () => {
    const cw = companyWaysIn(people, ways, ME);
    expect(cw.outside.map(c => [c.name, c.via.name])).toEqual([['Out Side', 'Cy Intro']]);
    expect(cw.groups.map(g => [g.name, g.people.map(p => p.name)])).toEqual([['Rotary', ['Bo Warm', 'Cy Intro']]]);
  });

  it('says so when nobody is linked or nobody is known', () => {
    expect(describeCompanyWaysIn(companyWaysIn([], new Map(), ME), ctx).headline).toBe('Nobody linked yet.');
    const cold = companyWaysIn([people[0]], ways, ME);
    expect(cold.warmth).toBe('cold');
    expect(describeCompanyWaysIn(cold, ctx).headline).toBe('Way in: the front door.');
  });
});
