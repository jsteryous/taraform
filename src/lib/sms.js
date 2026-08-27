// SMS data layer. Reads come straight from PostgREST (RLS scopes them); the send goes
// through the sms-send Edge Function, because the Twilio credential and every compliance
// guard live server-side.
//
// Nothing here decides whether a message may be sent. checkNumber() only *asks*, so the UI
// can explain a block before the user types — the answer that counts is the one
// sms_send_precheck() gives inside the Edge Function at send time.

import { supabase } from './supabase';

// 'listed' | 'clear' | 'unknown' | 'invalid' — see dnc_state() in db/20260827_sms.sql.
export const DNC_LABELS = {
  listed: 'On the DNC registry',
  clear: 'DNC clear',
  unknown: 'Not scrubbed',
  invalid: 'Invalid number',
};

export async function fetchThread(contactId) {
  const { data, error } = await supabase
    .from('sms_messages')
    .select('id,direction,body,status,error_code,peer_number,created_at,segments')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Whether this number can be texted right now, and if not, why. Pinned to auth.uid() in
// SQL — the contact id alone is not authority to text.
export async function checkNumber(contactId, phone) {
  const { data, error } = await supabase.rpc('sms_check_number', {
    p_contact_id: contactId,
    p_phone: phone,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ?? { allowed: false, reason: 'unknown', dnc: 'unknown' };
}

// Area codes that have actually been scrubbed. Used to tell the operator what would unblock
// a contact rather than just refusing.
export async function fetchDncCoverage() {
  const { data, error } = await supabase
    .from('dnc_area_codes')
    .select('area_code,loaded_at,number_count')
    .order('area_code');
  if (error) throw error;
  return data ?? [];
}

// Suppress a number by hand — someone who asks to stop by phone, email or in person is
// opting out just as much as someone who texts STOP. Applies to the NUMBER, so it covers
// every contact holding it (295 numbers in this data sit on more than one contact).
// Irreversible from the app on purpose.
export async function optOutNumber(phone, note = 'manual') {
  const { data, error } = await supabase.rpc('sms_opt_out_number', {
    p_phone: phone,
    p_note: note,
  });
  if (error) throw error;
  return data === true;
}

export async function sendSms({ contactId, phone, body }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session expired — sign in again.');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ contactId, phone, body }),
  });
  const json = await res.json().catch(() => ({}));
  // Carries `reason` on a 422 so the caller can distinguish "fix this and retry" (quiet
  // hours, daily cap) from "this contact is closed forever" (opted out).
  if (!res.ok) throw Object.assign(new Error(json.error || `Send failed (${res.status})`), json);
  return json;
}

// GSM-7 vs UCS-2 segmenting. Advisory only — Twilio's count is authoritative and comes back
// on the send — but a live count stops the operator writing a 4-segment message by accident.
const GSM7 = /^[A-Za-z0-9@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà \r\n]*$/;
const EXTENDED = /[\^{}\\[~\]|€]/g;

export function segmentCount(text) {
  if (!text) return 0;
  if (GSM7.test(text.replace(EXTENDED, ''))) {
    // Extended GSM characters cost two septets each.
    const len = text.length + (text.match(EXTENDED)?.length ?? 0);
    return len <= 160 ? 1 : Math.ceil(len / 153);
  }
  return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
}
