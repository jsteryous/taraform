import { supabase } from './supabase';

// Direct Supabase data access (anon key + RLS). Replaced the Railway server
// (taraform-server) on 2026-06-10. Clients/members are backed by the policies
// and SECURITY DEFINER RPCs in db/20260610_clients_rls.sql; offers rely on the
// pre-existing membership policy on contact_offers.

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// Workspaces ("clients" in the schema) — RLS limits rows to the ones the caller is a member
// of. Each comes back with the caller's own `role` ('owner' | 'member') and `autoFollowUp`
// in it, read from their membership rows, so the UI can offer settings only to someone who may save them.
// The role here is for presentation; what an owner can do that a member cannot is enforced
// by the policies on `clients` (db/20261113_no_self_serve_workspaces.sql).
//
// There is deliberately no createClient. Workspaces are not self-serve: a new one is made
// by hand in SQL (snippet in that migration), because signup is open to the internet and
// the app is one team's shared CRM, not a product strangers can start their own space in.
export const getClients = async () => {
  const [clients, memberships] = await Promise.all([
    supabase.from('clients').select('*').order('name', { ascending: true }),
    supabase.from('client_users').select('client_id, role, auto_follow_up'),
  ]);
  const rows = unwrap(clients);
  // A failed role lookup must not hide the workspaces themselves; it only withholds the
  // owner controls, which is the safe direction to be wrong in.
  const mine = new Map((memberships.error ? [] : memberships.data || []).map(m => [m.client_id, m]));
  return rows.map(c => ({
    ...c,
    role: mine.get(c.id)?.role || 'member',
    // This person's own switch for this workspace; on unless they turned it off.
    autoFollowUp: mine.get(c.id)?.auto_follow_up !== false,
  }));
};

// Each person's own on/off for automatic follow-up scheduling in one workspace. An RPC
// because a membership row is otherwise read-only to its owner: it also holds `role`,
// and a plain UPDATE policy would let anyone promote themselves.
export const setAutoFollowUp = async (clientId, on) =>
  unwrap(await supabase.rpc('set_auto_follow_up', { p_client_id: clientId, p_on: on }));

export const updateClient = async (id, body) => {
  const updates = {};
  for (const key of ['name', 'config', 'custom_field_definitions']) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  return unwrap(await supabase.from('clients').update(updates).eq('id', id).select().single());
};

export const deleteClient = async (id) =>
  unwrap(await supabase.from('clients').delete().eq('id', id));

// Deleting a client cascades to its contacts and offers (FKs are ON DELETE
// CASCADE), and the project has no platform backups. Count first so the confirm
// dialog can say what is actually about to be destroyed.
export const getClientDataCounts = async (clientId) => {
  const [contacts, offers] = await Promise.all([
    supabase.from('property_crm_contacts').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
    supabase.from('contact_offers').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
  ]);
  if (contacts.error) throw new Error(contacts.error.message);
  if (offers.error) throw new Error(offers.error.message);
  return { contacts: contacts.count ?? 0, offers: offers.count ?? 0 };
};

// Client users (members) — RPCs enforce membership/owner checks and resolve emails
export const getClientUsers = async (clientId) =>
  unwrap(await supabase.rpc('get_client_members', { p_client_id: clientId }));

export const addClientUser = async (clientId, email) =>
  unwrap(await supabase.rpc('add_client_member', { p_client_id: clientId, p_email: email }));

export const removeClientUser = async (clientId, userId) =>
  unwrap(await supabase.rpc('remove_client_member', { p_client_id: clientId, p_user_id: userId }));

// Offers — contact_offers.id is a DB-owned identity sequence (db/20260613_id_defaults.sql);
// omit id on insert and read the generated one back from .select().
export const addOffer = async (contactId, { amount, status, notes, clientId }) =>
  unwrap(await supabase.from('contact_offers')
    .insert({ contact_id: contactId, client_id: clientId, amount, status, notes })
    .select().single());

export const updateOffer = async (contactId, offerId, { amount, status, notes }) =>
  unwrap(await supabase.from('contact_offers')
    .update({ amount, status, notes })
    .eq('id', offerId).eq('contact_id', contactId)
    .select().single());

export const deleteOffer = async (contactId, offerId) =>
  unwrap(await supabase.from('contact_offers')
    .delete()
    .eq('id', offerId).eq('contact_id', contactId)
    .select().single());
