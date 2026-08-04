// Browser half of "Connect Google Contacts".
//
// The browser only ever obtains an authorization CODE. It never sees a refresh token and
// never holds the Google client secret — the code goes to the google-contacts-connect Edge
// Function, which completes the exchange and files the refresh token in Supabase Vault.
//
// Full design: scripts/PHONE_SYNC_MULTIUSER.md

import { supabase } from './supabase';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/contacts';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export const isConfigured = () => Boolean(CLIENT_ID);

let gisPromise = null;

function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve(window.google.accounts.oauth2);
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve(window.google.accounts.oauth2);
      else reject(new Error('Google sign-in script loaded but did not initialize'));
    };
    // Usually an ad/tracker blocker. Worth naming, because the generic "failed" message
    // sends people hunting through their Google account settings instead.
    script.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in. A tracker blocker may be blocking accounts.google.com.'));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

// Calls the Edge Function with the user's Supabase JWT. The function derives the user from
// that token — the user id is never sent in the body, so this can only ever act on the
// caller's own connection.
async function callConnectFn(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session expired — sign in again.');

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-contacts-connect`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(payload),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Request failed (${res.status})`), json);
  return json;
}

// Opens Google's consent popup and hands the resulting code to the Edge Function.
// Resolves with { google_email }.
export async function connectGoogleContacts() {
  if (!isConfigured()) {
    throw new Error('Google Contacts sync is not configured for this deployment (VITE_GOOGLE_CLIENT_ID).');
  }
  const oauth2 = await loadGis();

  const code = await new Promise((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      ux_mode: 'popup',
      // Both are required to get a refresh token back. access_type=offline asks for one;
      // prompt=consent forces a fresh grant — without it, a user who already approved the
      // scope gets an access token and NO refresh token, and the nightly job would have
      // nothing to use. That failure is silent at connect time, so don't remove either.
      access_type: 'offline',
      prompt: 'consent',
      callback: (res) => {
        if (res.error) reject(new Error(res.error_description || res.error));
        else if (!res.code) reject(new Error('Google did not return an authorization code'));
        else resolve(res.code);
      },
      error_callback: (err) => reject(
        new Error(err?.type === 'popup_closed' ? 'Connection cancelled.' : (err?.message || 'Google sign-in failed')),
      ),
    });
    client.requestCode();
  });

  return callConnectFn({ action: 'connect', code });
}

export const disconnectGoogleContacts = () => callConnectFn({ action: 'disconnect' });
export const syncContactsNow = () => callConnectFn({ action: 'sync-now' });

// Safe status fields only — the RPC deliberately cannot return the vault secret id.
export async function getContactSyncStatus() {
  const { data, error } = await supabase.rpc('get_my_contact_sync');
  if (error) throw error;
  return data?.[0] || null;
}

export async function setContactSyncEnabled(enabled) {
  const { error } = await supabase.rpc('set_my_contact_sync_enabled', { p_enabled: enabled });
  if (error) throw error;
}
