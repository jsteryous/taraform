import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { displayName } from './links';
import { mapDbContact, mapContactToDb } from './utils';
import { resolveConfig, BANKING_CONFIG, LAND_CONFIG } from './clientConfig';

describe('contact kind', () => {
  it('defaults to person, so every pre-companies row keeps working', () => {
    expect(mapDbContact({ id: 1, first_name: 'Jane', last_name: 'Doe' }).kind).toBe('person');
    expect(mapContactToDb({ firstName: 'Jane' }, 'u', 'c').kind).toBe('person');
  });

  it('round-trips a company', () => {
    const c = mapDbContact({ id: 2, kind: 'company', first_name: 'Acme Holdings LLC', last_name: '' });
    expect(c.kind).toBe('company');
    expect(mapContactToDb(c, 'u', 'c').kind).toBe('company');
  });
});

describe('displayName', () => {
  it('joins a person and leaves a company whole', () => {
    expect(displayName({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
    expect(displayName({ firstName: 'Acme Holdings LLC', lastName: '' })).toBe('Acme Holdings LLC');
  });

  it('never renders blank', () => {
    expect(displayName({})).toBe('Unnamed');
    expect(displayName(null)).toBe('Unnamed');
  });
});

describe('banking preset', () => {
  const cfg = resolveConfig({ config: { type: 'banking' } });

  it('turns companies on, and only there', () => {
    expect(cfg.companies).toBe(true);
    expect(resolveConfig({ config: { type: 'land' } }).companies).toBeUndefined();
    expect(LAND_CONFIG.companies).toBeUndefined();
  });

  it('has no offers tab and no land fields', () => {
    expect(cfg.tabs).toEqual(['notes']);
    expect(cfg.visibleFields).toEqual([]);
  });

  // The follow-up rules name statuses; a typo there silently never fires.
  it('only names statuses that exist', () => {
    const known = new Set(BANKING_CONFIG.statuses.map(s => s.value));
    const { followUp, statsPills } = BANKING_CONFIG;
    for (const s of [...followUp.statuses, ...followUp.excludeStatuses, ...followUp.cadence.statuses]) {
      expect(known.has(s)).toBe(true);
    }
    for (const p of statsPills) if (p.status !== null) expect(known.has(p.status)).toBe(true);
  });

  // A workspace saved from the settings screen stores its statuses but not the flag;
  // the flag has to survive that.
  it('keeps companies on after the workspace config is customised', () => {
    const saved = resolveConfig({ config: { type: 'banking', statuses: [{ value: 'Target', color: '#000' }], tabs: ['notes'] } });
    expect(saved.companies).toBe(true);
  });
});
