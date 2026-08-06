import { supabase } from './supabase';
import { mapDbContact, mapContactToDb } from './utils';
import { applyContactFilters } from './contactFilters';

// Data access for property_crm_contacts + contact_offers. Everything here is a plain
// async function over supabase-js — no React, no component state — so AppContext can be
// pure orchestration and these can be exercised without rendering anything.
//
// Companion module: api.js (clients, members, offer mutations). Between them they are the
// whole data layer; components and context should not build supabase queries themselves.
//
// Row shapes: functions named fetch*Contacts*/insert/upsert return app-shaped (camelCase)
// contacts via mapDbContact. The two bulk export helpers are the deliberate exception and
// return RAW snake_case DB rows — see their comments.

// activity_log + bad_phones are carried so the detail overlay's re-check has something to
// show; the filter itself is entirely server-side (see applyContactFilters).
export const LIST_FIELDS = 'id,first_name,last_name,phones,bad_phones,verified_phones,email,county,status,follow_up_on,sms_status,email_status,lead_source,contact_method,acreage,tax_map_ids,activity_log,updated_at,created_at,client_id,user_id';
export const PAGE_SIZE = 50;

// The one place a filtered contact query is shaped. Every read path below goes through it,
// which is what keeps the list, the count, pagination and the CSV export in agreement.
function buildQuery(clientId, filters = {}, fields = LIST_FIELDS, opts = {}) {
  let q = supabase.from('property_crm_contacts')
    .select(fields, opts)
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false });
  return applyContactFilters(q, filters);
}

// One page of the list view, plus the exact total for the current filters.
export async function fetchContactsPage(clientId, filters = {}, from = 0, size = PAGE_SIZE) {
  const { data, count, error } = await buildQuery(clientId, filters, LIST_FIELDS, { count: 'exact' })
    .range(from, from + size - 1);
  if (error) throw error;
  return { contacts: (data || []).map(mapDbContact), count: count || 0 };
}

// Full row + offers for the detail overlay. Returns null when the contact is gone.
// Offers are best-effort: a failure there shouldn't blank out the contact.
export async function fetchFullContact(contactId) {
  const { data, error } = await supabase
    .from('property_crm_contacts').select('*').eq('id', contactId).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const contact = mapDbContact(data);
  const { data: offerRows, error: offersError } = await supabase
    .from('contact_offers')
    .select('id, amount, status, notes, created_at, property_crm_contacts!inner(client_id)')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true });
  if (offersError) console.error('fetchFullContact offers error:', offersError);
  contact.offers = offersError ? [] : (offerRows || []).map(row => ({
    id: row.id, amount: row.amount, status: row.status, notes: row.notes, createdAt: row.created_at,
  }));
  return contact;
}

// Asks the server — using the same applyContactFilters the list used — whether a contact
// still belongs in the current view. This is how a row edited in the detail overlay drops
// out of the list without a refetch and without a second, hand-maintained copy of the
// filter logic in JS. Returns true when no filters are active (nothing can drift).
export async function contactStillMatches(id, clientId, filters = {}) {
  const { data, error } = await buildQuery(clientId, filters, 'id').eq('id', id).limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

// Pages past Supabase's 1000-row cap for Export All.
// Returns RAW DB rows (snake_case, select('*')) — the CSV needs owner_address /
// property_addresses / activity_log, which LIST_FIELDS omits, and App.handleExport
// reads snake_case keys directly.
export async function fetchAllFilteredContacts(clientId, filters = {}) {
  if (!clientId) return [];
  const CHUNK = 1000;
  const all = [];
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await buildQuery(clientId, filters, '*').range(from, from + CHUNK - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < CHUNK) break;
  }
  return all;
}

// Export Selected — the source objects come from the list view (LIST_FIELDS) and so lack
// owner_address / property_addresses. Also returns RAW DB rows, same reason as above.
// Chunked to stay under URL-length limits on the `in` filter.
export async function fetchContactsByIds(ids) {
  if (!ids?.length) return [];
  const CHUNK = 200;
  const all = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('property_crm_contacts')
      .select('*')
      .in('id', ids.slice(i, i + CHUNK));
    if (error) throw error;
    all.push(...(data || []));
  }
  return all;
}

// ── Duplicate detection ─────────────────────────────────────────────────────────────
//
// Dedup MUST NOT read AppContext's `contacts` array. That array is one page of the list
// (PAGE_SIZE rows), so scanning it silently compares a CSV against ~50 of your contacts
// and imports the rest as new — and it omits property_addresses entirely, which killed
// address matching outright. Both dedup callsites were doing exactly that.
//
// These two functions fetch the corpus dedup actually needs. The matching rules stay in
// dedup.js / AddContactModal — the server is used for *recall* (rows that could collide),
// the pure functions for *precision* (the county|taxId rule, etc.).
const DEDUP_FIELDS = 'id,first_name,last_name,county,tax_map_ids,property_addresses,phones';

// Strip PostgREST filter-syntax + JSON control chars before interpolation, same rule as
// the search filter in contactFilters.js.
const esc = (s) => String(s).replace(/[(),{}\[\]"\\]/g, '').trim();

// Every dedup key in the client, for bulk import. Deliberately the simple approach: at
// this app's scale (low thousands of contacts) this is a few hundred KB and obviously
// correct, which beats a clever targeted query. Past ~100k contacts per client, switch to
// probing by the candidate keys instead of pulling the whole index.
export async function fetchDedupIndex(clientId) {
  if (!clientId) return [];
  const CHUNK = 1000;
  const all = [];
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from('property_crm_contacts')
      .select(DEDUP_FIELDS)
      .eq('client_id', clientId)
      .order('id')
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < CHUNK) break;
  }
  return all.map(mapDbContact);
}

// Rows that could collide with ONE candidate — for the add-contact duplicate warning,
// where pulling the whole index would be wasteful. Coarse on purpose: it matches a
// tax map id in any county, and the caller's findDuplicates applies the county rule.
export async function fetchDuplicateCandidates(clientId, contact) {
  if (!clientId) return [];
  const ors = [];
  const first = esc(contact.firstName || '');
  const last  = esc(contact.lastName || '');
  if (first && last) ors.push(`and(first_name.ilike.${first},last_name.ilike.${last})`);
  for (const t of contact.taxMapIds || []) { const v = esc(t); if (v) ors.push(`tax_map_ids.cs.["${v}"]`); }
  for (const a of contact.propertyAddresses || []) { const v = esc(a); if (v) ors.push(`property_addresses.cs.["${v}"]`); }
  if (!ors.length) return [];

  const { data, error } = await supabase
    .from('property_crm_contacts')
    .select(DEDUP_FIELDS)
    .eq('client_id', clientId)
    .or(ors.join(','))
    .limit(50);
  if (error) throw error;
  return (data || []).map(mapDbContact);
}

// New contact: the DB owns the id (property_crm_contacts_id_seq), so insert without one
// and read the generated row back — a client-minted id collides across members/devices.
export async function insertContact(contact, userId, clientId) {
  const record = mapContactToDb(contact, userId, clientId);
  delete record.id;
  const { data, error } = await supabase.from('property_crm_contacts')
    .insert({ ...record, updated_at: new Date().toISOString() })
    .select().single();
  if (error) throw error;
  return mapDbContact(data);
}

// Raised when a save's optimistic-concurrency precondition fails: the row moved since we
// last read it, so writing would silently overwrite whatever the other editor did.
export class ContactConflictError extends Error {
  constructor(message = 'This contact changed somewhere else — your edit was not saved. Reopen it to see the current version.') {
    super(message);
    this.name = 'ContactConflictError';
  }
}

// Existing contact. `expectedUpdatedAt` is the version the caller last saw; the write only
// lands if the row still carries it.
//
// Without this the save was a full-row upsert with no precondition, so two people editing
// one contact was last-write-wins with no error — and because activity_log is rewritten
// wholesale rather than appended, a note logged concurrently just disappeared. Silent data
// loss, invisible at one user and live at two. Passing null keeps the old unguarded
// behaviour for callers that have no version to offer.
//
// Returns the new server updated_at so the caller can advance its version.
export async function upsertContact(contact, userId, clientId, expectedUpdatedAt = null) {
  const record = mapContactToDb(contact, userId, clientId);
  const stamp = new Date().toISOString();
  let q = supabase.from('property_crm_contacts')
    .update({ ...record, updated_at: stamp })
    .eq('id', contact.id);
  if (expectedUpdatedAt) q = q.eq('updated_at', expectedUpdatedAt);
  const { data, error } = await q.select('updated_at');
  if (error) throw error;
  // Zero rows means the id+version pair matched nothing: either someone else wrote first,
  // or the row is gone. Never fall back to an insert — that would resurrect a deleted row.
  if (!data?.length) {
    if (expectedUpdatedAt) throw new ContactConflictError();
    throw new Error('Contact not found — it may have been deleted.');
  }
  return data[0].updated_at;
}

export async function deleteContactById(id) {
  const { error } = await supabase.from('property_crm_contacts').delete().eq('id', id);
  if (error) throw error;
}
