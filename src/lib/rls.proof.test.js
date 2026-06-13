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
});
