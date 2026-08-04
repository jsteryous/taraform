// Google OAuth + People API I/O for the Edge Functions.
//
// All the pure logic (phone selection, name building, the create/update/delete diff) is in
// _shared/phoneSync.js, generated from src/lib/phoneSync.js. This file is only I/O, the
// same split scripts/phone-sync.mjs uses.

import {
  chunk, taraformIdOf, isInGroup,
  PERSON_FIELDS, UPDATE_MASK, GROUP_NAME,
  CREATE_CHUNK, UPDATE_CHUNK, DELETE_CHUNK,
} from './phoneSync.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const PEOPLE_URL = 'https://people.googleapis.com/v1/';
// contactGroups.members:modify caps at 1000 resource names per call.
const MEMBER_CHUNK = 1000;

export const clientId = () => Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
export const clientSecret = () => Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';

export class GoogleError extends Error {
  constructor(message: string, readonly needsReconnect = false) {
    super(message);
  }
}

// Nightly and unattended: a blip shouldn't cost a whole day of sync. Never retries a
// needsReconnect error — that one won't fix itself.
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GoogleError && err.needsReconnect) throw err;
      if (i >= attempts) throw new Error(`${label} failed after ${attempts} attempts: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (i - 1)));
    }
  }
}

// Exchanges the authorization code the browser got from the GIS popup.
//
// No PKCE verifier: GIS's initCodeClient doesn't hand one to the caller, and it isn't what
// secures this flow. This is a *confidential* client — the exchange requires client_secret,
// which lives only in this function's env, so an intercepted code is useless on its own.
// PKCE is the substitute for a secret in public clients; here we have the secret.
//
// redirect_uri is literally the string "postmessage" — that's what Google requires for the
// GIS popup ux_mode, not a URL.
export async function exchangeCode(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: 'postmessage',
      grant_type: 'authorization_code',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(`Code exchange failed: ${json.error ?? res.status}`);
  if (!json.refresh_token) {
    // Google withholds the refresh token when the user has already granted the scope and
    // the request didn't force a fresh consent. The connect flow sends prompt=consent to
    // prevent exactly this; if it still happens, retrying without it will loop forever.
    throw new GoogleError(
      'Google returned no refresh token. Revoke Taraform at myaccount.google.com/permissions and connect again.',
    );
  }
  return json as { refresh_token: string; access_token: string };
}

export async function accessTokenFrom(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // invalid_grant means revoked or expired — no amount of retrying helps, the user has
    // to reconnect. Surfaced in the UI as last_error.
    throw new GoogleError(
      json.error === 'invalid_grant'
        ? 'Google access was revoked or expired. Reconnect Google Contacts in Settings.'
        : `Token refresh failed: ${json.error ?? res.status}`,
      json.error === 'invalid_grant',
    );
  }
  return json.access_token;
}

export async function revoke(refreshToken: string) {
  // Best-effort: a token Google already forgot still 400s, and that's a success for us.
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
  }).catch(() => {});
}

export async function userInfo(accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return '';
  return (await res.json().catch(() => ({})))?.email ?? '';
}

export type PeopleApi = (path: string, init?: RequestInit) => Promise<any>;

export function peopleApi(token: string): PeopleApi {
  return async (path, init = {}) => {
    const res = await fetch(`${PEOPLE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok) {
      // A People API error body can quote the field values that caused it — i.e. client
      // names and phone numbers. Function logs are not public like the Actions logs were,
      // but this is other people's PII now, so keep it to the status.
      let status = '';
      try { status = JSON.parse(text || '{}')?.error?.status ?? ''; } catch { /* not JSON */ }
      throw new GoogleError(`${res.status} ${status || '(detail withheld)'}`, res.status === 401);
    }
    return text ? JSON.parse(text) : {};
  };
}

export async function listContacts(api: PeopleApi) {
  const people: any[] = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ personFields: PERSON_FIELDS, pageSize: '1000' });
    if (pageToken) qs.set('pageToken', pageToken);
    const json = await withRetry('connections.list', () => api(`people/me/connections?${qs}`));
    people.push(...(json.connections ?? []));
    pageToken = json.nextPageToken ?? '';
  } while (pageToken);
  return people;
}

// Never fatal: a missing label must not abort the sync, since caller ID is the point and
// the label is only tidiness.
export async function resolveGroup(api: PeopleApi): Promise<string | null> {
  try {
    const json = await withRetry('contactGroups.list', () => api('contactGroups?pageSize=200'));
    const found = (json.contactGroups ?? []).find((g: any) => g.name === GROUP_NAME);
    if (found) return found.resourceName;
    const created = await withRetry('contactGroups.create', () => api('contactGroups', {
      method: 'POST',
      body: JSON.stringify({ contactGroup: { name: GROUP_NAME } }),
    }));
    return created.resourceName ?? null;
  } catch {
    return null;
  }
}

export async function applyPlan(
  api: PeopleApi,
  plan: { toCreate: any[]; toUpdate: any[]; toDelete: string[] },
  memberships: any[],
  groupResourceName: string | null,
  existing: any[],
) {
  for (const batch of chunk(plan.toCreate, CREATE_CHUNK)) {
    await withRetry('batchCreateContacts', () => api('people:batchCreateContacts', {
      method: 'POST',
      body: JSON.stringify({
        contacts: batch.map((person: any) => ({ contactPerson: { ...person, memberships } })),
        readMask: 'names',
      }),
    }));
  }

  for (const batch of chunk(plan.toUpdate, UPDATE_CHUNK)) {
    // batchUpdate keys by resourceName and requires the etag Google handed us back.
    const contacts = Object.fromEntries(
      batch.map((u: any) => [u.resourceName, { ...u.person, etag: u.etag }]),
    );
    await withRetry('batchUpdateContacts', () => api('people:batchUpdateContacts', {
      method: 'POST',
      body: JSON.stringify({ contacts, updateMask: UPDATE_MASK, readMask: 'names' }),
    }));
  }

  for (const batch of chunk(plan.toDelete, DELETE_CHUNK)) {
    await withRetry('batchDeleteContacts', () => api('people:batchDeleteContacts', {
      method: 'POST',
      body: JSON.stringify({ resourceNames: batch }),
    }));
  }

  // Back-fill the label onto contacts created before it existed. Adding an existing member
  // is a no-op, so this is idempotent and quietly self-heals.
  if (groupResourceName) {
    const missing = existing
      .filter((p: any) => taraformIdOf(p) && !isInGroup(p, groupResourceName))
      .map((p: any) => p.resourceName)
      .filter((rn: string) => !plan.toDelete.includes(rn));
    for (const batch of chunk(missing, MEMBER_CHUNK)) {
      await withRetry('members.modify', () => api(`${groupResourceName}/members:modify`, {
        method: 'POST',
        body: JSON.stringify({ resourceNamesToAdd: batch }),
      }));
    }
  }
}
