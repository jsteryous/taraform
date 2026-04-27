import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

// Pull OAuth errors out of either the query string or the hash. Google + Supabase
// can use either depending on the flow (PKCE → query, implicit → hash).
function readOAuthError() {
  const sources = [window.location.search, window.location.hash.replace(/^#\/?/, '?')];
  for (const src of sources) {
    if (!src || (!src.includes('error') && !src.includes('error_description'))) continue;
    const params = new URLSearchParams(src.startsWith('?') ? src.slice(1) : src);
    const code = params.get('error') || params.get('error_code');
    const desc = params.get('error_description');
    if (code || desc) return { code, desc: desc ? decodeURIComponent(desc.replace(/\+/g, ' ')) : '' };
  }
  return null;
}

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const oauthErr = readOAuthError();
    if (oauthErr) {
      setError(oauthErr.desc || oauthErr.code || 'Sign-in failed');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    const stashed = sessionStorage.getItem('taraform_auth_error');
    if (stashed) {
      setError(stashed);
      sessionStorage.removeItem('taraform_auth_error');
    }
  }, []);

  async function handleGoogle() {
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://taraform.org' },
    });
    if (error) { setError(error.message); setLoading(false); }
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: '0.25rem' }}>Taraform</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.875rem' }}>CRM & SMS Outreach</p>
        {error && <div style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</div>}
        <button className="google-btn" onClick={handleGoogle} disabled={loading}>
          {loading ? 'Connecting…' : (
            <>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.18L12.05 13.56c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.44 15.983 5.485 18 9.003 18z" fill="#34A853"/>
                <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.426 0 9.003 0 5.485 0 2.44 2.017.96 4.958L3.967 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335"/>
              </svg>
              Sign in with Google
            </>
          )}
        </button>
      </div>
    </div>
  );
}