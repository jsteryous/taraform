// Twilio webhook: inbound replies and delivery-status callbacks.
//
// MUST be deployed with --no-verify-jwt: Twilio has no Supabase JWT to present. That makes
// this the one publicly reachable function in the project, so the X-Twilio-Signature check
// below is not optional — without it anyone on the internet could forge a reply into a
// tenant's thread, or forge a STOP and silently opt a contact out.
//
// Deploy:
//   supabase functions deploy sms-inbound --no-verify-jwt --project-ref ykuenmwfxecmmqichwit
//
// Secrets required: TWILIO_AUTH_TOKEN
// Optional: SMS_WEBHOOK_URL — the exact URL configured in the Twilio console. Twilio signs
// the URL it was given, which is not always the URL this container sees behind the
// platform proxy; set it if signature validation fails with a correct token.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';

const twiml = (body = '') =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });

// Twilio's scheme: HMAC-SHA1 over the request URL with the POST params appended in
// alphabetical order as key+value, base64'd.
async function validSignature(url: string, params: Record<string, string>, signature: string) {
  if (!signature || !TWILIO_TOKEN) return false;
  const payload = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(TWILIO_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Constant-time: a length-or-early-exit compare leaks how much of a guess was right.
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  const url = Deno.env.get('SMS_WEBHOOK_URL') ?? req.url;
  const ok = await validSignature(url, params, req.headers.get('X-Twilio-Signature') ?? '');
  if (!ok) {
    console.error('[sms-inbound] signature rejected', { url, sid: params.MessageSid });
    return new Response('Forbidden', { status: 403 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Delivery-status callback: same endpoint, no Body field.
  if (params.MessageStatus && params.Body === undefined) {
    await db.rpc('sms_update_status', {
      p_sid: params.MessageSid ?? params.SmsSid ?? '',
      p_status: params.MessageStatus,
      p_error: params.ErrorCode ?? null,
    });
    return twiml();
  }

  const { data, error } = await db.rpc('sms_record_inbound', {
    p_from: params.From ?? '',
    p_to: params.To ?? '',
    p_body: params.Body ?? '',
    p_sid: params.MessageSid ?? params.SmsSid ?? null,
  });
  if (error) {
    console.error('[sms-inbound] record failed', error.message);
    return new Response('error', { status: 500 });
  }

  // Twilio already auto-replies to STOP with its own confirmation, so sending our own here
  // would double-text someone who just asked us to stop.
  const row = Array.isArray(data) ? data[0] : data;
  // contacts_stopped can exceed 1: shared numbers are common in this data, and every
  // contact holding the number is opted out, not just the matched one.
  console.log('[sms-inbound]', {
    contact: row?.contact_id ?? null,
    opted_out: row?.opted_out ?? false,
    contacts_stopped: row?.contacts_stopped ?? 0,
  });
  return twiml();
});
