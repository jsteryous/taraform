// Loads National Do Not Call Registry files into public.dnc_numbers.
//
// This is the script that makes texting possible at all: sms_send_precheck() blocks every
// number whose area code has no coverage row, so until an area code is loaded here nothing
// in it can be sent. That is deliberate — a number's absence from dnc_numbers only means
// "not listed" if we actually hold that area code's file. Otherwise it just means we never
// looked, and treating that as consent to text is the mistake this whole design exists to
// prevent.
//
// Where the files come from:
//   telemarketing.donotcall.gov — register as a seller, then download per-area-code files.
//   Free for up to 5 area codes; 864 alone covers ~72% of the current list.
// A commercial scrub (DNC.com, Contact Center Compliance, Blacklist Alliance) works too —
// export it to one number per line and pass --area-codes for what the export covers.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/load-dnc.mjs downloads/864.txt downloads/803.txt
//   node scripts/load-dnc.mjs --dry-run downloads/864.txt
//   node scripts/load-dnc.mjs export.csv --area-codes 864,803,770
//
// The service role key is required because dnc_numbers is revoked from `authenticated` —
// a tenant must not be able to edit the registry that gates their own sends.

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const acFlag = args.indexOf('--area-codes');
const declaredCodes = acFlag !== -1
  ? (args[acFlag + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
  : null;

const paths = args.filter((a, i) =>
  !a.startsWith('--') && !(acFlag !== -1 && i === acFlag + 1));

if (!paths.length) {
  console.error('usage: node scripts/load-dnc.mjs [--dry-run] [--area-codes 864,803] <file|dir>...');
  process.exit(1);
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!URL || !KEY)) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (omit with --dry-run).');
  process.exit(1);
}

// Registry files are one number per line, but exports vary — pull any 10-digit run and let
// the area-code check below decide what is real.
function numbersIn(text) {
  const out = new Set();
  for (const raw of text.split(/[\r\n]+/)) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) out.add(digits);
    else if (digits.length === 11 && digits[0] === '1') out.add(digits.slice(1));
  }
  return out;
}

function filesUnder(p) {
  if (statSync(p).isDirectory()) {
    return readdirSync(p)
      .filter(f => ['.txt', '.csv', '.dat'].includes(extname(f).toLowerCase()))
      .map(f => join(p, f));
  }
  return [p];
}

const numbers = new Set();
const seenCodes = new Set();

for (const p of paths.flatMap(filesUnder)) {
  const found = numbersIn(readFileSync(p, 'utf8'));
  for (const n of found) {
    numbers.add(n);
    seenCodes.add(n.slice(0, 3));
  }
  // A file named 864.txt asserts coverage of 864 even if it is empty — an area code with
  // nobody registered is still a scrubbed area code.
  const fromName = basename(p, extname(p)).match(/\b([2-9]\d{2})\b/);
  if (fromName) seenCodes.add(fromName[1]);
  console.log(`  ${basename(p)}: ${found.size.toLocaleString()} numbers`);
}

// Coverage is what unblocks sending, so it is never inferred loosely: --area-codes wins,
// otherwise only the codes actually observed in the files count.
const codes = (declaredCodes ?? [...seenCodes]).filter(c => /^[2-9]\d{2}$/.test(c)).sort();

console.log(`\n${numbers.size.toLocaleString()} distinct numbers across ${codes.length} area code(s): ${codes.join(', ')}`);

if (declaredCodes) {
  const unbacked = [...seenCodes].filter(c => !declaredCodes.includes(c));
  if (unbacked.length) {
    console.warn(`\n  WARNING: numbers present for ${unbacked.join(', ')} but not declared in --area-codes.`);
    console.warn('  Those numbers load, but their area codes stay blocked until declared.');
  }
}

if (dryRun) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });

const rows = [...numbers].map(phone => ({ phone }));
const CHUNK = 5000;
for (let i = 0; i < rows.length; i += CHUNK) {
  const slice = rows.slice(i, i + CHUNK);
  const { error } = await db.from('dnc_numbers').upsert(slice, { onConflict: 'phone' });
  if (error) { console.error(`\nfailed at row ${i}: ${error.message}`); process.exit(1); }
  process.stdout.write(`\r  loaded ${Math.min(i + CHUNK, rows.length).toLocaleString()}/${rows.length.toLocaleString()}`);
}
console.log();

// Coverage last: if the number load dies halfway, the area code stays uncovered and the
// precheck keeps blocking. Marking coverage first would open sending against a partial
// registry, which is worse than not loading at all.
const { error: covErr } = await db.from('dnc_area_codes').upsert(
  codes.map(area_code => ({
    area_code,
    loaded_at: new Date().toISOString(),
    source: 'load-dnc.mjs',
    number_count: [...numbers].filter(n => n.startsWith(area_code)).length,
  })),
  { onConflict: 'area_code' },
);
if (covErr) { console.error(`coverage update failed: ${covErr.message}`); process.exit(1); }

console.log(`\nDone. Sending is now unblocked for: ${codes.join(', ')}`);
