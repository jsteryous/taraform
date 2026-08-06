import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  fetchContactsPage, fetchFullContact, contactStillMatches,
  insertContact, upsertContact, deleteContactById,
} from '../lib/contacts';
import { hasActiveFilters } from '../lib/contactFilters';
import { classifyError } from '../lib/errors';

// State + orchestration only. Every query lives in src/lib/contacts.js (contacts) or
// src/lib/api.js (clients, members, offers) — don't build supabase queries in here.

// Two contexts so UI-only state changes (toast, theme) don't re-render data consumers
// and data changes don't re-render UI-only consumers (Toast).
const AppDataContext = createContext(null);
const AppUIContext   = createContext(null);

// followUp: null, or the resolved { days, statuses } config while the queue filter is
// active — carried in the filter itself so applyContactFilters stays config-free.
export const EMPTY_FILTERS = { search: '', statuses: null, counties: [], phone: '', activity: '', email: '', followUp: null };

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
  // Live filter snapshot for post-save drift checks, which run outside the render that
  // owns `filters` and must not force saveContact to change identity on every keystroke.
  const filtersRef  = useRef(filters);
  filtersRef.current = filters;

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
      const { contacts: page, count } = await fetchContactsPage(clientId, filters);
      _setContacts(page);
      setTotalCount(count);
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
      const { contacts: page } = await fetchContactsPage(clientId, filters, contactsRef.current.length);
      _setContacts(prev => [...prev, ...page]);
    } catch (e) {
      console.error('loadMoreContacts error:', e);
      showToast(classifyError(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [setLoading, _setContacts, showToast]);

  // ── Load full contact (with JSONB) for detail view ────────
  const loadFullContact = useCallback(async (contactId) => {
    try {
      const full = await fetchFullContact(contactId);
      if (!full) {
        showToast('Record not found.', 'error');
        return null;
      }
      _setContacts(prev => prev.map(c => c.id === full.id ? full : c));
      setCurrentContact(prev => prev?.id === full.id ? full : prev);
      return full;
    } catch (e) {
      console.error('loadFullContact error:', e);
      showToast(classifyError(e), 'error');
      return null;
    }
  }, [_setContacts, showToast]);

  // A row edited in the detail overlay can drift out of the active filter — status moved
  // to Dead/Pass, a note logged while the follow-up queue is showing, a number struck.
  // Ask the server, reusing the exact query the list was built from, and drop the row if
  // it no longer belongs. This replaced contactMatchesFilters, a second copy of every
  // filter predicate maintained by hand in JS.
  //
  // Deliberately NOT awaited by saveContact: the caller's "Saved" indicator shouldn't wait
  // on a cosmetic re-check, and if it fails the row simply stays put. totalCount is left
  // alone — like the old client-side filter, drift changes what's listed, not the server's
  // count for these filters.
  const dropIfDrifted = useCallback((id, clientId, filters) => {
    if (!hasActiveFilters(filters)) return; // nothing to drift out of
    contactStillMatches(id, clientId, filters)
      .then(stillMatches => {
        if (stillMatches) return;
        _setContacts(prev => prev.filter(c => c.id !== id));
      })
      .catch(e => console.error('drift re-check failed:', e));
  }, [_setContacts]);

  const saveContact = useCallback(async (contact) => {
    if (!user || !currentClientId) return;

    if (contact.id == null) {
      const saved = await insertContact(contact, user.id, currentClientId);
      _setContacts(prev => [saved, ...prev]);
      dropIfDrifted(saved.id, currentClientId, filtersRef.current);
      return saved;
    }

    await upsertContact(contact, user.id, currentClientId);
    _setContacts(prev => {
      const idx = prev.findIndex(c => c.id === contact.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = contact; return next; }
      return [contact, ...prev];
    });
    setCurrentContact(prev => prev?.id === contact.id ? contact : prev);
    dropIfDrifted(contact.id, currentClientId, filtersRef.current);
  }, [user, currentClientId, _setContacts, dropIfDrifted]);

  const deleteContact = useCallback(async (id) => {
    await deleteContactById(id);
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
