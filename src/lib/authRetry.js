// Recovers from "JWT expired" (PostgREST PGRST303) by refreshing the session once and
// retrying the request.
//
// Why this exists: supabase-js decides whether to refresh by comparing the stored
// `expires_at` with the *browser's* clock. If that clock jumps (an OS time resync, a
// machine waking from sleep with drift), the client can believe an expired token is still
// valid and keep sending it without ever asking for a new one — every query then 401s
// until the user signs out. Seen 2026-11-20: clients failed to load for ~30 minutes with
// no /auth/v1/token request reaching Supabase at all. The server is the authority on
// expiry, so when it says expired we refresh regardless of what the local clock thinks.
//
// Only PostgREST (/rest/v1/) responses are inspected. The auth client shares this fetch,
// and its own /token calls must never be intercepted (that would recurse).

const isRest = (input) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  return url.includes('/rest/v1/');
};

async function isJwtExpired(res) {
  if (res.status !== 401) return false;
  try {
    const body = await res.clone().json();
    return body?.code === 'PGRST303';
  } catch {
    return false;
  }
}

/**
 * @param {typeof fetch} baseFetch
 * @param {() => Promise<string|null>} refresh resolves to a fresh access token, or null
 */
export function makeAuthRetryFetch(baseFetch, refresh) {
  // One refresh shared by every request that failed in the same burst: the app fires
  // several queries in parallel, and each refresh rotates the refresh token.
  let inflight = null;
  const refreshOnce = () => {
    inflight ??= Promise.resolve()
      .then(refresh)
      .catch(() => null)
      .finally(() => { setTimeout(() => { inflight = null; }, 0); });
    return inflight;
  };

  return async (input, init = {}) => {
    const res = await baseFetch(input, init);
    if (!isRest(input) || !(await isJwtExpired(res))) return res;

    const token = await refreshOnce();
    if (!token) return res;

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return baseFetch(input, { ...init, headers });
  };
}
