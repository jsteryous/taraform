import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { mapDbContact, mapContactToDb } from '../lib/utils';

const AppContext = createContext(null);

const LIST_FIELDS = 'id,first_name,last_name,phones,email,county,status,sms_status,email_status,last_sms_at,lead_source,contact_method,acreage,tax_map_ids,updated_at,created_at,client_id,user_id';
const PAGE_SIZE   = 50;

// ── Error classification ──────────────────────────────────────
function classifyError(e) {
  if (!navigator.onLine) return 'You appear to be offline.';
  const status = e?.status ?? e?.code;
  if (status === 401 || status === 403) return 'Permission denied — check your access.';
  if (status === 404) return 'Record not found.';
  if (status >= 500) return 'Server error — try again later.';
  return 'Something went wrong — try again.';
}

// ── Query builder (no component state — lives outside the provider) ──
function buildQuery(clientId, filters = {}) {
  let q = supabase.from('property_crm_contacts')
    .select(LIST_FIELDS, { count: 'exact' })
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false });

  if (filters.statuses?.length) q = q.in('status', filters.statuses);
  if (filters.counties?.length) q = q.in('county', filters.counties);
  if (filters.phone === 'has')     q = q.not('phones', 'eq', '{}');
  if (filters.phone === 'missing') q = q.or('phones.is.null,phones.eq.{}');
  if (filters.email === 'has')     q = q.not('email', 'is', null).neq('email', '');
  if (filters.email === 'missing') q = q.or('email.is.null,email.eq.');

  if (filters.activity) {
    const [type, period] = filters.activity.split('_');
    if (type === 'sms') {
      if (period === 'never') {
        q = q.is('last_sms_at', null);
      } else {
        const days = parseInt(period, 10);
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        q = q.gte('last_sms_at', cutoff);
      }
    }
  }

  if (filters.search) {
    // Strip PostgREST filter-syntax characters before interpolating into .or() string.
    const s = filters.search.toLowerCase().trim().replace(/[(),]/g, '');
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,county.ilike.%${s}%`);
    } else {
      const first = words[0];
      const last  = words.slice(1).join(' ');
      q = q.ilike('first_name', `%${first}%`).ilike('last_name', `%${last}%`);
    }
  }

  return q;
}

export const EMPTY_FILTERS = { search: '', statuses: null, counties: [], phone: '', activity: '', email: '' };

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

  // Filter state — single object so it survives contact navigation without prop drilling
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // loadingRef: synchronous guard for loadMoreContacts (state updates are async,
  // so a ref is the only reliable way to prevent concurrent fetches).
  const loadingRef  = useRef(false);
  const contactsRef = useRef([]);

  // Stable setter — both callbacks depend on it with [] dep arrays.
  const setLoading = useCallback((val) => {
    loadingRef.current = val;
    setLoadingContacts(val);
  }, []);

  const _setContacts = useCallback((updater) => {
    setContacts(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      contactsRef.current = next;
      return next;
    });
  }, []);

  const currentClient = clientsList.find(c => c.id === currentClientId) || null;

  // Reset filters when the client changes
  useEffect(() => {
    setFilters(EMPTY_FILTERS);
  }, [currentClientId]);

  const showToast = useCallback((msg, variant = 'default') => {
    setToast({ msg, variant });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const setTheme = useCallback((name) => {
    setThemeState(name);
    localStorage.setItem('taraform_theme', name);
    document.body.classList.remove('theme-dim', 'theme-light');
    if (name === 'dim') document.body.classList.add('theme-dim');
    if (name === 'light') document.body.classList.add('theme-light');
  }, []);

  // ── Load first page with filters ──────────────────────────
  const loadContacts = useCallback(async (clientId, filters = {}) => {
    if (!clientId) return;
    setLoading(true);
    try {
      const { data, count, error } = await buildQuery(clientId, filters)
        .range(0, PAGE_SIZE - 1);
      if (error) throw error;
      _setContacts((data || []).map(mapDbContact));
      setTotalCount(count || 0);
    } catch (e) {
      console.error('loadContacts error:', e);
      showToast(classifyError(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [setLoading, _setContacts, showToast]);

  // ── Load next page (append) ───────────────────────────────
  const loadMoreContacts = useCallback(async (clientId, filters = {}) => {
    if (!clientId || loadingRef.current) return;
    setLoading(true);
    try {
      const from = contactsRef.current.length;
      const { data, error } = await buildQuery(clientId, filters)
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      _setContacts(prev => [...prev, ...(data || []).map(mapDbContact)]);
    } catch (e) {
      console.error('loadMoreContacts error:', e);
      showToast(classifyError(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [setLoading, _setContacts, showToast]);

  // ── Load full contact (with JSONB) for detail view ────────
  const loadFullContact = useCallback(async (contactId) => {
    const { data, error } = await supabase
      .from('property_crm_contacts').select('*').eq('id', contactId).maybeSingle();
    if (error || !data) {
      console.error('loadFullContact contact error:', error);
      showToast(classifyError(error), 'error');
      return null;
    }
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
    _setContacts(prev => prev.map(c => c.id === full.id ? full : c));
    setCurrentContact(prev => prev?.id === full.id ? full : prev);
    return full;
  }, [_setContacts, showToast]);

  const saveContact = useCallback(async (contact) => {
    if (!user || !currentClientId) return;
    const record = mapContactToDb(contact, user.id, currentClientId);
    const { error } = await supabase.from('property_crm_contacts')
      .upsert({ ...record, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
    _setContacts(prev => {
      const idx = prev.findIndex(c => c.id === contact.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = contact; return next; }
      return [contact, ...prev];
    });
    setCurrentContact(prev => prev?.id === contact.id ? contact : prev);
  }, [user, currentClientId]); // removed currentContact dep — uses functional setState

  const deleteContact = useCallback(async (id) => {
    const { error } = await supabase.from('property_crm_contacts').delete().eq('id', id);
    if (error) throw error;
    _setContacts(prev => prev.filter(c => c.id !== id));
    setTotalCount(prev => prev - 1);
    setCurrentContact(prev => prev?.id === id ? null : prev);
  }, [_setContacts]);

  const contextValue = useMemo(() => ({
    user, setUser,
    clientsList, setClientsList,
    currentClientId, setCurrentClientId,
    currentClient,
    contacts, setContacts: _setContacts,
    totalCount, setTotalCount,
    loadingContacts,
    currentContact, setCurrentContact,
    theme, setTheme,
    toast, showToast,
    loadContacts, loadMoreContacts, loadFullContact, saveContact, deleteContact,
    filters, setFilters,
  }), [user, clientsList, currentClientId, currentClient, contacts, totalCount, loadingContacts, currentContact, theme, toast, filters, showToast, setTheme, loadContacts, loadMoreContacts, loadFullContact, saveContact, deleteContact, _setContacts]);

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
