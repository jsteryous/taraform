#!/usr/bin/env node
// One-time helper: mint the Google refresh token that scripts/phone-sync.mjs runs on.
// You run this once, on your own machine, then paste the result into a GitHub secret.
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/phone-sync-authorize.mjs
//
// It opens a browser, catches the redirect on localhost, and prints the refresh token.
// Full walkthrough: scripts/PHONE_SYNC.md

import http from 'node:http';
import { execFile } from 'node:child_process';

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/contacts';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('✗ Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (see scripts/PHONE_SYNC.md).');
  process.exit(1);
}

// access_type=offline + prompt=consent is what actually returns a refresh_token. Without
// prompt=consent Google omits it on re-authorization, which looks like a silent failure.
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.end(`Authorization failed: ${error}. You can close this tab.`);
    console.error(`✗ Google returned: ${error}`);
    server.close();
    process.exit(1);
  }
  if (!code) { res.end('Waiting for the authorization code…'); return; }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }),
  });
  const json = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok || !json.refresh_token) {
    res.end('Token exchange failed — check the terminal. You can close this tab.');
    console.error(`✗ Token exchange failed: ${JSON.stringify(json, null, 2)}`);
    console.error('  If refresh_token is missing, revoke the app at myaccount.google.com/permissions and re-run.');
    server.close();
    process.exit(1);
  }

  res.end('Done — Taraform can now sync your contacts. You can close this tab.');
  console.log('\n✓ Add this to your GitHub repo secrets as GOOGLE_REFRESH_TOKEN:\n');
  console.log(`  ${json.refresh_token}\n`);
  console.log('Reminder: if the OAuth consent screen is still in "Testing", this token stops');
  console.log('working in 7 days. Publish the app to "In production" (unverified is fine).\n');
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`Listening on ${REDIRECT}`);
  console.log('Opening your browser. Sign in as the Google account that will hold the contacts.\n');
  console.log(`If nothing opens, paste this into a browser:\n\n${authUrl}\n`);
  // execFile with an argument array, never exec with an interpolated string: no shell is
  // involved, so the & separating the URL's query params can't be read as a command
  // separator. On Windows that rules out `cmd /c start`, hence rundll32.
  const [cmd, args] = process.platform === 'win32'
    ? ['rundll32', ['url.dll,FileProtocolHandler', authUrl]]
    : process.platform === 'darwin'
      ? ['open', [authUrl]]
      : ['xdg-open', [authUrl]];
  execFile(cmd, args, () => {}); // failure is fine — the URL is printed above
});
