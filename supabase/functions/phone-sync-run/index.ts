// One user's nightly contact sync. Invoked per user by pg_cron (see
// db/20260804_phone_sync_cron.sql) or on demand via the connect function's "sync-now".
//
// service_role only — it takes a user_id in the body, so anything else calling it would be
// able to sync (and read) another tenant's contacts. The contact read itself still goes
// through phone_sync_contacts_for(), which does the membership join in SQL; this function
// never queries property_crm_contacts directly, because service_role bypasses RLS.
//
// Interrupted runs are safe: the sync is a reconcile, not an append, so a run that dies
// halfway is simply finished by the next one. Nothing double-creates.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  buildPerson, dedupeByPhone, phoneKey, diffContacts, groupMembership,
  taraformResourceNames, withoutPersonalNumbers,
} from '../_shared/phoneSync.js';
import {
  accessTokenFrom, peopleApi, listContacts, resolveGroup, applyPlan, GoogleError,
} from '../_shared/google.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// PostgREST caps rows per response (db-max-rows, 1000 by default). Paging is not optional:
// without it a user with >1000 contacts silently syncs only the first 1000, and the diff
// would then DELETE the rest from their phone as "no longer qualifying".
const PAGE = 1000;

// Only the scheduler (and the connect function's "sync-now") may call this — it takes a
// user_id in the body, so a user-authenticated caller could sync, and thereby read, another
// tenant's contacts.
//
// Two accepted shapes, because the platform's injected SUPABASE_SERVICE_ROLE_KEY is not
// guaranteed to be the legacy JWT that pg_cron presents from Vault — string equality alone
// silently 403s every nightly run:
//
//   1. the bearer equals SUPABASE_SERVICE_ROLE_KEY exactly (covers new-format secret keys)
//   2. the bearer is a JWT whose role claim is service_role
//
// (2) is safe *because* this function is deployed with verify_jwt on: the platform has
// already validated the signature before we run, so an unsigned forgery never reaches this
// code and we only have to judge the claims. A user's token carries role=authenticated and
// the anon key carries role=anon, so neither passes.
function roleOf(jwt: string): string {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return '';
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(json)?.role ?? '';
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

async function loadContacts(db: any, userId: string) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .rpc('phone_sync_contacts_for', { p_user: userId })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Loading contacts failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function syncUser(db: any, userId: string, dryRun: boolean) {
  const { data: refreshToken, error: tokenErr } = await db.rpc('phone_sync_read_token', { p_user: userId });
  if (tokenErr) throw new Error(`Reading token failed: ${tokenErr.message}`);
  if (!refreshToken) throw new Error('No Google connection for this user');

  const [rows, clientsRes] = await Promise.all([
    loadContacts(db, userId),
    db.rpc('phone_sync_clients_for', { p_user: userId }),
  ]);
  if (clientsRes.error) throw new Error(`Loading clients failed: ${clientsRes.error.message}`);

  const clients = clientsRes.data ?? [];
  const clientNames = new Map(clients.map((c: any) => [c.id, c.name]));
  // Already ordered by priority in SQL — this is what decides which list wins when the
  // same owner appears in two of them.
  const priority = clients.map((c: any) => c.id);

  // Counted BEFORE dedupe: a contact that clears has_good_phone but has no clean 10-digit
  // NANP number has no phone key, so dedupeByPhone drops it and it would otherwise vanish
  // from the accounting entirely.
  const undialable = rows.filter((r) => !phoneKey(r)).length;

  const deduped = dedupeByPhone(rows, priority);
  const mergedRows = deduped.reduce((n: number, d: any) => n + d.mergedFrom.length, 0);

  const label = (c: any) =>
    `${[c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown'}`
    + `${c.status ? ` (${c.status})` : ''} — ${clientNames.get(c.client_id) ?? 'unknown list'}`;

  const wanted = new Map<string, any>();
  for (const { contact, mergedFrom } of deduped) {
    const person = buildPerson(contact, clientNames.get(contact.client_id) ?? '', mergedFrom.map(label));
    if (!person) continue; // already counted in `undialable`
    wanted.set(String(contact.id), person);
  }

  const api = peopleApi(await accessTokenFrom(refreshToken));
  const existing = await listContacts(api);

  // A lead already in the user's own address book is left to their own card — otherwise the
  // phone unifies the two and the lead card's name and photo win. See withoutPersonalNumbers.
  const { desired, skipped } = withoutPersonalNumbers(wanted, existing);

  const plan = diffContacts(desired, existing);

  const stats = {
    contacts: rows.length,
    synced: desired.size,
    undialable,
    merged: mergedRows,
    skipped_personal: skipped.length,
    created: plan.toCreate.length,
    updated: plan.toUpdate.length,
    deleted: plan.toDelete.length,
    // Proof the safety rule held: contacts in the account without a taraform_id stamp.
    untouched: existing.length - taraformResourceNames(existing).length,
    dry_run: dryRun,
  };

  if (!dryRun) {
    const group = await resolveGroup(api);
    await applyPlan(api, plan, groupMembership(group), group, existing);
  }
  return stats;
}

Deno.serve(async (req) => {
  if (!authorized(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { user_id: userId, dry_run: dryRun = false } = await req.json().catch(() => ({}));
  if (!userId) {
    return new Response(JSON.stringify({ error: 'user_id is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const stats = await syncUser(db, userId, dryRun);
    if (!dryRun) await db.rpc('phone_sync_record_result', { p_user: userId, p_error: null, p_stats: stats });
    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = (err as Error).message ?? 'Unexpected error';
    // Never log names or numbers — this is other users' client PII now.
    console.error(`sync failed for ${userId}: ${message}`);
    await db.rpc('phone_sync_record_result', { p_user: userId, p_error: message, p_stats: null });
    return new Response(JSON.stringify({
      error: message,
      needsReconnect: err instanceof GoogleError && err.needsReconnect,
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
