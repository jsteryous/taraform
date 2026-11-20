// Plan a visit day (PLAN.md "Call days", step 3). Pure: no React, no Supabase.
//
// From every company with a map pin, pick the ones worth a stop (due for follow-up, or a
// Target/Prospect), find the tightest bunches of them, and put a bunch in driving order
// with Google Maps links for the phone. Links need no API key and store nothing.
//
// Visits aren't logged yet (that's "log as you go"), so "never visited" can't be known;
// "never contacted" (no notes at all) stands in for it.

import { isFollowUpDue } from './contactFilters';

export const VISIT_DEFAULTS = {
  radiusMiles: 2,      // how far apart stops in one area may be, from the area's centre company
  maxStops: 10,        // a full day of walk-ins
  suggestions: 3,      // areas offered at once
  pursued: ['Target', 'Prospect'],
};

// Google Maps directions links hold 9 waypoints plus the destination. With no origin the
// phone starts from where you are, so the first leg is 10 stops; later legs start at the
// previous leg's last stop and add up to 10 more.
const LEG_STOPS = 10;

const R_MILES = 3958.8;
export function milesBetween(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.geoLat - a.geoLat);
  const dLng = rad(b.geoLng - a.geoLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.geoLat)) * Math.cos(rad(b.geoLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Why a company is worth a stop, or null if it isn't. Points rank stops and areas:
// due 3, never contacted 1, pursued status 2.
export function stopReason(c, followUp, pursued = VISIT_DEFAULTS.pursued) {
  if ((followUp?.excludeStatuses || []).includes(c.status)) return null;
  const due = isFollowUpDue(c, followUp);
  const isPursued = pursued.includes(c.status);
  if (!due && !isPursued) return null;
  const never = !c.lastNoteAt;
  return { due, never, pursued: isPursued, points: (due ? 3 : 0) + (isPursued ? 2 : 0) + (never ? 1 : 0) };
}

// "307 Main St, Greenville, SC 29609" → "Main St". Null when there's no street to name.
export function streetOf(address) {
  const first = String(address || '').split(',')[0].trim();
  const street = first.replace(/^\d+[A-Za-z]?(-\d+)?\s+/, '').replace(/\s+(ste|suite|unit|#)\s*\S*$/i, '').trim();
  return /[a-z]/i.test(street) ? street : null;
}

// The street most stops share, else the first stop's.
export function areaName(stops) {
  const counts = new Map();
  for (const s of stops) {
    const st = streetOf(s.address);
    if (st) counts.set(st, (counts.get(st) || 0) + 1);
  }
  let best = null;
  for (const [st, n] of counts) if (!best || n > best[1]) best = [st, n];
  return best ? `Near ${best[0]}` : 'Nearby';
}

// Up to `suggestions` areas, best first, no company in two of them.
// Each: { name, stops: [{ ...company, reason }], due, never, points }.
export function suggestAreas(companies, followUp, opts = {}) {
  const o = { ...VISIT_DEFAULTS, ...opts };
  let pool = [];
  for (const c of companies || []) {
    if (!Number.isFinite(c.geoLat) || !Number.isFinite(c.geoLng)) continue;
    const reason = stopReason(c, followUp, o.pursued);
    if (reason) pool.push({ ...c, reason });
  }
  const byPoints = (a, b) => b.reason.points - a.reason.points;

  const areas = [];
  while (pool.length && areas.length < o.suggestions) {
    let best = null;
    for (const centre of pool) {
      const near = pool
        .map(c => ({ c, d: milesBetween(centre, c) }))
        .filter(x => x.d <= o.radiusMiles)
        .sort((a, b) => byPoints(a.c, b.c) || a.d - b.d)
        .slice(0, o.maxStops)
        .map(x => x.c);
      const points = near.reduce((n, c) => n + c.reason.points, 0);
      if (!best || points > best.points || (points === best.points && near.length > best.stops.length)) {
        best = { stops: near, points };
      }
    }
    const taken = new Set(best.stops.map(s => s.id));
    pool = pool.filter(c => !taken.has(c.id));
    const stops = orderStops(best.stops);
    areas.push({
      name: areaName(stops),
      stops,
      points: best.points,
      due: stops.filter(s => s.reason.due).length,
      never: stops.filter(s => s.reason.never).length,
    });
  }
  return areas;
}

function pathMiles(stops) {
  let d = 0;
  for (let i = 1; i < stops.length; i++) d += milesBetween(stops[i - 1], stops[i]);
  return d;
}

// Shortest open path through the stops (no fixed start: you drive to whichever end is
// nearer). Nearest neighbour from every start, then 2-opt; exact enough for ten stops.
export function orderStops(stops) {
  if (!stops || stops.length < 3) return [...(stops || [])];
  let best = null;
  for (let start = 0; start < stops.length; start++) {
    const left = stops.filter((_, i) => i !== start);
    const path = [stops[start]];
    while (left.length) {
      const last = path[path.length - 1];
      let k = 0;
      for (let i = 1; i < left.length; i++) if (milesBetween(last, left[i]) < milesBetween(last, left[k])) k = i;
      path.push(left.splice(k, 1)[0]);
    }
    twoOpt(path);
    const d = pathMiles(path);
    if (!best || d < best.d - 1e-9) best = { path, d };
  }
  return best.path;
}

function twoOpt(path) {
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < path.length - 2; i++) {
      for (let j = i + 2; j < path.length; j++) {
        const a = path[i], b = path[i + 1], c = path[j], d = path[j + 1];
        const before = milesBetween(a, b) + (d ? milesBetween(c, d) : 0);
        const after = milesBetween(a, c) + (d ? milesBetween(b, d) : 0);
        if (after < before - 1e-9) {
          path.splice(i + 1, j - i, ...path.slice(i + 1, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
}

// One Google Maps directions link per leg: [{ from, to, url }] with 1-based stop numbers.
export function routeLinks(stops) {
  const place = s => s.address || `${s.geoLat},${s.geoLng}`;
  const legs = [];
  for (let i = 0; i < stops.length; i += LEG_STOPS) {
    const leg = stops.slice(i, i + LEG_STOPS);
    const origin = i > 0 ? stops[i - 1] : null;
    const p = new URLSearchParams({ api: '1', travelmode: 'driving', destination: place(leg[leg.length - 1]) });
    if (origin) p.set('origin', place(origin));
    if (leg.length > 1) p.set('waypoints', leg.slice(0, -1).map(place).join('|'));
    legs.push({ from: i + 1, to: i + leg.length, url: `https://www.google.com/maps/dir/?${p.toString()}` });
  }
  return legs;
}
