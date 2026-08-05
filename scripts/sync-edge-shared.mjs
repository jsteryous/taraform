// Copies the pure sync logic into supabase/functions/_shared/ so the Edge Functions can
// import it.
//
// No `#!` line: src/lib/edgeShared.test.js imports this module, and vite's parser rejects a
// shebang in an imported file — which made the whole suite fail to collect rather than run
// the drift check. It's invoked as `node scripts/sync-edge-shared.mjs`, so nothing needs it.
//
// Why a copy instead of importing ../../../src/lib directly: the Supabase CLI bundles a
// function from its own directory, and reaching outside supabase/functions is not a
// contract worth betting a nightly job on. A copy is deterministic — and drift is
// impossible to miss, because src/lib/edgeShared.test.js fails the moment the copy and
// the source disagree.
//
//   npm run sync:edge      regenerate (run after touching phoneSync.js / utils.js)
//   npm test               fails if you forgot

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SHARED_DIR = join(ROOT, 'supabase', 'functions', '_shared');
export const SHARED_FILES = ['phoneSync.js', 'utils.js'];

export const HEADER = `// GENERATED FILE — DO NOT EDIT.
// Copied from src/lib/ by scripts/sync-edge-shared.mjs. Edit the original and run
// \`npm run sync:edge\`. src/lib/edgeShared.test.js fails if these drift apart.
`;

export const sourcePath = (name) => join(ROOT, 'src', 'lib', name);
export const sharedPath = (name) => join(SHARED_DIR, name);
export const expectedContent = (name) => HEADER + readFileSync(sourcePath(name), 'utf8');

// Line endings are a checkout artifact, never real drift, and comparing them raw made this
// check unfixably red on Windows: git's autocrlf hands us CRLF working files, but a template
// literal normalizes CRLF to LF per spec, so HEADER above is LF while the file it generated
// is CRLF. Identical content, permanent failure. Compare what actually matters.
const sameContent = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

export function isInSync(name) {
  const dest = sharedPath(name);
  return existsSync(dest) && sameContent(readFileSync(dest, 'utf8'), expectedContent(name));
}

function main() {
  mkdirSync(SHARED_DIR, { recursive: true });
  for (const name of SHARED_FILES) {
    writeFileSync(sharedPath(name), expectedContent(name));
    console.log(`  wrote supabase/functions/_shared/${name}`);
  }
  console.log('✓ Edge Function shared code is up to date.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
