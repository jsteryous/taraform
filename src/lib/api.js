import { supabase } from './supabase';

// Direct Supabase data access (anon key + RLS). Replaced the Railway server
// (taraform-server) on 2026-06-10. Clients/members are backed by the policies
// and SECURITY DEFINER RPCs in db/20260610_clients_rls.sql; offers rely on the
// pre-existing membership policy on contact_offers.

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// Clients — RLS limits rows to clients the caller is a member of
export const getClients = async () =>
  unwrap(await supabase.from('clients').select('*').order('name', { ascending: true }));

export const createClient = async ({ name, twilio_number }) =>
  unwrap(await supabase.rpc('create_client', { p_name: name, p_twilio_number: twilio_number || null }));

export const updateClient = async (id, body) => {
  const updates = {};
  for (const key of ['name', 'twilio_number', 'config', 'custom_field_definitions']) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  return unwrap(await supabase.from('clients').update(updates).eq('id', id).select().single());
};

export const deleteClient = async (id) =>
  unwrap(await supabase.from('clients').delete().eq('id', id));

// Client users (members) — RPCs enforce membership/owner checks and resolve emails
export const getClientUsers = async (clientId) =>
  unwrap(await supabase.rpc('get_client_members', { p_client_id: clientId }));

export const addClientUser = async (clientId, email) =>
  unwrap(await supabase.rpc('add_client_member', { p_client_id: clientId, p_email: email }));

export const removeClientUser = async (clientId, userId) =>
  unwrap(await supabase.rpc('remove_client_member', { p_client_id: clientId, p_user_id: userId }));

// Offers — contact_offers.id is bigint with no DB default, hence Date.now()
export const addOffer = async (contactId, { amount, status, notes, clientId }) =>
  unwrap(await supabase.from('contact_offers')
    .insert({ id: Date.now(), contact_id: contactId, client_id: clientId, amount, status, notes })
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
