// Shared HTTP bits for the phone-sync functions.
//
// The app is served from GitHub Pages at taraform.org, so the browser-facing function
// needs CORS. ALLOWED_ORIGINS is an explicit allowlist rather than "*" because these
// endpoints act on a signed-in user's behalf.

const DEFAULT_ORIGINS = ['https://taraform.org', 'http://localhost:5173'];

const allowed = () => (Deno.env.get('ALLOWED_ORIGINS') ?? DEFAULT_ORIGINS.join(','))
  .split(',').map((s) => s.trim()).filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const list = allowed();
  return {
    'Access-Control-Allow-Origin': list.includes(origin) ? origin : list[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

export const preflight = (req: Request) => new Response('ok', { headers: corsHeaders(req) });
