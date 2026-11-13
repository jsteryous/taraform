import { supabase } from './supabase';
import { getClientUsers } from './api';

// Notes data layer. One row per note in contact_notes (db/20261113_contact_notes.sql).
//
// Nothing here decides who may do what. The table stamps author, time and workspace itself
// and RLS lets only the author edit or delete, so these functions send the contact and the
// text and nothing else — the column grants reject anything more. A delete or edit that
// RLS filters out comes back as zero rows rather than an error, which is why both check.

const FIELDS = 'id,contact_id,author_id,body,created_at,edited_at';

export function mapNote(d) {
  return {
    id: d.id,
    contactId: d.contact_id,
    authorId: d.author_id,
    body: d.body,
    createdAt: d.created_at,
    editedAt: d.edited_at || null,
  };
}

// Every note on a contact, from every teammate, newest first. Pass several ids to read
// them as one timeline — a company's page shows the notes on its people too.
export async function fetchNotes(contactIds) {
  const ids = [].concat(contactIds);
  const { data, error } = await supabase
    .from('contact_notes')
    .select(FIELDS)
    .in('contact_id', ids)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapNote);
}

export async function addNote(contactId, body) {
  const { data, error } = await supabase
    .from('contact_notes')
    .insert({ contact_id: contactId, body: body.trim() })
    .select(FIELDS)
    .single();
  if (error) throw error;
  return mapNote(data);
}

export async function updateNote(id, body) {
  const { data, error } = await supabase
    .from('contact_notes')
    .update({ body: body.trim() })
    .eq('id', id)
    .select(FIELDS);
  if (error) throw error;
  if (!data?.length) throw new Error('Only the person who wrote a note can edit it.');
  return mapNote(data[0]);
}

export async function deleteNote(id) {
  const { data, error } = await supabase
    .from('contact_notes')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Only the person who wrote a note can delete it.');
}

// Every note in a workspace, grouped by contact, oldest first — for the CSV export. Paged
// past the 1000-row cap. Pulling the lot is the simple, obviously-correct choice at this
// size (hundreds of notes); it is one query per thousand notes regardless of how many
// contacts are being exported.
export async function fetchNotesByContact(clientId) {
  const byContact = new Map();
  if (!clientId) return byContact;
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from('contact_notes')
      .select('contact_id,body,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      if (!byContact.has(r.contact_id)) byContact.set(r.contact_id, []);
      byContact.get(r.contact_id).push(r.body);
    }
    if (rows.length < CHUNK) break;
  }
  return byContact;
}

// user id -> a name to show beside a note. There is no profile table yet, so this is the
// part of the email before the @; display names replace it later (PLAN.md step 5). Cached
// per workspace for the session: membership changes rarely and a stale label is harmless.
const authorCache = new Map();

export function authorLabel(email) {
  if (!email) return 'Former member';
  return email.split('@')[0];
}

export async function fetchAuthorNames(clientId) {
  if (!clientId) return new Map();
  if (authorCache.has(clientId)) return authorCache.get(clientId);
  const members = await getClientUsers(clientId);
  const names = new Map((members || []).map(m => [m.user_id, authorLabel(m.email)]));
  authorCache.set(clientId, names);
  return names;
}
