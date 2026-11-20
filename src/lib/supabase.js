import { createClient } from '@supabase/supabase-js';
import { makeAuthRetryFetch } from './authRetry';

// Refresh-and-retry once when PostgREST says the JWT expired but the browser's clock
// disagreed and never refreshed it — see authRetry.js.
const fetchWithAuthRetry = makeAuthRetryFetch(
  (...args) => fetch(...args),
  async () => {
    const { data, error } = await supabase.auth.refreshSession();
    return error ? null : data.session?.access_token ?? null;
  },
);

// LandID Chrome extension reads localStorage['sb-ykuenmwfxecmmqichwit-auth-token'] to share auth — coordinate before changing Supabase auth storage (storageKey, custom storage, cookie-based, etc.) or bumping supabase-js across token-format changes.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { global: { fetch: fetchWithAuthRetry } },
);
