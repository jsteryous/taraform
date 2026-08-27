// Browser-facing send. The user presses send in the CRM; this is the only path to Telnyx.
//
// The API key must never reach the bundle, which is the immediate reason this is a function
// at all. The larger reason is that every compliance guard lives in sms_send_precheck() —
// a check in React would be decoration, because the anon key is public and anyone can call
// PostgREST directly.
//
// This function runs as service_role and BYPASSES RLS. So it never takes a client_id or a
// user id from the body: the user comes from the JWT, and the precheck does the membership
// join itself. Same precedent as phone-sync-run.
//
// Provider: Telnyx (chosen over Twilio 2026-08-27 — see scripts/SMS.md). The provider
// surface is deliberately confined to the one fetch below; everything that decides whether
// a message MAY be sent is in SQL and is provider-agnostic.
//
// Secrets required (supabase secrets set ...):
//   TELNYX_API_KEY            v2 API key ("KEY..."), NOT the public key
//   TELNYX_MESSAGING_PROFILE_ID  optional; Telnyx infers it from `from` when the number is
//                                already attached to a profile
// Provided by the platform: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY') ?? '';
const PROFILE_ID = Deno.env.get('TELNYX_MESSAGING_PROFILE_ID') ?? '';

const admin = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// What the UI shows for each precheck failure. Kept here rather than in React so a new
// reason added in SQL surfaces as itself instead of a blank error.
const REASONS: Record<string, string> = {
  not_authorized: 'That contact is not in one of your lists.',
  invalid_number: 'That number is not a valid US phone number.',
  phone_not_on_contact: 'That number is not on this contact.',
  bad_phone: 'That number is marked bad on this contact.',
  opted_out: 'This contact has opted out. That is permanent.',
  dnc_listed: 'This number is on the National Do Not Call Registry.',
  dnc_unscrubbed: "This area code has not been DNC-scrubbed yet, so it can't be texted. Load it with scripts/load-dnc.mjs.",
  quiet_hours: "It is outside 8am-9pm in the recipient's local time.",
  daily_cap: 'You have hit the daily send cap for this list.',
};

// The caller's JWT decides who is sending — never a user id from the body.
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

// 47 CFR 64.1200(d)(4) wants the sender identified, and 10DLC campaigns are expected to
// carry opt-out language. Both belong on the FIRST message to a number — appending them to
// every message reads as a broadcast and is what carriers filter on.
async function withDisclosure(db: ReturnType<typeof admin>, clientId: string, peer: string, body: string) {
  const { count } = await db
    .from('sms_messages')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('peer_number', peer)
    .eq('direction', 'outbound');
  if ((count ?? 0) > 0) return body;
  return `${body}\n\nReply STOP to opt out.`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, { error: 'POST only' }, 405);

  if (!TELNYX_API_KEY) {
    return json(req, { error: 'Texting is not configured for this deployment.' }, 503);
  }

  const user = await requireUser(req);
  if (!user) return json(req, { error: 'Not authenticated' }, 401);

  const { contactId, phone, body } = await req.json().catch(() => ({}));
  if (!contactId || !phone || !String(body ?? '').trim()) {
    return json(req, { error: 'contactId, phone and body are required' }, 400);
  }

  const db = admin();

  // THE gate. Everything below assumes this said yes.
  const { data: checks, error: checkErr } = await db.rpc('sms_send_precheck', {
    p_user: user.id, p_contact_id: contactId, p_phone: phone,
  });
  if (checkErr) return json(req, { error: checkErr.message }, 500);

  const check = Array.isArray(checks) ? checks[0] : checks;
  if (!check?.allowed) {
    const reason = check?.reason ?? 'unknown';
    return json(req, { error: REASONS[reason] ?? `Blocked: ${reason}`, reason, dnc: check?.dnc }, 422);
  }

  const { data: client } = await db
    .from('clients').select('sms_number').eq('id', check.client_id).single();
  const from = client?.sms_number;
  if (!from) return json(req, { error: 'No sending number is configured for this list.' }, 503);

  const text = await withDisclosure(db, check.client_id, check.to_number, String(body).trim());

  // Telnyx Messaging API v2. JSON + bearer auth, unlike Twilio's form-encoded basic auth.
  // E.164 — the precheck already proved these are 10 US digits.
  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `+1${from.replace(/\D/g, '').slice(-10)}`,
      to: `+1${check.to_number}`,
      text,
      ...(PROFILE_ID ? { messaging_profile_id: PROFILE_ID } : {}),
    }),
  });
  const tx = await res.json().catch(() => ({}));

  // Telnyx nests everything under data, reports status per-recipient in a `to` ARRAY, and
  // calls the segment count `parts`. Errors come back as an `errors` array, not a message.
  const sent = tx?.data;
  const err = tx?.errors?.[0];

  // Log the failure too — a message the provider rejected is exactly the one worth seeing,
  // and a silent failure here is indistinguishable from never having pressed send.
  const { data: id, error: recErr } = await db.rpc('sms_record_outbound', {
    p_user: user.id,
    p_contact_id: contactId,
    p_phone: check.to_number,
    p_from: from,
    p_body: text,
    p_sid: sent?.id ?? null,
    p_status: res.ok ? (sent?.to?.[0]?.status ?? 'queued') : 'failed',
    p_segments: sent?.parts ? Number(sent.parts) : null,
    p_error: res.ok ? null : String(err?.code ?? res.status),
  });
  if (recErr) return json(req, { error: recErr.message }, 500);

  if (!res.ok) {
    return json(req, {
      error: err?.detail ?? err?.title ?? `Telnyx rejected the message (${res.status})`,
      code: err?.code,
    }, 502);
  }
  return json(req, { ok: true, id, sid: sent?.id, status: sent?.to?.[0]?.status, body: text });
});
