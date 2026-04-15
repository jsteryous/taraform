import { supabase } from './supabase';

const BASE = 'https://taraform-server-production.up.railway.app';

async function req(path, options = {}, _retry = true) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const method = options.method || 'GET';
  const body   = options.body;
  if (body) {
    try { console.log(`[api] ${method} ${path}`, JSON.parse(body)); } catch { console.log(`[api] ${method} ${path}`, body); }
  }

  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });

  const text = await res.text();
  if (!res.ok) {
    // On 401, refresh the session once and retry. If the refresh also fails,
    // the token is unrecoverable — sign out so the user can re-authenticate.
    if (res.status === 401 && _retry) {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr && refreshed.session) {
        return req(path, options, false);
      }
      await supabase.auth.signOut();
      window.location.reload();
      return;
    }

    console.error(`[api] ${method} ${path} → ${res.status}`, text);
    let errMsg;
    try {
      const json = JSON.parse(text);
      errMsg = json.error || json.message || `${res.status} ${res.statusText}`;
    } catch {
      errMsg = `${res.status} ${res.statusText}`;
    }
    const err = new Error(errMsg);
    err.status = res.status;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Clients
export const getClients      = ()           => req('/api/clients');
export const createClient    = (body)       => req('/api/clients', { method: 'POST', body: JSON.stringify(body) });
export const updateClient    = (id, body)   => req(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteClient    = (id)         => req(`/api/clients/${id}`, { method: 'DELETE' });

// Client users (members)
export const getClientUsers   = (clientId)         => req(`/api/clients/${clientId}/users`);
export const addClientUser    = (clientId, email)  => req(`/api/clients/${clientId}/users`, { method: 'POST', body: JSON.stringify({ email }) });
export const removeClientUser = (clientId, userId) => req(`/api/clients/${clientId}/users/${userId}`, { method: 'DELETE' });

// Templates
export const getTemplates    = (clientId)   => req(`/api/templates?client_id=${clientId}`);
export const createTemplate  = (body)       => req('/api/templates', { method: 'POST', body: JSON.stringify(body) });
export const updateTemplate  = (id, body)   => req(`/api/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteTemplate  = (id)         => req(`/api/templates/${id}`, { method: 'DELETE' });

// Settings
export const getSetting      = (key, cid)        => req(`/api/settings/${key}?client_id=${cid}`);
export const putSetting      = (key, value, cid) => req(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value, client_id: cid }) });

// SMS
export const getMessages     = (contactId)  => req(`/api/messages/${contactId}`);
export const sendMessage     = (body)       => req('/api/send', { method: 'POST', body: JSON.stringify(body) });

// Offers
export const addOffer    = (contactId, body)              => req(`/api/contacts/${contactId}/offers`, { method: 'POST', body: JSON.stringify(body) });
export const updateOffer = (contactId, offerId, body)     => req(`/api/contacts/${contactId}/offers/${offerId}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteOffer = (contactId, offerId, clientId) => req(`/api/contacts/${contactId}/offers/${offerId}?client_id=${clientId}`, { method: 'DELETE' });

// Email connection
export const getEmailStatus      = (clientId)       => req(`/api/email/status?client_id=${clientId}`);
export const getEmailAuthUrl     = (clientId)       => req(`/api/email/auth-url?client_id=${clientId}`);
export const getGmailAuthUrl     = (clientId)       => req(`/api/email/gmail-auth-url?client_id=${clientId}`);
export const disconnectEmail     = (clientId)       => req(`/api/email/disconnect?client_id=${clientId}`, { method: 'DELETE' });

// Email templates
export const getEmailTemplates   = (clientId)       => req(`/api/email/templates?client_id=${clientId}`);
export const createEmailTemplate = (body)           => req('/api/email/templates', { method: 'POST', body: JSON.stringify(body) });
export const updateEmailTemplate = (id, body)       => req(`/api/email/templates/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteEmailTemplate = (id)             => req(`/api/email/templates/${id}`, { method: 'DELETE' });

// Email verification
export const startEmailVerify      = (body)         => req('/api/email/verify-start', { method: 'POST', body: JSON.stringify(body) });
export const getEmailVerifyStatus  = (clientId)     => req(`/api/email/verify-status?client_id=${clientId}`);
export const resetEmailVerifyJob   = (clientId)     => req(`/api/email/verify-reset?client_id=${clientId}`, { method: 'DELETE' });
export const reprocessEmailVerify  = (body)         => req('/api/email/verify-reprocess', { method: 'POST', body: JSON.stringify(body) });

// Email stats
export const getEmailStats         = (clientId, period) => req(`/api/email/stats?client_id=${clientId}&period=${period}`);

// Email sending
export const getEmailMessages      = (contactId, clientId) => req(`/api/email/messages?contact_id=${contactId}&client_id=${clientId}`);
export const sendEmailOne          = (body)                => req('/api/email/send-one', { method: 'POST', body: JSON.stringify(body) });
export const sendEmailBatch        = (body)                => req('/api/email/send-batch', { method: 'POST', body: JSON.stringify(body) });
