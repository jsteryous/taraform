import { describe, it, expect } from 'vitest';
import { buildNameIndex, findInNote, segmentNote, splitName, mentionMatches, guessPhraseType, nameKey } from './noteFinder';

const MICAH = 1, DREW = 2, DREW2 = 3, ANTHONY = 4;
const index = buildNameIndex({
  people: [
    { id: MICAH, name: 'Micah Williams' },
    { id: DREW, name: 'Drew Parker' },
    { id: ANTHONY, name: 'Anthony Gallo' },
    { id: 5, name: 'Matt' },          // no last name: never matched
  ],
  companies: [{ id: 10, name: 'Lee & Associates' }, { id: 11, name: 'Gallo Company' }, { id: 12, name: 'Apple' }],
  groups: [{ id: 20, name: 'Greenville Country Club', aliases: ['GCC'] }, { id: 21, name: 'golf', aliases: [] }],
});
const find = (text, opts) => findInNote(text, index, { selfId: MICAH, ...opts });

describe('findInNote: known names', () => {
  it('links a full name that matches one person', () => {
    const f = find('knows Drew Parker');
    expect(f.people).toEqual([{ id: DREW, name: 'Drew Parker', text: 'Drew Parker' }]);
    expect(f.unknown).toEqual([]);
  });

  it('ignores case, possessives and punctuation around the name', () => {
    expect(find("drew parker's brother").people.map(p => p.id)).toEqual([DREW]);
    expect(find('Lunch with Drew Parker.').people.map(p => p.id)).toEqual([DREW]);
  });

  it('never matches a first name alone', () => {
    const f = find('talked with Drew and Matt');
    expect(f.people).toEqual([]);
  });

  it("never links the note's own contact, and doesn't call its name unknown", () => {
    const f = find('Micah Williams knows Drew Parker');
    expect(f.people.map(p => p.id)).toEqual([DREW]);
    expect(f.unknown).toEqual([]);
  });

  it('asks which one when a full name matches two people', () => {
    const idx = buildNameIndex({ people: [{ id: DREW, name: 'Drew Parker' }, { id: DREW2, name: 'Drew Parker' }] });
    const f = findInNote('knows Drew Parker', idx);
    expect(f.people).toEqual([]);
    expect(f.ambiguous[0].candidates.map(c => c.id)).toEqual([DREW, DREW2]);
  });

  it('an @-mention settles which one', () => {
    const idx = buildNameIndex({ people: [{ id: DREW, name: 'Drew Parker' }, { id: DREW2, name: 'Drew Parker' }] });
    const f = findInNote('knows Drew Parker', idx, { picked: new Map([[nameKey('Drew Parker'), DREW2]]) });
    expect(f.people.map(p => p.id)).toEqual([DREW2]);
    expect(f.ambiguous).toEqual([]);
  });

  it('finds companies, including ones with & in the name', () => {
    const f = find("hasn't changed top performer at Lee & Associates - Industrial");
    expect(f.companies).toEqual([{ id: 10, name: 'Lee & Associates', text: 'Lee & Associates' }]);
  });

  it('a one-word company needs its capital; a group does not', () => {
    expect(find('ate an apple').companies).toEqual([]);
    expect(find('works at Apple').companies.map(c => c.id)).toEqual([12]);
    expect(find('plays golf on Saturdays').groups.map(g => g.id)).toEqual([21]);
  });

  it('finds groups by any other name', () => {
    expect(find('see him at GCC').groups).toEqual([{ id: 20, name: 'Greenville Country Club', text: 'GCC' }]);
  });

  it('prefers the longest name at a position', () => {
    const f = find('Anthony Gallo at Gallo Company');
    expect(f.people.map(p => p.id)).toEqual([ANTHONY]);
    expect(f.companies.map(c => c.id)).toEqual([11]);
  });

  it('reports each thing once', () => {
    expect(find('Drew Parker, then Drew Parker again').people).toHaveLength(1);
  });
});

describe('findInNote: unknown phrases', () => {
  it('offers a capitalised name nobody has', () => {
    expect(find('met Sarah Jones today').unknown).toEqual([{ phrase: 'Sarah Jones', key: 'sarah jones', type: 'person' }]);
  });

  it('takes sentence-starting words off the front', () => {
    expect(find('Called Sarah Jones').unknown.map(u => u.phrase)).toEqual(['Sarah Jones']);
    expect(find('Met Sarah Jones Monday').unknown.map(u => u.phrase)).toEqual(['Sarah Jones']);
  });

  it('relationship words at the front are not part of a name', () => {
    expect(find('Knows Barrett').unknown).toEqual([]);
    expect(find('Good friends with Sarah Jones').unknown.map(u => u.phrase)).toEqual(['Sarah Jones']);
  });

  it('"and" separates two names', () => {
    expect(find('developer of The Commons and Pickle Yard').unknown.map(u => u.phrase)).toEqual(['Pickle Yard']);
  });

  it('keeps joining words inside a name', () => {
    expect(find('banks with Bank of America').unknown.map(u => u.phrase)).toEqual(['Bank of America']);
  });

  it('guesses what kind of thing a phrase is', () => {
    expect(guessPhraseType('First Baptist Church')).toBe('group');
    expect(guessPhraseType('Smith Holdings LLC')).toBe('company');
    expect(guessPhraseType('Sarah Jones')).toBe('person');
  });

  it('skips single capitalised words, sentence starts and ignored terms', () => {
    expect(find('Great guy. Lunch went well').unknown).toEqual([]);
    expect(find('saw it on Linked In', { ignored: new Set(['linked in']) }).unknown).toEqual([]);
  });

  it('breaks a run at a comma or full stop', () => {
    expect(find('Sarah Jones, Tom Brown').unknown.map(u => u.phrase)).toEqual(['Sarah Jones', 'Tom Brown']);
  });

  it('the screenshot note finds the company and nothing spurious', () => {
    const f = find("got lunch w micah today...great guy, hasn't changed top performer at Lee & Associates - Industrial only stay in touch every so often & send thank you note for lunch");
    expect(f.companies.map(c => c.id)).toEqual([10]);
    expect(f.people).toEqual([]);
    expect(f.unknown).toEqual([]);
  });
});

describe('segmentNote', () => {
  it('splits text around recognised names', () => {
    const text = 'knows Drew Parker well';
    const segs = segmentNote(text, find(text).spans);
    expect(segs).toEqual([{ text: 'knows ' }, { text: 'Drew Parker', kind: 'person', id: DREW }, { text: ' well' }]);
  });
});

describe('splitName', () => {
  it('puts the last word in the last name', () => {
    expect(splitName('Drew Parker')).toEqual({ firstName: 'Drew', lastName: 'Parker' });
    expect(splitName('Mary Ann Smith')).toEqual({ firstName: 'Mary Ann', lastName: 'Smith' });
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: '' });
  });
});

describe('mentionMatches', () => {
  it('matches the start of any word, people first', () => {
    expect(mentionMatches(index, 'par').map(m => m.id)).toEqual([DREW]);
    expect(mentionMatches(index, 'gallo').map(m => [m.kind, m.id])).toEqual([['person', ANTHONY], ['company', 11]]);
    expect(mentionMatches(index, 'gcc').map(m => m.id)).toEqual([20]);
  });

  it('leaves out the note’s own contact', () => {
    expect(mentionMatches(index, 'micah', { selfId: MICAH })).toEqual([]);
  });
});
