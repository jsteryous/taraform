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
    const { data, error } = await supabase
      .from('property_crm_contacts')
      .select('*')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false });
    if (!error) setContacts((data || []).map(mapDbContact));
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
      loadContacts, saveContact, deleteContact,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);