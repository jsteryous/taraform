import { supabase } from './supabase';

// Company <-> person links (db/20261113_companies.sql). A company is a contact with
// kind = 'company'; a link says a person is connected to it, with their title there.
//
// The rules — a link joins a company to a person, both in the same workspace — are
// enforced by a trigger, not here. These functions send the two ids and the title.

const OTHER = 'id,first_name,last_name,phones,status,kind';

function mapOther(d) {
  return {
    id: d.id,
    name: displayName({ firstName: d.first_name, lastName: d.last_name }),
    phone: d.phones?.[0] || '',
    status: d.status,
    kind: d.kind,
  };
}

// One name for a contact of either kind. A company keeps its whole name in firstName.
export function displayName(c) {
  return `${c?.firstName || ''} ${c?.lastName || ''}`.trim() || 'Unnamed';
}

// Who a contact is connected to: a company's people, or a person's companies.
// Returns [{ linkId, title, contact: { id, name, phone, status, kind } }].
export async function fetchConnections(contact) {
  const isCompany = contact.kind === 'company';
  const mine  = isCompany ? 'company_id' : 'person_id';
  const other = isCompany ? 'person_id' : 'company_id';
  const { data, error } = await supabase
    .from('contact_links')
    .select(`id,title,other:property_crm_contacts!${other}(${OTHER})`)
    .eq(mine, contact.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || [])
    .filter(r => r.other)
    .map(r => ({ linkId: r.id, title: r.title || '', contact: mapOther(r.other) }));
}

export async function addConnection({ companyId, personId, title }) {
  const { data, error } = await supabase
    .from('contact_links')
    .insert({ company_id: companyId, person_id: personId, title: title?.trim() || null })
    .select('id')
    .single();
  if (error) {
    // 23505 = the (company, person) pair already exists.
    if (error.code === '23505') throw new Error('They are already linked.');
    throw error;
  }
  return data.id;
}

// The title is the only part of a link that can change (contact_links_stamp pins the rest).
export async function updateConnectionTitle(linkId, title) {
  const { error } = await supabase
    .from('contact_links')
    .update({ title: title?.trim() || null })
    .eq('id', linkId);
  if (error) throw error;
}

export async function removeConnection(linkId) {
  const { error } = await supabase.from('contact_links').delete().eq('id', linkId);
  if (error) throw error;
}

// Strip PostgREST filter-syntax characters before interpolation, same rule as the search
// filter in contactFilters.js.
const esc = (s) => String(s).replace(/[(),{}\[\]"\\%*]/g, '').trim();

// Contacts of one kind matching a typed name — the picker for "link a company/person".
export async function searchByKind(clientId, kind, text, limit = 8) {
  const q = esc(text || '');
  if (!clientId || q.length < 2) return [];
  const { data, error } = await supabase
    .from('property_crm_contacts')
    .select(OTHER)
    .eq('client_id', clientId)
    .eq('kind', kind)
    .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
    .order('first_name')
    .limit(limit);
  if (error) throw error;
  return (data || []).map(mapOther);
}
