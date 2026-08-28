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
//   TELNYX_API_KEY    — needed only for the HELP auto-reply below. CTIA Messaging
//                       Principles require HELP to be answered on a 10DLC campaign and
//                       Telnyx, unlike Twilio, sends nothing automatically.
//
// Telnyx signs with Ed25519 over `${timestamp}|${rawBody}`, where Twilio used HMAC-SHA1
// over a URL plus sorted params. The upside is that nothing depends on the URL the platform
// proxy presents, so there is no SMS_WEBHOOK_URL equivalent to get wrong.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PUBLIC_KEY = Deno.env.get('TELNYX_PUBLIC_KEY') ?? '';
const TELNYX_API_KEY = Deno.env.get('TELNYX_API_KEY') ?? '';

// Telnyx retries on non-2xx, so a signature failure returns 403 (don't retry a forgery)
// while a database failure returns 500 (do retry — we want that message).
const ok = () => new Response(null, { status: 200 });

const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function validSignature(raw: string, sig: string, ts: string) {
  if (!PUBLIC_KEY || !sig || !ts) return false;

  // Replay guard, deliberately loose. This was 5 minutes and that was wrong: Telnyx retries
  // a failed webhook over a long window and re-sends the ORIGINAL signature and timestamp,
  // so a tight tolerance rejects legitimate retries. The failure mode is losing an inbound
  // STOP because our own database blipped when it first arrived — the exact message that
  // must never be dropped.
  //
  // Widening is safe because replay is already a no-op here, and that — not the clock — is
  // the real protection: sms_record_inbound inserts ON CONFLICT (provider_sid) DO NOTHING,
  // and re-applying an opt-out is idempotent and in the safe direction anyway. A replayed
  // event can at worst re-stamp updated_at. The window only bounds unbounded replay.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 86_400) return false;

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

  // HELP. Whether to answer at all was decided in SQL (sms_record_inbound), which checks
  // that this is a HELP, that the number has not opted out, and that we have not already
  // auto-replied in the last 24h — the loop guard that matters when the peer is itself an
  // autoresponder. This function only carries out the decision.
  //
  // A failure here is logged and swallowed: the inbound message is already recorded and an
  // unanswered HELP must never cause a 500, which would make Telnyx retry the whole event
  // and re-run the opt-out path.
  if (row?.help_reply && row?.reply_from && TELNYX_API_KEY) {
    try {
      const sent = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `+1${row.reply_from}`,
          to: `+1${(p?.from?.phone_number ?? '').replace(/\D/g, '').slice(-10)}`,
          text: row.help_reply,
        }),
      });
      const body = await sent.json().catch(() => ({}));
      if (!sent.ok) {
        console.error('[sms-inbound] help reply failed', sent.status, JSON.stringify(body));
      } else {
        await db.rpc('sms_record_help_reply', {
          p_peer: p?.from?.phone_number ?? '',
          p_from: row.reply_from,
          p_body: row.help_reply,
          p_sid: body?.data?.id ?? null,
        });
      }
    } catch (e) {
      console.error('[sms-inbound] help reply threw', String(e));
    }
  }

  // contacts_stopped can exceed 1: shared numbers are common in this data, and every
  // contact holding the number is opted out, not just the matched one.
  console.log('[sms-inbound]', {
    contact: row?.contact_id ?? null,
    opted_out: row?.opted_out ?? false,
    contacts_stopped: row?.contacts_stopped ?? 0,
    helped: !!row?.help_reply,
  });
  return ok();
});
