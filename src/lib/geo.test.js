import { describe, it, expect } from 'vitest';
import { groupByLocation, boundsOf, mapsSearchUrl } from './geo';

describe('groupByLocation', () => {
  it('sorts companies by where their address stands', () => {
    const g = groupByLocation([
      { id: 1, address: '1 Main St', geoStatus: 'found', geoLat: 34.8, geoLng: -82.4 },
      { id: 2, address: '2 Main St', geoStatus: 'pending', geoLat: null, geoLng: null },
      { id: 3, address: 'PO Box 9', geoStatus: 'not_found', geoLat: null, geoLng: null },
      { id: 4, address: null, geoStatus: null },
      { id: 5, address: '' },
    ]);
    expect(g.placed.map(c => c.id)).toEqual([1]);
    expect(g.pending.map(c => c.id)).toEqual([2]);
    expect(g.notFound.map(c => c.id)).toEqual([3]);
    expect(g.missing.map(c => c.id)).toEqual([4, 5]);
  });

  it('never pins a company whose status says found but has no coordinates', () => {
    const g = groupByLocation([{ id: 1, address: '1 Main St', geoStatus: 'found', geoLat: null, geoLng: null }]);
    expect(g.placed).toEqual([]);
    expect(g.pending.map(c => c.id)).toEqual([1]);
  });

  it('treats an address with no status yet as pending (saved before a reload)', () => {
    expect(groupByLocation([{ id: 1, address: '1 Main St' }]).pending).toHaveLength(1);
  });
});

describe('boundsOf', () => {
  it('is null with no pins', () => {
    expect(boundsOf([])).toBeNull();
  });
  it('spans every pin', () => {
    expect(boundsOf([{ geoLat: 34.8, geoLng: -82.4 }, { geoLat: 34.9, geoLng: -82.3 }]))
      .toEqual([[34.8, -82.4], [34.9, -82.3]]);
  });
});

describe('mapsSearchUrl', () => {
  it('encodes the address into a keyless Google Maps search', () => {
    expect(mapsSearchUrl('307 Main St, Greenville, SC 29609'))
      .toBe('https://www.google.com/maps/search/?api=1&query=307%20Main%20St%2C%20Greenville%2C%20SC%2029609');
  });
});
