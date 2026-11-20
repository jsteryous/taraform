// Pure helpers for the company map (PLAN.md "Call days"). No React, no Supabase.
//
// Coordinates come from the server (db/20261120_company_address_geo.sql); this file only
// sorts companies by where their address stands and builds plain Google Maps links, which
// need no API key and store nothing.

// A Google Maps search for one address. Opens the Maps app on a phone.
export function mapsSearchUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || '')}`;
}

// Where each company's address stands, for the map and its cleanup list.
//   placed:   has coordinates — a pin
//   pending:  address saved, the server hasn't looked it up yet
//   notFound: the geocoder couldn't match it — usually a typo, a PO box or a missing ZIP
//   missing:  no address at all
export function groupByLocation(companies) {
  const out = { placed: [], pending: [], notFound: [], missing: [] };
  for (const c of companies || []) {
    if (!c.address) out.missing.push(c);
    else if (c.geoStatus === 'found' && Number.isFinite(c.geoLat) && Number.isFinite(c.geoLng)) out.placed.push(c);
    else if (c.geoStatus === 'not_found') out.notFound.push(c);
    else out.pending.push(c);
  }
  return out;
}

// Map bounds [[south, west], [north, east]] around the pins, or null with none.
export function boundsOf(points) {
  if (!points?.length) return null;
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const p of points) {
    s = Math.min(s, p.geoLat); n = Math.max(n, p.geoLat);
    w = Math.min(w, p.geoLng); e = Math.max(e, p.geoLng);
  }
  return [[s, w], [n, e]];
}
