import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { kindOptions, parseAliases, findGroupByName, kindLabel, guessKind } from './groups';

describe('kindOptions', () => {
  it('offers no faith groups in a banking workspace', () => {
    expect(kindOptions({ type: 'banking' }).map(k => k.value)).not.toContain('faith');
  });
  it('offers them elsewhere', () => {
    expect(kindOptions({ type: 'land' }).map(k => k.value)).toContain('faith');
    expect(kindOptions(undefined).map(k => k.value)).toContain('faith');
  });
});

describe('parseAliases', () => {
  it('splits on commas, trims, drops blanks and repeats in any case', () => {
    expect(parseAliases(' GCC, , Glen CC,gcc ,Glen  CC')).toEqual(['GCC', 'Glen CC']);
  });
  it('leaves out the group name itself', () => {
    expect(parseAliases('Glen Club, GCC', 'glen club')).toEqual(['GCC']);
  });
  it('handles nothing', () => {
    expect(parseAliases('')).toEqual([]);
    expect(parseAliases(undefined)).toEqual([]);
  });
});

describe('findGroupByName', () => {
  const groups = [
    { id: 1, name: 'Glen Club', aliases: ['GCC'] },
    { id: 2, name: 'Rotary', aliases: [] },
  ];
  it('matches a name or an alias, ignoring case and spaces', () => {
    expect(findGroupByName(groups, ' glen club ')?.id).toBe(1);
    expect(findGroupByName(groups, 'gcc')?.id).toBe(1);
    expect(findGroupByName(groups, 'ROTARY')?.id).toBe(2);
  });
  it('does not match a part of a name', () => {
    expect(findGroupByName(groups, 'Glen')).toBeNull();
    expect(findGroupByName(groups, '')).toBeNull();
  });
});

describe('kindLabel', () => {
  it('labels a kind', () => {
    expect(kindLabel('club')).toBe('Club');
    expect(kindLabel('nope')).toBe('Other');
  });
});

describe('guessKind', () => {
  it('guesses from words in the name', () => {
    expect(guessKind('Glen Country Club')).toBe('club');
    expect(guessKind('Glen CC')).toBe('club');
    expect(guessKind('Riverside Rotary')).toBe('club');
    expect(guessKind('State University')).toBe('school');
    expect(guessKind('Grace Church', { type: 'land' })).toBe('faith');
    expect(guessKind('County Fair Board')).toBe('other');
  });
  it('never guesses faith in a banking workspace', () => {
    expect(guessKind('Grace Church', { type: 'banking' })).toBe('other');
  });
  it('matches whole words only', () => {
    expect(guessKind('Clubhouse Farms')).toBe('other');
  });
});

describe('isFaithName', () => {
  it('spots a church by name, not other groups', async () => {
    const { isFaithName } = await import('./groups');
    expect(isFaithName('Resurrection Church')).toBe(true);
    expect(isFaithName('Greenville Country Club')).toBe(false);
  });
});
