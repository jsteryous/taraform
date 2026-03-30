import { createContext, useContext, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { mapDbContact, mapContactToDb } from '../lib/utils';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser]                   = useState(null);
  const [clientsList, setClientsList]     = useState([]);
  const [currentClientId, setCurrentClientId] = useState(null);
  const [contacts, setContacts]           = useState([]);
  const [currentContact, setCurrentContact] = useState(null);
  const [theme, setThemeState]            = useState(() => localStorage.getItem('taraform_theme') || 'dark');
  const [toast, setToast]                 = useState(null);

  const currentClient = clientsList.find(c => c.id === currentClientId) || null;

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function setTheme(name) {
    setThemeState(name);
    localStorage.setItem('taraform_theme', name);
    document.body.classList.remove('theme-dim', 'theme-light');
    if (name === 'dim') document.body.classList.add('theme-dim');
    if (name === 'light') document.body.classList.add('theme-light');
  }

  const loadContacts = useCallback(async (clientId) => {
    if (!clientId) return;
    const PAGE = 1000;
    // Only fetch fields needed for the list view — skip heavy JSONB blobs
    const LIST_FIELDS = 'id,first_name,last_name,phones,email,county,status,sms_status,email_status,last_sms_at,lead_source,contact_method,acreage,tax_map_ids,offers,updated_at,created_at,client_id,user_id';

    // First fetch — also tells us total count
    const first = await supabase
      .from('property_crm_contacts')
      .select(LIST_FIELDS, { count: 'exact' })
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })
      .range(0, PAGE - 1);

    if (first.error) { console.error('loadContacts error:', first.error.message); return; }
    const total = first.count || 0;
    let all = first.data || [];

    // If more pages, fetch them all in parallel
    if (total > PAGE) {
      const pageCount = Math.ceil(total / PAGE);
      const rest = await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, i) =>
          supabase.from('property_crm_contacts')
            .select(LIST_FIELDS)
            .eq('client_id', clientId)
            .order('updated_at', { ascending: false })
            .range((i + 1) * PAGE, (i + 2) * PAGE - 1)
        )
      );
      rest.forEach(r => { if (!r.error) all = [...all, ...(r.data || [])]; });
    }

    setContacts(all.map(mapDbContact));
  }, []);

  // Load full contact record (including heavy JSONB) when opening detail view
  const loadFullContact = useCallback(async (contactId) => {
    const { data, error } = await supabase
      .from('property_crm_contacts')
      .select('*')
      .eq('id', contactId)
      .single();
    if (error || !data) return null;
    const full = mapDbContact(data);
    // Update in contacts list too
    setContacts(prev => prev.map(c => c.id === full.id ? full : c));
    return full;
  }, []);

  const saveContact = useCallback(async (contact) => {
    if (!user || !currentClientId) return;
    const record = mapContactToDb(contact, user.id, currentClientId);
    const { error } = await supabase
      .from('property_crm_contacts')
      .upsert({ ...record, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
    setContacts(prev => {
      const idx = prev.findIndex(c => c.id === contact.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = contact; return next; }
      return [contact, ...prev];
    });
    if (currentContact?.id === contact.id) setCurrentContact(contact);
  }, [user, currentClientId, currentContact]);

  const deleteContact = useCallback(async (id) => {
    const { error } = await supabase.from('property_crm_contacts').delete().eq('id', id);
    if (error) throw error;
    setContacts(prev => prev.filter(c => c.id !== id));
    if (currentContact?.id === id) setCurrentContact(null);
  }, [currentContact]);

  return (
    <AppContext.Provider value={{
      user, setUser,
      clientsList, setClientsList,
      currentClientId, setCurrentClientId,
      currentClient,
      contacts, setContacts,
      currentContact, setCurrentContact,
      theme, setTheme,
      toast, showToast,
      loadContacts, loadFullContact, saveContact, deleteContact,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);