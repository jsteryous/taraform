import { createContext, useContext, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { mapDbContact, mapContactToDb } from '../lib/utils';

const AppContext = createContext(null);

const LIST_FIELDS = 'id,first_name,last_name,phones,email,county,status,sms_status,email_status,last_sms_at,lead_source,contact_method,acreage,tax_map_ids,updated_at,created_at,client_id,user_id';
const PAGE_SIZE   = 50;

export function AppProvider({ children }) {
  const [user, setUser]                       = useState(null);
  const [clientsList, setClientsList]         = useState([]);
  const [currentClientId, setCurrentClientId] = useState(null);
  const [currentContact, setCurrentContact]   = useState(null);
  const [theme, setThemeState]                = useState(() => localStorage.getItem('taraform_theme') || 'dark');
  const [toast, setToast]                     = useState(null);

  // Paginated contact state
  const [contacts, setContacts]       = useState([]);
  const [totalCount, setTotalCount]   = useState(0);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [currentFilters, setCurrentFilters]   = useState(null);

  const currentClient = clientsList.find(c => c.id === currentClientId) || null;

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  function setTheme(name) {
    setThemeState(name);
    localStorage.setItem('taraform_theme', name);
    document.body.classList.remove('theme-dim', 'theme-light');
    if (name === 'dim') document.body.classList.add('theme-dim');
    if (name === 'light') document.body.classList.add('theme-light');
  }

  // ── Build a Supabase query from filter state ──────────────
  function buildQuery(clientId, filters = {}) {
    let q = supabase.from('property_crm_contacts')
      .select(LIST_FIELDS, { count: 'exact' })
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false });

    // Status filter
    if (filters.statuses?.length) {
      q = q.in('status', filters.statuses);
    }
    // County filter
    if (filters.counties?.length) {
      q = q.in('county', filters.counties);
    }
    // Phone filter
    if (filters.phone === 'has')     q = q.not('phones', 'eq', '{}');
    if (filters.phone === 'missing') q = q.or('phones.is.null,phones.eq.{}');
    // Email filter
    if (filters.email === 'has')     q = q.not('email', 'is', null).neq('email', '');
    if (filters.email === 'missing') q = q.or('email.is.null,email.eq.');
    // Search (name, phone, county, tax map id)
    if (filters.search) {
      const s = filters.search.toLowerCase().trim();
      const words = s.split(/\s+/).filter(Boolean);

      if (words.length === 1) {
        // Single word — match first name, last name, county, tax map id, or phone
        q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,county.ilike.%${s}%`);
      } else {
        // Multiple words (e.g. "jennifer cumm") — first word matches first name, rest match last name
        const first = words[0];
        const last  = words.slice(1).join(' ');
        q = q.ilike('first_name', `%${first}%`).ilike('last_name', `%${last}%`);
      }
    }

    return q;
  }

  // ── Load first page with filters ──────────────────────────
  const loadContacts = useCallback(async (clientId, filters = {}) => {
    if (!clientId) return;
    setLoadingContacts(true);
    setCurrentFilters(filters);
    try {
      const { data, count, error } = await buildQuery(clientId, filters)
        .range(0, PAGE_SIZE - 1);
      if (error) throw error;
      setContacts((data || []).map(mapDbContact));
      setTotalCount(count || 0);
    } catch (e) {
      console.error('loadContacts error:', e.message);
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  // ── Load next page (append) ───────────────────────────────
  const loadMoreContacts = useCallback(async (clientId, filters = {}) => {
    if (!clientId || loadingContacts) return;
    setLoadingContacts(true);
    try {
      const from = contacts.length;
      const { data, error } = await buildQuery(clientId, filters)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      setContacts(prev => [...prev, ...(data || []).map(mapDbContact)]);
    } catch (e) {
      console.error('loadMoreContacts error:', e.message);
    } finally {
      setLoadingContacts(false);
    }
  }, [contacts.length, loadingContacts]);

  // ── Load full contact (with JSONB) for detail view ────────
  const loadFullContact = useCallback(async (contactId) => {
    const { data, error } = await supabase
      .from('property_crm_contacts').select('*').eq('id', contactId).maybeSingle();
    if (error || !data) { console.error('loadFullContact contact error:', error); return null; }
    const full = mapDbContact(data);
    const { data: offerRows, error: offersError } = await supabase
      .from('contact_offers')
      .select('id, amount, status, notes, created_at, property_crm_contacts!inner(client_id)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true });
    if (offersError) console.error('loadFullContact offers error:', offersError);
    full.offers = offersError
      ? []
      : (offerRows || []).map(row => ({ id: row.id, amount: row.amount, status: row.status, notes: row.notes, createdAt: row.created_at }));
    setContacts(prev => prev.map(c => c.id === full.id ? full : c));
    setCurrentContact(prev => prev?.id === full.id ? full : prev);
    return full;
  }, []);

  const saveContact = useCallback(async (contact) => {
    if (!user || !currentClientId) return;
    const record = mapContactToDb(contact, user.id, currentClientId);
    const { error } = await supabase.from('property_crm_contacts')
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
    setTotalCount(prev => prev - 1);
    if (currentContact?.id === id) setCurrentContact(null);
  }, [currentContact]);

  return (
    <AppContext.Provider value={{
      user, setUser,
      clientsList, setClientsList,
      currentClientId, setCurrentClientId,
      currentClient,
      contacts, setContacts,
      totalCount, setTotalCount,
      loadingContacts,
      currentContact, setCurrentContact,
      theme, setTheme,
      toast, showToast,
      loadContacts, loadMoreContacts, loadFullContact, saveContact, deleteContact,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);