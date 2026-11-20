import { describe, it, expect } from 'vitest';
import { stopReason, streetOf, areaName, suggestAreas, orderStops, routeLinks, milesBetween } from './visitDay';
import { BANKING_CONFIG } from './clientConfig';

const FU = BANKING_CONFIG.followUp;
const FUTURE = '2999-01-01';
const PAST = '2000-01-01';
const RECENT = new Date().toISOString();

// ~0.69 miles per 0.01° of latitude; longitude spacing near Greenville is ~0.57 miles.
let nextId = 1;
const co = (lat, lng, over = {}) => ({
  id: nextId++, firstName: `Co ${nextId}`, status: 'Target', address: `${nextId} Main St, Greenville, SC`,
  geoLat: lat, geoLng: lng, followUpOn: FUTURE, lastNoteAt: RECENT, ...over,
});

describe('stopReason', () => {
  it('takes due follow-ups and pursued statuses, skips the rest', () => {
    expect(stopReason(co(0, 0, { followUpOn: PAST }), FU)).toMatchObject({ due: true, pursued: true, points: 5 });
    expect(stopReason(co(0, 0, { lastNoteAt: null }), FU)).toMatchObject({ due: false, never: true, points: 3 });
    expect(stopReason(co(0, 0, { status: 'Loan Customer' }), FU)).toBeNull();
    expect(stopReason(co(0, 0, { status: 'Loan Customer', followUpOn: PAST }), FU)).toMatchObject({ due: true, points: 3 });
    expect(stopReason(co(0, 0, { status: 'Not a Fit', followUpOn: PAST }), FU)).toBeNull();
  });
});

describe('streetOf / areaName', () => {
  it('strips the number and suite', () => {
    expect(streetOf('307 Main St, Greenville, SC 29609')).toBe('Main St');
    expect(streetOf('12-14 Poinsett Hwy Ste 200, Greenville')).toBe('Poinsett Hwy');
    expect(streetOf('')).toBeNull();
  });
  it('names the area after the most common street', () => {
    expect(areaName([{ address: '1 Pine Rd' }, { address: '2 Main St' }, { address: '9 Main St' }])).toBe('Near Main St');
    expect(areaName([{ address: '' }])).toBe('Nearby');
  });
});

describe('orderStops', () => {
  it('drives a line in order, whichever way it was given', () => {
    const line = [0, 3, 1, 4, 2].map(i => co(34.8 + i * 0.01, -82.4));
    const order = orderStops(line).map(s => s.geoLat);
    const asc = [...order].sort((a, b) => a - b);
    expect(order[0] < order[4] ? order : [...order].reverse()).toEqual(asc);
  });
});

describe('suggestAreas', () => {
  it('groups nearby stops and keeps far ones for another area', () => {
    const here = [co(34.85, -82.39, { followUpOn: PAST }), co(34.851, -82.391), co(34.852, -82.389)];
    const far = [co(35.2, -82.0), co(35.201, -82.001)];
    const areas = suggestAreas([...here, ...far, co(34.85, -82.39, { status: 'Loan Customer' })], FU);
    expect(areas.map(a => a.stops.length)).toEqual([3, 2]);
    expect(areas[0].due).toBe(1);
    expect(areas[0].name).toBe('Near Main St');
    expect(new Set(areas.flatMap(a => a.stops.map(s => s.id))).size).toBe(5);
  });

  it('keeps every stop within the radius of the area centre', () => {
    const spread = Array.from({ length: 12 }, (_, i) => co(34.8 + i * 0.01, -82.4));
    const [first] = suggestAreas(spread, FU, { radiusMiles: 2 });
    const lats = first.stops.map(s => s.geoLat);
    expect(milesBetween({ geoLat: Math.min(...lats), geoLng: 0 }, { geoLat: Math.max(...lats), geoLng: 0 })).toBeLessThanOrEqual(4);
  });

  it('ignores companies without a pin', () => {
    expect(suggestAreas([co(null, null)], FU)).toEqual([]);
  });
});

describe('routeLinks', () => {
  it('one link up to ten stops, starting from wherever the phone is', () => {
    const stops = Array.from({ length: 3 }, (_, i) => co(34.8, -82.4, { address: `${i} Main St` }));
    const [leg] = routeLinks(stops);
    const u = new URL(leg.url);
    expect(u.searchParams.get('origin')).toBeNull();
    expect(u.searchParams.get('destination')).toBe('2 Main St');
    expect(u.searchParams.get('waypoints')).toBe('0 Main St|1 Main St');
    expect(leg).toMatchObject({ from: 1, to: 3 });
  });

  it('splits a long day into legs that pick up where the last one ended', () => {
    const stops = Array.from({ length: 13 }, (_, i) => co(34.8, -82.4, { address: `${i} Main St` }));
    const legs = routeLinks(stops);
    expect(legs.map(l => [l.from, l.to])).toEqual([[1, 10], [11, 13]]);
    const second = new URL(legs[1].url).searchParams;
    expect(second.get('origin')).toBe('9 Main St');
    expect(second.get('waypoints').split('|')).toHaveLength(2);
    expect(new URL(legs[0].url).searchParams.get('waypoints').split('|')).toHaveLength(9);
  });
});
