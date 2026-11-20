// Fills in coordinates for addresses waiting on them. Started by pg_cron through
// geocode_dispatch() (db/20261120_company_address_geo.sql) only when something is pending.
//
// Uses the US Census geocoder: free, no key, and its results may be stored, unlike
// Google's. It matches street addresses only; a PO box, a bare city or a typo comes back
// 'not_found', which the Map page lists for cleanup.
//
// service_role only, the same check as phone-sync-run. It reads and writes only through
// geocode_pending()/geocode_record(), which are granted to service_role alone. It returns
// counts, never addresses.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const BATCH = 40;          // per run; the next cron run takes the rest
const CONCURRENCY = 4;     // be polite to a free public service

function roleOf(jwt: string): string {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return '';
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))?.role ?? '';
  } catch {
    return '';
  }
}

function authorized(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  if (SERVICE_KEY && token === SERVICE_KEY) return true;
  return roleOf(token) === 'service_role';
}

type Hit = { lat: number; lng: number; matched: string } | null;

// null = the geocoder answered and found nothing. Throws when it didn't answer, so the
// row stays pending and is retried instead of being marked not found.
async function lookup(address: string): Promise<Hit> {
  const url = `${CENSUS}?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(address)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`census ${res.status}`);
  const body = await res.json();
  const m = body?.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  return { lat: Number(m.coordinates.y), lng: Number(m.coordinates.x), matched: String(m.matchedAddress ?? '') };
}

Deno.serve(async (req) => {
  if (!authorized(req)) return new Response('forbidden', { status: 403 });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: rows, error } = await db.rpc('geocode_pending', { p_limit: BATCH });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const stats = { found: 0, not_found: 0, retry: 0, superseded: 0 };
  const queue = [...(rows ?? [])] as { id: number; address: string }[];

  async function worker() {
    for (let row = queue.shift(); row; row = queue.shift()) {
      let hit: Hit;
      try {
        hit = await lookup(row.address);
      } catch {
        stats.retry++;
        continue;
      }
      const { data: applied, error: e } = await db.rpc('geocode_record', {
        p_id: row.id, p_address: row.address,
        p_lat: hit?.lat ?? null, p_lng: hit?.lng ?? null, p_matched: hit?.matched ?? null,
      });
      if (e) { stats.retry++; continue; }
      if (!applied) { stats.superseded++; continue; }
      if (hit) stats.found++; else stats.not_found++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return Response.json({ batch: rows?.length ?? 0, ...stats });
});
