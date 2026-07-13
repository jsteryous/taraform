import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { mapDbContact, mapContactToDb } from '../lib/utils';
import { applyContactFilters } from '../lib/contactFilters';

// Two contexts so UI-only state changes (toast, theme) don't re-render data consumers
// and data changes don't re-render UI-only consumers (Toast).
const AppDataContext = createContext(null);
const AppUIContext   = createContext(null);

// activity_log is included so the client-side note-activity filter can evaluate every
// row (not just contacts opened in the detail view). It's jsonb of short note entries —
// acceptable payload at PAGE_SIZE rows for the follow-up-queue filtering it enables.
const LIST_FIELDS = 'id,first_name,last_name,phones,email,county,status,sms_status,email_status,lead_source,contact_method,acreage,tax_map_ids,activity_log,updated_at,created_at,client_id,user_id';
const PAGE_SIZE   = 50;

// ── Error classification ──────────────────────────────────────
function classifyError(e) {
  if (!navigator.onLine) return 'You appear to be offline.';
  const status = e?.status ?? e?.code;
  if (status === 401 || status === 403) return 'Permission denied — check your access.';
  if (status === 404) return 'Record not found.';
  if (status >= 500) return 'Server error — try again later.';
  // PostgREST returns the offending detail in e.message / e.details — surface it so
  // 400s are debuggable from the toast instead of needing the Network panel.
  if (e?.message) return e.message;
  return 'Something went wrong — try again.';
}

// ── Query builder (no component state — lives outside the provider) ──
// applyContactFilters lives in src/lib/contactFilters.js so it can be unit-tested.
function buildQuery(clientId, filters = {}) {
  let q = supabase.from('property_crm_contacts')
    .select(LIST_FIELDS, { count: 'exact' })
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false });
  return applyContactFilters(q, filters);
}

// Pages through every row matching the current filters (past Supabase's 1000-row default).
// Used by Export — selects `*` because CSV needs fields outside LIST_FIELDS (owner_address,
// property_addresses, and activity_log for client-side note filtering).
export async function fetchAllFilteredContacts(clientId, filters = {}) {
  if (!clientId) return [];
  const CHUNK = 1000;
  const all = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = supabase.from('property_crm_contacts')
      .select('*')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false });
    q = applyContactFilters(q, filters);
    const { data, error } = await q.range(from, from + CHUNK - 1);
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < CHUNK) break;
    from += CHUNK;
  }
  return all;
}

// Refetches full rows (`select('*')`) for a set of ids. Used by Export Selected, whose
// source objects come from the list view (LIST_FIELDS) and therefore lack owner_address /
// property_addresses. Chunked to stay under URL-length limits on the `in` filter.
export async function fetchContactsByIds(ids) {
  if (!ids?.length) return [];
  const CHUNK = 200;
  const all = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('property_crm_contacts')
      .select('*')
      .in('id', slice);
    if (error) throw error;
    all.push(...(data || []));
  }
  return all;
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
  const [contacts, setContacts]               = useState([]);
  const [totalCount, setTotalCount]           = useState(0);
  const [loadingContacts, setLoadingContacts] = useState(false);

  // Filter state — single object so it survives contact navigation without prop drilling
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // loadingRef: synchronous guard for loadMoreContacts (state updates are async,
  // so a ref is the only reliable way to prevent concurrent fetches).
  const loadingRef  = useRef(false);
  const contactsRef = useRef([]);

  // Stable setter — callbacks depend on it with stable dep arrays.
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

  // Refresh page 1 when the tab regains focus — picks up contacts added externally
  // (LandID extension, CSV imports in another tab, etc.) without a manual reload.
  // Must come after loadContacts is declared (TDZ if placed earlier).
  useEffect(() => {
    if (!currentClientId) return;
    let lastRefresh = Date.now();
    function refresh() {
      if (document.visibilityState !== 'visible') return;
      if (loadingRef.current) return;
      const now = Date.now();
      if (now - lastRefresh < 2000) return;
      lastRefresh = now;
      loadContacts(currentClientId, filters);
    }
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [currentClientId, filters, loadContacts]);

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

    // New contact (no id): the DB owns the id (property_crm_contacts_id_seq), so
    // insert without one and read the generated row back — local state then keys
    // on the real id instead of a client-minted Date.now() that could collide.
    if (contact.id == null) {
      delete record.id;
      const { data, error } = await supabase.from('property_crm_contacts')
        .insert({ ...record, updated_at: new Date().toISOString() })
        .select().single();
      if (error) throw error;
      const saved = mapDbContact(data);
      _setContacts(prev => [saved, ...prev]);
      return saved;
    }

    // Existing contact: upsert on the known id.
    const { error } = await supabase.from('property_crm_contacts')
      .upsert({ ...record, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
    _setContacts(prev => {
      const idx = prev.findIndex(c => c.id === contact.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = contact; return next; }
      return [contact, ...prev];
    });
    setCurrentContact(prev => prev?.id === contact.id ? contact : prev);
  }, [user, currentClientId]);

  const deleteContact = useCallback(async (id) => {
    const { error } = await supabase.from('property_crm_contacts').delete().eq('id', id);
    if (error) throw error;
    _setContacts(prev => prev.filter(c => c.id !== id));
    setTotalCount(prev => prev - 1);
    setCurrentContact(prev => prev?.id === id ? null : prev);
  }, [_setContacts]);

  // ── Split context values ──────────────────────────────────
  // Data value: changes on contact/client/filter state — never on toast or theme.
  const dataValue = useMemo(() => ({
    user, setUser,
    clientsList, setClientsList,
    currentClientId, setCurrentClientId,
    currentClient,
    contacts, setContacts: _setContacts,
    totalCount, setTotalCount,
    loadingContacts,
    currentContact, setCurrentContact,
    loadContacts, loadMoreContacts, loadFullContact, saveContact, deleteContact,
    filters, setFilters,
  }), [user, clientsList, currentClientId, currentClient, contacts, totalCount,
      loadingContacts, currentContact, filters,
      loadContacts, loadMoreContacts, loadFullContact, saveContact, deleteContact, _setContacts]);

  // UI value: only changes on toast or theme — never on contact data.
  const uiValue = useMemo(() => ({
    toast, showToast, theme, setTheme,
  }), [toast, showToast, theme, setTheme]);

  return (
    <AppDataContext.Provider value={dataValue}>
      <AppUIContext.Provider value={uiValue}>
        {children}
      </AppUIContext.Provider>
    </AppDataContext.Provider>
  );
}

export const useAppData = () => useContext(AppDataContext);
export const useAppUI   = () => useContext(AppUIContext);
// Combined hook for components that need both — backwards-compatible with all existing callsites.
export const useApp     = () => ({ ...useAppData(), ...useAppUI() });
