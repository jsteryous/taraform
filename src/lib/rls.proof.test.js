import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────────────
// RLS regression guard (Tier 1 backlog item).
//
// Proves a tenant cannot read/update/delete another tenant's rows through the
// public anon client. This is the automated version of the one-off role
// simulation run on 2026-06-10. It talks to LIVE Supabase, so it SELF-SKIPS
// unless the credentials below are present in the environment.
//
// To run it (locally or in a protected CI job — never commit these values):
//
//   VITE_SUPABASE_URL=...            # same project URL the app uses
//   VITE_SUPABASE_ANON_KEY=...       # public anon key
//   RLS_TEST_USER_A_EMAIL=...        # a real auth user (tenant A)
//   RLS_TEST_USER_A_PASSWORD=...
//   RLS_TEST_USER_B_EMAIL=...        # a different auth user (tenant B)
//   RLS_TEST_USER_B_PASSWORD=...
//   RLS_TEST_USER_B_CLIENT_ID=...    # a client_id B is a member of and A is NOT
//
//   npm test                         # the test picks them up automatically
//
// Use throwaway test users seeded with a couple of contacts, NOT production
// accounts — the delete probe targets B's rows (and should be blocked, but
// don't bet a client's data on it).
//
// SKIPPING IS THE DANGEROUS PART. RLS is the only authorization boundary in this
// app, so a proof that quietly self-skips is indistinguishable from no proof at
// all. Set RLS_TEST_REQUIRED=1 (CI does, once the creds are configured — see
// .github/workflows/deploy.yml) and the missing-creds case FAILS instead of
// skipping, so the guard can never disappear without someone noticing.
// ─────────────────────────────────────────────────────────────────────────────

const env = (k) => process.env[k] || (typeof import.meta !== 'undefined' && import.meta.env?.[k]);

const URL = env('VITE_SUPABASE_URL');
const ANON = env('VITE_SUPABASE_ANON_KEY');
const A_EMAIL = env('RLS_TEST_USER_A_EMAIL');
const A_PASS = env('RLS_TEST_USER_A_PASSWORD');
const B_EMAIL = env('RLS_TEST_USER_B_EMAIL');
const B_PASS = env('RLS_TEST_USER_B_PASSWORD');
const B_CLIENT_ID = env('RLS_TEST_USER_B_CLIENT_ID');

const READY = Boolean(URL && ANON && A_EMAIL && A_PASS && B_EMAIL && B_PASS && B_CLIENT_ID);

// Set by CI. Turns "no creds → silently skip" into "no creds → red build".
const REQUIRED = ['1', 'true', 'yes'].includes(String(env('RLS_TEST_REQUIRED') ?? '').toLowerCase());

// This block always runs — it is the thing that makes the skip below visible.
describe('RLS proof configuration', () => {
  it('is configured whenever the environment requires the proof', () => {
    if (!REQUIRED) return; // local dev: skipping is fine, nothing is being shipped
    const missing = [
      'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
      'RLS_TEST_USER_A_EMAIL', 'RLS_TEST_USER_A_PASSWORD',
      'RLS_TEST_USER_B_EMAIL', 'RLS_TEST_USER_B_PASSWORD',
      'RLS_TEST_USER_B_CLIENT_ID',
    ].filter((k) => !env(k));
    expect(
      missing,
      `RLS_TEST_REQUIRED is set but the tenant-isolation proof cannot run — missing: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});

// Fresh in-memory client per session so the two users' tokens never share storage.
function makeClient() {
  return createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(client, email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
}

describe.skipIf(!READY)('RLS tenant isolation (live Supabase)', () => {
  let clientA, clientB, victimId;

  beforeAll(async () => {
    clientB = makeClient();
    await signIn(clientB, B_EMAIL, B_PASS);

    // B can read its own rows — also gives us a real row id to attack as A.
    const { data, error } = await clientB
      .from('property_crm_contacts')
      .select('id')
      .eq('client_id', B_CLIENT_ID)
      .limit(1);
    if (error) throw new Error(`B could not read its own contacts: ${error.message}`);
    expect(data.length).toBeGreaterThan(0); // seed B with at least one contact
    victimId = data[0].id;

    clientA = makeClient();
    await signIn(clientA, A_EMAIL, A_PASS);
  }, 30000);

  afterAll(async () => {
    await clientA?.auth.signOut();
    await clientB?.auth.signOut();
  });

  it("A cannot READ B's contacts", async () => {
    const { data, error } = await clientA
      .from('property_crm_contacts')
      .select('id')
      .eq('client_id', B_CLIENT_ID);
    expect(error).toBeNull();
    expect(data).toEqual([]); // RLS filters the rows out entirely
  });

  it("A cannot UPDATE B's contact", async () => {
    const { data, error } = await clientA
      .from('property_crm_contacts')
      .update({ notes: 'pwned by A' })
      .eq('id', victimId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]); // zero rows affected — RLS blocked the write
  });

  it("A cannot DELETE B's contact", async () => {
    const { data, error } = await clientA
      .from('property_crm_contacts')
      .delete()
      .eq('id', victimId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    // confirm the row is still there from B's side
    const { data: still } = await clientB
      .from('property_crm_contacts')
      .select('id')
      .eq('id', victimId);
    expect(still).toHaveLength(1);
  });

  it('the anon (signed-out) client sees zero contacts', async () => {
    const anon = makeClient();
    const { data, error } = await anon.from('property_crm_contacts').select('id').limit(1);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  // ── Phone sync (db/20260804_google_contact_sync.sql) ────────────────────────
  //
  // The sync's Edge Function runs as service_role and BYPASSES RLS, so the tenancy
  // boundary is the grant list on these functions plus the membership join inside
  // phone_sync_contacts_for(). If any of them ever became callable by `authenticated`,
  // any signed-in user could read every tenant's contacts — or lift another user's
  // Google refresh token straight out of Vault. That is the worst failure this codebase
  // has available, so it gets a direct probe.
  describe('phone sync token + contact scoping', () => {
    it('a signed-in user cannot read the google_contact_sync table', async () => {
      const { data, error } = await clientA.from('google_contact_sync').select('*');
      // RLS is on with zero policies, so this is either an error or an empty set —
      // what must never happen is a row coming back with a token_secret_id in it.
      expect(data ?? []).toEqual([]);
      if (error) expect(error.message).toBeTruthy();
    });

    it("a signed-in user cannot call phone_sync_contacts_for on another user", async () => {
      const { data: { user: userB } } = await clientB.auth.getUser();
      const { data, error } = await clientA.rpc('phone_sync_contacts_for', { p_user: userB.id });
      expect(error).not.toBeNull();               // permission denied for function
      expect(error.message).toMatch(/permission denied|not exist|not find/i);
      expect(data).toBeNull();
    });

    it('a signed-in user cannot call phone_sync_contacts_for even on themselves', async () => {
      const { data: { user: userA } } = await clientA.auth.getUser();
      const { error } = await clientA.rpc('phone_sync_contacts_for', { p_user: userA.id });
      expect(error).not.toBeNull(); // service_role only — no exceptions
    });

    it("a signed-in user cannot read anyone's Google refresh token", async () => {
      const { data: { user: userB } } = await clientB.auth.getUser();
      for (const uid of [userB.id, (await clientA.auth.getUser()).data.user.id]) {
        const { data, error } = await clientA.rpc('phone_sync_read_token', { p_user: uid });
        expect(error).not.toBeNull();
        expect(data).toBeNull();
      }
    });

    it('the user-facing status RPC leaks nothing beyond the safe columns', async () => {
      const { data, error } = await clientA.rpc('get_my_contact_sync');
      expect(error).toBeNull(); // this one IS granted to authenticated
      for (const row of data ?? []) {
        expect(Object.keys(row).sort()).toEqual(
          ['enabled', 'google_email', 'last_error', 'last_stats', 'last_synced_at'],
        );
      }
    });

    it('anon cannot reach any of the sync RPCs', async () => {
      const anon = makeClient();
      for (const fn of ['phone_sync_pending_users', 'get_my_contact_sync']) {
        const { data } = await anon.rpc(fn);
        expect(data ?? []).toEqual([]);
      }
    });
  });
});
