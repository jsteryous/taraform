import { createClient } from '@supabase/supabase-js';

// LandID Chrome extension reads localStorage['sb-ykuenmwfxecmmqichwit-auth-token'] to share auth — coordinate before changing Supabase auth storage (storageKey, custom storage, cookie-based, etc.) or bumping supabase-js across token-format changes.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);