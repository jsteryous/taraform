const BASE = 'https://taraform-server-production.up.railway.app';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Clients
export const getClients      = ()           => req('/api/clients');
export const createClient    = (body)       => req('/api/clients', { method: 'POST', body: JSON.stringify(body) });
export const updateClient    = (id, body)   => req(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteClient    = (id)         => req(`/api/clients/${id}`, { method: 'DELETE' });

// Templates
export const getTemplates    = (clientId)   => req(`/api/templates?client_id=${clientId}`);
export const createTemplate  = (body)       => req('/api/templates', { method: 'POST', body: JSON.stringify(body) });
export const updateTemplate  = (id, body)   => req(`/api/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteTemplate  = (id)         => req(`/api/templates/${id}`, { method: 'DELETE' });

// Settings
export const getSetting      = (key, cid)   => req(`/api/settings/${key}?client_id=${cid}`);
export const putSetting      = (key, value, cid) => req(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value, client_id: cid }) });

// SMS
export const getMessages     = (contactId)  => req(`/api/messages/${contactId}`);
export const sendMessage     = (body)       => req('/api/send', { method: 'POST', body: JSON.stringify(body) });