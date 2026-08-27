// Telnyx webhook: inbound replies and delivery-status events.
//
// MUST be deployed with --no-verify-jwt: Telnyx has no Supabase JWT to present. That makes
// this the one publicly reachable function in the project, so the signature check below is
// not optional — without it anyone on the internet could forge a reply into a tenant's
// thread, or forge a STOP and silently opt a contact out.
//
// Deploy:
//   supabase functions deploy sms-inbound --no-verify-jwt --project-ref ykuenmwfxecmmqichwit
//
// Secrets required:
//   TELNYX_PUBLIC_KEY — base64 Ed25519 public key from Portal → Account → Keys & Credentials
//                       → Public Key. This is NOT the API key.
//
// Telnyx signs with Ed25519 over `${timestamp}|${rawBody}`, where Twilio used HMAC-SHA1
// over a URL plus sorted params. The upside is that nothing depends on the URL the platform
// proxy presents, so there is no SMS_WEBHOOK_URL equivalent to get wrong.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_KEY = Deno.env.get('TELNYX_PUBLIC_KEY') ?? '';

// Telnyx retries on non-2xx, so a signature failure returns 403 (don't retry a forgery)
// while a database failure returns 500 (do retry — we want that message).
const ok = () => new Response(null, { status: 200 });

const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function validSignature(raw: string, sig: string, ts: string) {
  if (!PUBLIC_KEY || !sig || !ts) return false;

  // Replay guard: the signature stays valid forever otherwise, so a captured request could
  // be replayed to re-open a thread or re-log a message.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw', b64(PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'Ed25519' }, key, b64(sig),
      new TextEncoder().encode(`${ts}|${raw}`),
    );
  } catch (e) {
    console.error('[sms-inbound] signature check threw', String(e));
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });

  // Must read the RAW body: re-serializing the parsed JSON changes the bytes and the
  // signature will never match.
  const raw = await req.text();
  const valid = await validSignature(
    raw,
    req.headers.get('telnyx-signature-ed25519') ?? '',
    req.headers.get('telnyx-timestamp') ?? '',
  );
  if (!valid) {
    console.error('[sms-inbound] signature rejected');
    return new Response('Forbidden', { status: 403 });
  }

  const event = JSON.parse(raw || '{}')?.data;
  const type = event?.event_type ?? '';
  const p = event?.payload ?? {};
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Delivery-status events for messages we sent.
  if (type === 'message.sent' || type === 'message.finalized') {
    await db.rpc('sms_update_status', {
      p_sid: p?.id ?? '',
      p_status: p?.to?.[0]?.status ?? type.replace('message.', ''),
      p_error: p?.errors?.[0]?.code ?? null,
    });
    return ok();
  }

  if (type !== 'message.received') return ok();

  const { data, error } = await db.rpc('sms_record_inbound', {
    p_from: p?.from?.phone_number ?? '',
    // `to` is an array on Telnyx even for a single recipient.
    p_to: p?.to?.[0]?.phone_number ?? '',
    p_body: p?.text ?? '',
    p_sid: p?.id ?? null,
  });
  if (error) {
    console.error('[sms-inbound] record failed', error.message);
    return new Response('error', { status: 500 });
  }

  // Telnyx does NOT auto-reply to STOP the way Twilio does — carrier-level opt-out still
  // applies, but there is no automatic confirmation message. We deliberately send nothing:
  // an extra text to someone who just asked us to stop is the wrong instinct, and the
  // suppression is already recorded by the time we get here.
  const row = Array.isArray(data) ? data[0] : data;
  // contacts_stopped can exceed 1: shared numbers are common in this data, and every
  // contact holding the number is opted out, not just the matched one.
  console.log('[sms-inbound]', {
    contact: row?.contact_id ?? null,
    opted_out: row?.opted_out ?? false,
    contacts_stopped: row?.contacts_stopped ?? 0,
  });
  return ok();
});
