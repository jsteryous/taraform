// Browser-facing half of the Google Contacts connect flow.
//
// The browser does the PKCE *authorization* step only (GIS popup -> auth code). It cannot
// complete the exchange, because Google requires client_secret for a Web application
// client and that must never ship in a public bundle. So the code comes here, and the
// refresh token that comes back goes straight into Vault via phone_sync_store_token() —
// it is never returned to the caller.
//
// Actions: connect | disconnect | sync-now
//
// Secrets required (supabase secrets set ...):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// Provided by the platform: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exchangeCode, accessTokenFrom, revoke, userInfo, GoogleError } from '../_shared/google.ts';
import { json, preflight } from '../_shared/http.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// The caller's JWT decides whose connection this is — never a user id from the body.
// Taking a user id from the request would let any signed-in user connect, disconnect, or
// sync on behalf of anyone else.
async function requireUser(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const client = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, { error: 'POST only' }, 405);

  const user = await requireUser(req);
  if (!user) return json(req, { error: 'Not authenticated' }, 401);

  const body = await req.json().catch(() => ({}));
  const action = body?.action ?? 'connect';
  const db = admin();

  try {
    if (action === 'connect') {
      const { code } = body;
      if (!code) return json(req, { error: 'code is required' }, 400);

      const tokens = await exchangeCode(code);
      const email = await userInfo(tokens.access_token);

      const { error } = await db.rpc('phone_sync_store_token', {
        p_user: user.id,
        p_email: email || user.email || '',
        p_refresh_token: tokens.refresh_token,
      });
      if (error) throw new Error(error.message);

      return json(req, { ok: true, google_email: email });
    }

    if (action === 'disconnect') {
      // Revoke at Google BEFORE dropping our copy — deleting ours alone would leave a
      // live grant dangling on the user's Google account with nothing to show for it.
      const { data: token } = await db.rpc('phone_sync_read_token', { p_user: user.id });
      if (token) await revoke(token);
      const { error } = await db.rpc('phone_sync_forget', { p_user: user.id });
      if (error) throw new Error(error.message);
      return json(req, { ok: true });
    }

    if (action === 'sync-now') {
      // Lets a new user see contacts land on their phone immediately instead of waiting
      // for the nightly run. Same code path as the cron, just invoked by hand.
      const res = await fetch(`${SUPABASE_URL}/functions/v1/phone-sync-run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      });
      const result = await res.json().catch(() => ({}));
      return json(req, result, res.ok ? 200 : 502);
    }

    if (action === 'status') {
      // Cheap probe so the UI can tell "never connected" from "connected but failing"
      // without a second round-trip after an action.
      const { data } = await db.rpc('phone_sync_read_token', { p_user: user.id });
      if (!data) return json(req, { connected: false });
      await accessTokenFrom(data);
      return json(req, { connected: true, healthy: true });
    }

    return json(req, { error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const message = (err as Error).message ?? 'Unexpected error';
    console.error(`${action} failed for user ${user.id}: ${message}`);
    return json(req, {
      error: message,
      needsReconnect: err instanceof GoogleError && err.needsReconnect,
    }, 400);
  }
});
