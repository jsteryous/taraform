// GENERATED FILE — DO NOT EDIT.
// Copied from src/lib/ by scripts/sync-edge-shared.mjs. Edit the original and run
// `npm run sync:edge`. src/lib/edgeShared.test.js fails if these drift apart.
// Pure logic for the Google Contacts phone sync (scripts/phone-sync.mjs).
//
// Lives in src/lib (not scripts/) for the same reason contactFilters.js and dedup.js do:
// vitest only collects src/**/*.test.js, and this is the part worth testing. The runner
// keeps all the I/O — Supabase, OAuth, People API — so everything here stays a pure
// function of its inputs.
//
// Contract with the DB (see db/20260613_bad_phones.sql + db/20260713_filter_columns.sql):
//   * `phones` is a jsonb array of plain formatted strings.
//   * `bad_phones` is a jsonb array of NORMALIZED digits (normalizePhone = last 10).
//   * A number is good iff it has digits and its last 10 aren't in bad_phones — this
//     mirrors compute_has_good_phone() exactly. Keep the two in sync.

import { normalizePhone } from './utils.js';

// Stamped into each Google contact's userDefined so we can re-find our own rows.
// Anything in the account WITHOUT this key was added by hand and is never touched.
export const SYNC_KEY = 'taraform_id';

export const PERSON_FIELDS = 'names,phoneNumbers,organizations,biographies,userDefined,urls,memberships';
// memberships is deliberately NOT in the update mask: group membership is set once at
// creation, and an update carrying an empty memberships list would strip the label.
export const UPDATE_MASK = 'names,phoneNumbers,organizations,biographies,userDefined,urls';

// Deep link back into the app, carried on the contact card as a tappable URL. The phone
// can't pop a Taraform window when a call comes in — no browser has access to call state —
// so this is the tap-through: call screen shows the name, the contact card links to the
// record. HashRouter, matching the /#/contact/:id overlay App.jsx syncs to.
export const APP_URL = 'https://taraform.org';
export const URL_LABEL = 'Taraform';

export function contactUrl(id) {
  return `${APP_URL}/#/contact/${id}`;
}

// Every synced contact joins this label, so they're one filterable group in Google Contacts
// instead of scattered through a personal address book.
export const GROUP_NAME = 'Taraform';

// Google caps: 200 per batch create/update, 500 per batch delete.
export const CREATE_CHUNK = 200;
export const UPDATE_CHUNK = 200;
export const DELETE_CHUNK = 500;

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Dialable, non-struck numbers for a contact, as normalized 10-digit strings.
// De-duplicated: the same number formatted two ways is one entry on the phone.
export function goodPhoneDigits(contact) {
  const bad = new Set((Array.isArray(contact.bad_phones) ? contact.bad_phones : []).map((v) => String(v)));
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(contact.phones) ? contact.phones : []) {
    const digits = normalizePhone(String(raw ?? ''));
    if (!digits || bad.has(digits) || seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
  }
  return out;
}

// iOS/Android match incoming calls most reliably against E.164. Anything that isn't a
// clean 10-digit NANP number is dropped rather than guessed at — a wrong +1 would just
// fail to match, which is worse than not syncing it.
export function toE164(digits) {
  return /^\d{10}$/.test(digits) ? `+1${digits}` : null;
}

// The whole point of the feature: the lock screen must say who is calling AND where you
// left off. Google builds displayName from given+family, so the status has to ride along
// in the name — "John Parker (Offer Made)".
export function nameParts(contact) {
  const first = (contact.first_name || '').trim();
  const last = (contact.last_name || '').trim();
  const status = (contact.status || '').trim();
  const suffix = status ? ` (${status})` : '';
  if (!first && !last) return { givenName: 'Unknown', familyName: `Contact${suffix}`.trim() };
  return {
    givenName: first || last,
    familyName: `${first ? last : ''}${suffix}`.trim(),
  };
}

// Identity for cross-list de-duplication: the full set of dialable numbers, sorted.
// Deliberately the WHOLE set rather than "any shared number" — relatives and spouses share
// a landline, and collapsing those would hide a genuinely different owner. Null when the
// contact has nothing dialable.
export function phoneKey(contact) {
  const digits = goodPhoneDigits(contact).filter((d) => toE164(d));
  return digits.length ? [...digits].sort().join(',') : null;
}

// The same owner living in two client lists would otherwise sync as two Google contacts
// with identical numbers, and the phone would pick one arbitrarily. Collapse them to one.
//
// `clientPriority` is an ordered list of client_ids — earlier wins. Ties break on lowest
// id so the winner never flips between runs and churns create/delete pairs.
// Returns [{ contact, mergedFrom }] where mergedFrom are the losers, kept so the survivor
// can mention them in its notes.
export function dedupeByPhone(contacts, clientPriority = []) {
  const rank = new Map(clientPriority.map((id, i) => [id, i]));
  const rankOf = (c) => (rank.has(c.client_id) ? rank.get(c.client_id) : Number.MAX_SAFE_INTEGER);

  const groups = new Map();
  for (const contact of contacts || []) {
    const key = phoneKey(contact);
    if (!key) continue; // nothing dialable — buildPerson would drop it anyway
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(contact);
  }

  const out = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => (rankOf(a) - rankOf(b)) || (Number(a.id) - Number(b.id)));
    out.push({ contact: sorted[0], mergedFrom: sorted.slice(1) });
  }
  return out;
}

// Returns null when a contact has nothing dialable — callers skip those. has_good_phone
// is already filtered server-side, but a contact whose only number is 7 digits survives
// that filter and still can't be synced.
//
// `alsoLines` describe duplicates collapsed into this one (see dedupeByPhone); they go in
// the notes so merging never silently loses the other list's name or status.
export function buildPerson(contact, clientName, alsoLines = []) {
  const phoneNumbers = goodPhoneDigits(contact)
    .map(toE164)
    .filter(Boolean)
    .map((value) => ({ value, type: 'mobile' }));
  if (!phoneNumbers.length) return null;

  const parcels = Array.isArray(contact.tax_map_ids) ? contact.tax_map_ids.filter(Boolean) : [];
  const biography = [
    contact.status ? `Status: ${contact.status}` : null,
    contact.county ? `County: ${contact.county}` : null,
    parcels.length ? `Parcel: ${parcels.join(', ')}` : null,
    contact.acreage ? `Acreage: ${contact.acreage}` : null,
    ...alsoLines.map((line) => `Also: ${line}`),
    `Taraform contact #${contact.id}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    names: [nameParts(contact)],
    phoneNumbers,
    organizations: clientName ? [{ name: clientName }] : [],
    biographies: [{ value: biography, contentType: 'TEXT_PLAIN' }],
    userDefined: [{ key: SYNC_KEY, value: String(contact.id) }],
    // Points at the surviving row after dedupe, which is the one whose status is current.
    urls: [{ value: contactUrl(contact.id), type: URL_LABEL }],
  };
}

export function groupMembership(groupResourceName) {
  return groupResourceName
    ? [{ contactGroupMembership: { contactGroupResourceName: groupResourceName } }]
    : [];
}

export function isInGroup(person, groupResourceName) {
  return (person?.memberships || [])
    .some((m) => m?.contactGroupMembership?.contactGroupResourceName === groupResourceName);
}

// Everything this sync owns — the exact set --purge removes, and the set that gets
// back-filled into the label if it was created before the label existed.
export function taraformResourceNames(people) {
  return (people || [])
    .filter((p) => taraformIdOf(p) && p.resourceName)
    .map((p) => p.resourceName);
}

export function taraformIdOf(person) {
  const hit = (person?.userDefined || []).find((u) => u?.key === SYNC_KEY);
  const value = hit?.value != null ? String(hit.value).trim() : '';
  return value || null;
}

// Comparable shape for "does Google already match what we want?". Phones compare as sorted
// last-10 digits so a formatting difference on Google's side never looks like a change and
// churns an update every night.
export function personSignature(person) {
  const name = (person?.names || [])[0] || {};
  return JSON.stringify({
    givenName: (name.givenName || '').trim(),
    familyName: (name.familyName || '').trim(),
    phones: (person?.phoneNumbers || [])
      .map((p) => normalizePhone(String(p?.value ?? '')))
      .filter(Boolean)
      .sort(),
    org: ((person?.organizations || [])[0]?.name || '').trim(),
    bio: ((person?.biographies || [])[0]?.value || '').trim(),
    // Must be here or the diff can't see the field, and contacts created before the deep
    // link existed would never gain one. Costs a one-time update of every synced contact.
    url: ((person?.urls || [])[0]?.value || '').trim(),
  });
}

// Every number already in the address book on a card this sync does NOT own, as normalized
// last-10 digits.
export function foreignPhoneDigits(existing) {
  const out = new Set();
  for (const person of existing || []) {
    if (taraformIdOf(person)) continue; // ours — not part of the user's own address book
    for (const phone of person?.phoneNumbers || []) {
      const digits = normalizePhone(String(phone?.value ?? ''));
      if (digits) out.add(digits);
    }
  }
  return out;
}

// Never sync a lead who is already one of the user's own contacts.
//
// The sync writes into a PERSONAL Google account, and phones unify cards that share a
// number: iOS links them, Android's contacts provider aggregates them. The merged contact
// then displays whichever name the OS picks — so a lead card would rename the user's own
// contact to "Nicholas Whitaker (Dead/Pass)" and swap the photo. That happened to five real
// contacts before this rule existed.
//
// Skipping them costs nothing: the number is already in the address book, so caller ID
// already worked. The only thing the lead card added was the collision. And because
// diffContacts reconciles rather than appends, dropping one here DELETES the card a previous
// run created — the fix cleans up after itself on the next run.
export function withoutPersonalNumbers(desired, existing) {
  const mine = foreignPhoneDigits(existing);
  const kept = new Map();
  const skipped = [];
  for (const [id, person] of desired) {
    const clashes = (person?.phoneNumbers || [])
      .some((p) => mine.has(normalizePhone(String(p?.value ?? ''))));
    if (clashes) skipped.push(id);
    else kept.set(id, person);
  }
  return { desired: kept, skipped };
}

// Reconcile, not append — this is what keeps nightly runs from piling up duplicates.
// `desired` is Map<taraformId, person>; `existing` is what people.connections.list returned.
export function diffContacts(desired, existing) {
  const toCreate = [];
  const toUpdate = [];
  const toDelete = [];
  const seen = new Set();

  for (const person of existing || []) {
    const id = taraformIdOf(person);
    if (!id) continue; // hand-added contact — not ours, leave it alone
    if (seen.has(id)) {
      toDelete.push(person.resourceName); // stray duplicate of one we own
      continue;
    }
    seen.add(id);
    const want = desired.get(id);
    if (!want) {
      toDelete.push(person.resourceName); // deleted in Taraform, or lost its last good phone
      continue;
    }
    if (personSignature(want) !== personSignature(person)) {
      toUpdate.push({ resourceName: person.resourceName, etag: person.etag, person: want });
    }
  }

  for (const [id, want] of desired) if (!seen.has(id)) toCreate.push(want);

  return { toCreate, toUpdate, toDelete };
}
