import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { AppProvider, useApp, fetchAllFilteredContacts, fetchContactsByIds } from './context/AppContext';
import LoginScreen from './components/auth/LoginScreen';
import Header from './components/layout/Header';
import ContactList from './components/contacts/ContactList';
import ContactDetail from './components/contacts/ContactDetail';
import AddContactModal from './components/modals/AddContactModal';
import ImportModal from './components/modals/ImportModal';
import Dashboard from './components/Dashboard';
import Toast from './components/shared/Toast';
import ErrorBoundary from './components/shared/ErrorBoundary';

function hasActiveFilters(f) {
  if (!f) return false;
  return !!(f.search || (f.statuses !== null) || (f.counties?.length) || f.phone || f.email || f.activity);
}

// Notes live in two places: the freeform `notes` text column (written at create / CSV import,
// but never re-shown in the UI) and `activity_log` note entries (what the Notes tab reads).
// Merge both into one CSV cell, de-duped so the create-path — which writes the same text to
// both — doesn't print twice. Status/offer audit entries in the log are excluded.
function notesForExport(d) {
  const parts = [];
  const freeform = (d.notes || '').trim();
  if (freeform) parts.push(freeform);
  for (const e of (d.activity_log || [])) {
    if (!e || (e.type && e.type !== 'note')) continue;
    const t = (e.text || '').trim();
    if (t && !parts.includes(t)) parts.push(t);
  }
  return parts.join(' | ');
}

function CRM() {
  const { user, setUser, theme, setTheme, currentContact, setCurrentContact, contacts, currentClientId, loadFullContact, showToast, filters } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const showDashboard = location.pathname === '/dashboard';

  async function handleExport(selectedContacts) {
    try {
      let source;
      let filteredAll = false;
      // Both paths refetch full rows (select('*')) because the list view loads LIST_FIELDS,
      // which omits owner_address / property_addresses (and activity_log). Passing the lean
      // list objects straight through left those CSV columns blank for un-opened contacts.
      const toExportRow = d => ({
        firstName: d.first_name, lastName: d.last_name,
        phones: d.phones || [], email: d.email || '',
        county: d.county, ownerAddress: d.owner_address,
        propertyAddresses: d.property_addresses || [],
        taxMapIds: d.tax_map_ids || [], status: d.status,
        activityLog: d.activity_log || [],
        notes: notesForExport(d),
      });
      if (selectedContacts?.length) {
        const rows = await fetchContactsByIds(selectedContacts.map(c => c.id));
        source = rows.map(toExportRow);
      } else {
        if (!currentClientId) { showToast('Select a client first.', 'warning'); return; }
        // All facets (incl. phone via has_good_phone and note via last_note_at) are now
        // filtered server-side in applyContactFilters, so the export matches the list view
        // without any client-side re-filtering here.
        const rows = await fetchAllFilteredContacts(currentClientId, filters);
        source = rows.map(toExportRow);
        filteredAll = true;
      }
      if (!source.length) { showToast('No contacts to export', 'warning'); return; }
      const rows = source.map(c => [
        c.firstName, c.lastName, (c.phones||[]).join(';'), c.email || '',
        c.county, c.ownerAddress, (c.propertyAddresses||[]).join(';'),
        (c.taxMapIds||[]).join(';'), c.status, c.notes,
      ]);
      const header = 'First Name,Last Name,Phones,Email,County,Owner Address,Property Addresses,Tax Map IDs,Status,Notes';
      const csv = [header, ...rows.map(r => r.map(v => `"${(v||'').replace(/"/g,'""')}"`).join(','))].join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = selectedContacts?.length ? `taraform-selected-${selectedContacts.length}.csv` : `taraform-contacts-${source.length}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${source.length} contact${source.length !== 1 ? 's' : ''}${filteredAll && hasActiveFilters(filters) ? ' (filtered)' : ''}`, 'success');
    } catch (e) {
      console.error('Export error:', e);
      showToast('Export failed: ' + (e.message || 'unknown error'), 'error');
    }
  }

  const [authReady, setAuthReady] = useState(false);
  const [showAdd, setShowAdd]     = useState(false);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    // Apply saved theme
    const saved = localStorage.getItem('taraform_theme') || 'dark';
    setTheme(saved);
    document.body.classList.remove('theme-dim', 'theme-light');
    if (saved === 'dim') document.body.classList.add('theme-dim');
    if (saved === 'light') document.body.classList.add('theme-light');

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('[auth] getSession error:', error);
        sessionStorage.setItem('taraform_auth_error', error.message || String(error));
      }
      setUser(data.session?.user || null);
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[auth] state change:', event, session ? 'session present' : 'no session');
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Restore contact from route on deeplink or page reload
  useEffect(() => {
    const match = location.pathname.match(/^\/contact\/(\d+)$/);
    if (match && contacts.length) {
      const id = Number(match[1]);
      if (!currentContact || currentContact.id !== id) {
        const found = contacts.find(c => c.id === id);
        if (found) { setCurrentContact(found); loadFullContact(found.id); }
      }
    }
  }, [contacts, location.pathname]); // eslint-disable-line

  // Sync contact state with URL — clears overlay when user hits back
  useEffect(() => {
    const isContactRoute = /^\/contact\/\d+$/.test(location.pathname);
    if (!isContactRoute && currentContact) setCurrentContact(null);
  }, [location.pathname]); // eslint-disable-line


  if (!authReady) return null;
  if (!user) return <LoginScreen />;

  return (
    <div id="app" style={{ display: 'block' }}>
      {/* ContactDetail — shown on top when a contact is selected */}
      {currentContact && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--bg)', overflowY: 'auto' }}>
          <ErrorBoundary>
            <ContactDetail onClose={() => navigate('/')} />
          </ErrorBoundary>
          <Toast />
        </div>
      )}

      {/* Main list — always mounted so filters persist */}
      <div className="container">
        <Header
          onAddContact={() => {
            if (!currentClientId) { showToast('Select a client first.'); return; }
            setShowAdd(true);
          }}
          onImport={() => {
            if (!currentClientId) { showToast('Select a client first.'); return; }
            setShowImport(true);
          }}
          onExport={handleExport}
          onDashboard={() => {
            if (!currentClientId) { showToast('Select a client first.'); return; }
            navigate(showDashboard ? '/' : '/dashboard');
          }}
          dashboardActive={showDashboard}
        />
        {showDashboard
          ? <Dashboard onClose={() => navigate('/')} onViewContact={async c => {
              navigate('/contact/' + c.id);
              const full = await loadFullContact(c.id);
              if (full) setCurrentContact(full);
            }} />
          : <ContactList
              onView={async id => {
                const c = contacts.find(c => c.id === id);
                if (c) setCurrentContact(c); // show immediately with list data
                navigate('/contact/' + id);
                const full = await loadFullContact(id); // then enrich with full data
                if (full) setCurrentContact(full);
              }}
              onExport={handleExport}
            />
        }
      </div>
      <AddContactModal open={showAdd} onClose={() => setShowAdd(false)} />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} />
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <CRM />
      </AppProvider>
    </ErrorBoundary>
  );
}