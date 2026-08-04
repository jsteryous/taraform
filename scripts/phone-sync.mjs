#!/usr/bin/env node
// Nightly one-way sync: Taraform contacts -> Google Contacts -> your phone's caller ID.
//
// Runs on GitHub Actions (.github/workflows/sync-contacts.yml), so there is still no
// always-on server and hosting stays at $0. Setup lives in scripts/PHONE_SYNC.md.
//
// All the pure logic (phone selection, name building, the create/update/delete diff) is in
// src/lib/phoneSync.js and unit-tested; this file is only I/O.
//
// Auth to Supabase is a normal user sign-in so RLS still applies — CI never holds a
// service_role key that could bypass tenancy.
//
// Usage:  node scripts/phone-sync.mjs [--dry-run]

import { createClient } from '@supabase/supabase-js';
import {
  buildPerson, dedupeByPhone, diffContacts, chunk,
  PERSON_FIELDS, UPDATE_MASK, CREATE_CHUNK, UPDATE_CHUNK, DELETE_CHUNK,
} from '../src/lib/phoneSync.js';

const DRY_RUN = process.argv.includes('--dry-run');

// Which lists sync — and, because ORDER IS PRIORITY, which copy wins when the same owner
// appears in more than one. Personal List is first: it's the list actually worked out of,
// so its status is the current one. RLS independently limits this to clients the sync user
// belongs to.
const CLIENT_IDS = (process.env.SYNC_CLIENT_IDS ||
  'df98b2a7-741b-48bf-9715-53b897b7cfa7,f3a69c31-8e40-4ea0-865a-d8bd9214376d')
  .split(',').map((s) => s.trim()).filter(Boolean);

const PAGE = 1000;
const CONTACT_FIELDS = 'id,client_id,first_name,last_name,phones,bad_phones,county,status,tax_map_ids,acreage';

function need(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  fail(`Missing required env var: ${names.join(' or ')}`);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const log = (...a) => console.log(...a);

// This repo is PUBLIC, and GitHub Actions logs on a public repo are world-readable. Owner
// names and phone numbers are client PII, so nothing identifying is ever printed in CI —
// counts only. Locally, names are useful and safe.
const IN_CI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);

// Nightly and unattended: a blip shouldn't cost a whole day of sync.
async function withRetry(label, fn, attempts = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw new Error(`${label} failed after ${attempts} attempts: ${err.message}`);
      const wait = 1000 * 2 ** (i - 1);
      log(`  ${label} attempt ${i} failed (${err.message}); retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// ── Google ────────────────────────────────────────────────────────────────────
async function googleAccessToken() {
  const body = new URLSearchParams({
    client_id: need('GOOGLE_CLIENT_ID'),
    client_secret: need('GOOGLE_CLIENT_SECRET'),
    refresh_token: need('GOOGLE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The classic failure: an OAuth app left in "Testing" expires refresh tokens after 7
    // days. See PHONE_SYNC.md — the app must be published to "In production".
    const hint = json.error === 'invalid_grant'
      ? ' — refresh token revoked or expired. If your OAuth consent screen is still in "Testing", publish it to "In production" and re-run scripts/phone-sync-authorize.mjs.'
      : '';
    fail(`Google token refresh failed: ${json.error || res.status}${hint}`);
  }
  return json.access_token;
}

function googleFetch(token) {
  return async (path, init = {}) => {
    const res = await fetch(`https://people.googleapis.com/v1/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    if (!res.ok) {
      // A People API error body can quote the field values that caused it — i.e. names and
      // numbers. In CI (public logs) surface only the status; keep detail for local runs.
      let detail = text.slice(0, 300);
      if (IN_CI) {
        let status = '';
        try { status = JSON.parse(text || '{}')?.error?.status || ''; } catch { /* not JSON */ }
        detail = status || '(detail withheld in CI — re-run locally to see it)';
      }
      throw new Error(`${res.status} ${detail}`);
    }
    return text ? JSON.parse(text) : {};
  };
}

async function listGoogleContacts(api) {
  const people = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ personFields: PERSON_FIELDS, pageSize: '1000' });
    if (pageToken) qs.set('pageToken', pageToken);
    const json = await withRetry('connections.list', () => api(`people/me/connections?${qs}`));
    people.push(...(json.connections || []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return people;
}

// ── Supabase ──────────────────────────────────────────────────────────────────
async function loadContacts() {
  const supabase = createClient(
    need('SUPABASE_URL', 'VITE_SUPABASE_URL'),
    need('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'),
    { auth: { persistSession: false } },
  );

  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: need('SYNC_USER_EMAIL'),
    password: need('SYNC_USER_PASSWORD'),
  });
  if (authErr) fail(`Supabase sign-in failed: ${authErr.message}`);

  const { data: clients, error: clientErr } = await supabase.from('clients').select('id,name');
  if (clientErr) fail(`Loading clients failed: ${clientErr.message}`);
  const clientNames = new Map((clients || []).map((c) => [c.id, c.name]));

  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('property_crm_contacts')
      .select(CONTACT_FIELDS)
      .in('client_id', CLIENT_IDS)
      .eq('has_good_phone', true) // generated column, db/20260713_filter_columns.sql
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) fail(`Loading contacts failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { rows, clientNames };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log(`Taraform → Google Contacts sync${DRY_RUN ? ' (DRY RUN — nothing will be written)' : ''}`);

  const { rows, clientNames } = await loadContacts();
  log(`  Supabase: ${rows.length} contacts with a good phone across ${CLIENT_IDS.length} list(s)`);

  // Collapse the same owner appearing in more than one list into a single phone contact.
  const deduped = dedupeByPhone(rows, CLIENT_IDS);
  const merged = deduped.reduce((n, d) => n + d.mergedFrom.length, 0);
  if (merged) log(`  Merged ${merged} cross-list duplicate(s) into ${deduped.filter(d => d.mergedFrom.length).length} contact(s)`);

  const label = (c) => `${[c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown'}`
    + `${c.status ? ` (${c.status})` : ''} — ${clientNames.get(c.client_id) || 'unknown list'}`;

  const desired = new Map();
  let undialable = 0;
  for (const { contact, mergedFrom } of deduped) {
    const person = buildPerson(contact, clientNames.get(contact.client_id) || '', mergedFrom.map(label));
    if (!person) { undialable++; continue; }
    desired.set(String(contact.id), person);
  }
  if (undialable) log(`  Skipped ${undialable} contact(s) with no dialable 10-digit number`);

  const api = googleFetch(await googleAccessToken());
  const existing = await listGoogleContacts(api);
  log(`  Google: ${existing.length} contacts in the account`);

  const { toCreate, toUpdate, toDelete } = diffContacts(desired, existing);
  log(`  Plan: ${toCreate.length} create, ${toUpdate.length} update, ${toDelete.length} delete`);

  if (DRY_RUN) {
    if (IN_CI) {
      log('  (names withheld — this repo is public and Actions logs are world-readable;');
      log('   run locally for a per-contact preview)');
    } else {
      for (const p of toCreate.slice(0, 5)) log(`    + ${p.names[0].givenName} ${p.names[0].familyName}`);
      for (const u of toUpdate.slice(0, 5)) log(`    ~ ${u.person.names[0].givenName} ${u.person.names[0].familyName}`);
    }
    log('Dry run complete.');
    return;
  }

  for (const batch of chunk(toCreate, CREATE_CHUNK)) {
    await withRetry('batchCreateContacts', () => api('people:batchCreateContacts', {
      method: 'POST',
      body: JSON.stringify({ contacts: batch.map((contactPerson) => ({ contactPerson })), readMask: 'names' }),
    }));
    log(`  created ${batch.length}`);
  }

  for (const batch of chunk(toUpdate, UPDATE_CHUNK)) {
    // batchUpdate keys by resourceName and requires the etag Google handed us back.
    const contacts = Object.fromEntries(batch.map((u) => [u.resourceName, { ...u.person, etag: u.etag }]));
    await withRetry('batchUpdateContacts', () => api('people:batchUpdateContacts', {
      method: 'POST',
      body: JSON.stringify({ contacts, updateMask: UPDATE_MASK, readMask: 'names' }),
    }));
    log(`  updated ${batch.length}`);
  }

  for (const batch of chunk(toDelete, DELETE_CHUNK)) {
    await withRetry('batchDeleteContacts', () => api('people:batchDeleteContacts', {
      method: 'POST',
      body: JSON.stringify({ resourceNames: batch }),
    }));
    log(`  deleted ${batch.length}`);
  }

  log(`✓ Sync complete — ${desired.size} contacts on your phone.`);
}

main().catch((err) => fail(err.stack || err.message));
