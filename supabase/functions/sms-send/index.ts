// Browser-facing send. The user presses send in the CRM; this is the only path to Twilio.
//
// The Twilio auth token must never reach the bundle, which is the immediate reason this is
// a function at all. The larger reason is that every compliance guard lives in
// sms_send_precheck() — a check in React would be decoration, because the anon key is
// public and anyone can call PostgREST directly.
//
// This function runs as service_role and BYPASSES RLS. So it never takes a client_id or a
// user id from the body: the user comes from the JWT, and the precheck does the membership
// join itself. Same precedent as phone-sync-run.
//
// Secrets required (supabase secrets set ...):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
// Provided by the platform: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_SID = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

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

  if (!TWILIO_SID || !TWILIO_TOKEN) {
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
    .from('clients').select('twilio_number').eq('id', check.client_id).single();
  const from = client?.twilio_number;
  if (!from) return json(req, { error: 'No sending number is configured for this list.' }, 503);

  const text = await withDisclosure(db, check.client_id, check.to_number, String(body).trim());

  // Twilio's REST API. E.164 — precheck already proved these are 10 US digits.
  const form = new URLSearchParams({
    To: `+1${check.to_number}`,
    From: `+1${from.replace(/\D/g, '').slice(-10)}`,
    Body: text,
  });
  const statusCb = Deno.env.get('SMS_STATUS_CALLBACK');
  if (statusCb) form.set('StatusCallback', statusCb);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    },
  );
  const tw = await res.json().catch(() => ({}));

  // Log the failure too — a message Twilio rejected is exactly the one worth seeing, and a
  // silent failure here is indistinguishable from never having pressed send.
  const { data: id, error: recErr } = await db.rpc('sms_record_outbound', {
    p_user: user.id,
    p_contact_id: contactId,
    p_phone: check.to_number,
    p_from: from,
    p_body: text,
    p_sid: tw?.sid ?? null,
    p_status: res.ok ? (tw?.status ?? 'queued') : 'failed',
    p_segments: tw?.num_segments ? Number(tw.num_segments) : null,
    p_error: res.ok ? null : String(tw?.code ?? res.status),
  });
  if (recErr) return json(req, { error: recErr.message }, 500);

  if (!res.ok) {
    return json(req, { error: tw?.message ?? `Twilio rejected the message (${res.status})`, code: tw?.code }, 502);
  }
  return json(req, { ok: true, id, sid: tw?.sid, status: tw?.status, body: text });
});
