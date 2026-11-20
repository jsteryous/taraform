import { describe, it, expect, vi } from 'vitest';
import { makeAuthRetryFetch } from './authRetry';

const REST = 'https://x.supabase.co/rest/v1/clients?select=*';
const expired = () => new Response(JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }), { status: 401 });
const ok = () => new Response('[]', { status: 200 });

describe('makeAuthRetryFetch', () => {
  it('refreshes and retries once with the new token on PGRST303', async () => {
    const base = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok());
    const refresh = vi.fn().mockResolvedValue('fresh');
    const f = makeAuthRetryFetch(base, refresh);

    const res = await f(REST, { headers: new Headers({ Authorization: 'Bearer stale', apikey: 'k' }) });

    expect(res.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(1);
    const retried = base.mock.calls[1][1].headers;
    expect(retried.get('Authorization')).toBe('Bearer fresh');
    expect(retried.get('apikey')).toBe('k');
  });

  it('leaves other 401s alone (RLS / permission errors are not expiry)', async () => {
    const res401 = new Response(JSON.stringify({ code: '42501' }), { status: 401 });
    const base = vi.fn().mockResolvedValue(res401);
    const refresh = vi.fn();
    const res = await makeAuthRetryFetch(base, refresh)(REST, {});
    expect(res.status).toBe(401);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('never intercepts auth endpoints (would recurse into refresh)', async () => {
    const base = vi.fn().mockResolvedValue(expired());
    const refresh = vi.fn();
    await makeAuthRetryFetch(base, refresh)('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', {});
    expect(refresh).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('returns the original 401 when the refresh fails', async () => {
    const base = vi.fn().mockResolvedValue(expired());
    const res = await makeAuthRetryFetch(base, vi.fn().mockRejectedValue(new Error('net')))(REST, {});
    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh across a burst of parallel failures', async () => {
    const base = vi.fn((_, init) =>
      Promise.resolve(new Headers(init?.headers).get('Authorization') === 'Bearer fresh' ? ok() : expired()));
    let resolve;
    const refresh = vi.fn(() => new Promise(r => { resolve = r; }));
    const f = makeAuthRetryFetch(base, refresh);

    const all = Promise.all([f(REST, {}), f(REST, {}), f(REST, {})]);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    resolve('fresh');
    const results = await all;

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results.every(r => r.status === 200)).toBe(true);
  });
});
