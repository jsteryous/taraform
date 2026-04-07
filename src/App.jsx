import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import { AppProvider, useApp } from './context/AppContext';
import LoginScreen from './components/auth/LoginScreen';
import Header from './components/layout/Header';
import ContactList from './components/contacts/ContactList';
import ContactDetail from './components/contacts/ContactDetail';
import AddContactModal from './components/modals/AddContactModal';
import ImportModal from './components/modals/ImportModal';
import Dashboard from './components/Dashboard';
import Toast from './components/shared/Toast';
import { mapDbContact } from './lib/utils';

function CRM() {
  const { user, setUser, theme, setTheme, currentContact, setCurrentContact, contacts, currentClientId, loadFullContact, showToast } = useApp();

  async function handleExport(selectedContacts) {
    let source = selectedContacts?.length ? selectedContacts : null;
    if (!source) {
      // Fetch all contacts for export
      const { data } = await import('./lib/supabase').then(m =>
        m.supabase.from('property_crm_contacts')
          .select('*')
          .eq('client_id', currentClientId)
          .order('updated_at', { ascending: false })
      );
      source = (data || []).map(d => ({
        firstName: d.first_name, lastName: d.last_name,
        phones: d.phones || [], email: d.email || '',
        county: d.county, ownerAddress: d.owner_address,
        propertyAddresses: d.property_addresses || [],
        taxMapIds: d.tax_map_ids || [], status: d.status, smsStatus: d.sms_status,
      }));
    }
    const rows = source.map(c => [
      c.firstName, c.lastName, (c.phones||[]).join(';'), c.email || '',
      c.county, c.ownerAddress, (c.propertyAddresses||[]).join(';'),
      (c.taxMapIds||[]).join(';'), c.status, c.smsStatus,
    ]);
    const header = 'First Name,Last Name,Phones,Email,County,Owner Address,Property Addresses,Tax Map IDs,Status,SMS Status';
    const csv = [header, ...rows.map(r => r.map(v => `"${(v||'').replace(/"/g,'""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = selectedContacts?.length ? `taraform-selected-${selectedContacts.length}.csv` : 'taraform-contacts.csv';
    a.click();
  }  const [authReady, setAuthReady]         = useState(false);
  const [showAdd, setShowAdd]             = useState(false);
  const [showImport, setShowImport]       = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  // Persistent filter state — survives contact navigation
  const [filterSearch,   setFilterSearch]   = useState('');
  const [filterStatuses, setFilterStatuses] = useState(null); // null = all statuses
  const [filterCounties, setFilterCounties] = useState([]);
  const [filterPhone,    setFilterPhone]    = useState('');
  const [filterActivity, setFilterActivity] = useState('');
  const [filterEmail,    setFilterEmail]    = useState('');

  useEffect(() => {
    // Apply saved theme
    const saved = localStorage.getItem('taraform_theme') || 'dark';
    setTheme(saved);
    document.body.classList.remove('theme-dim', 'theme-light');
    if (saved === 'dim') document.body.classList.add('theme-dim');
    if (saved === 'light') document.body.classList.add('theme-light');

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Handle URL contact param
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('contact');
    if (id && contacts.length) {
      const found = contacts.find(c => c.id == id);
      if (found) {
        setCurrentContact(found);
        loadFullContact(found.id);
      }
    }
  }, [contacts]);


  if (!authReady) return null;
  if (!user) return <LoginScreen />;

  return (
    <div id="app" style={{ display: 'block' }}>
      {/* ContactDetail — shown on top when a contact is selected */}
      {currentContact && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--bg)', overflowY: 'auto' }}>
          <ContactDetail onClose={() => setCurrentContact(null)} />
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
            setShowDashboard(d => !d);
          }}
          dashboardActive={showDashboard}
        />
        {showDashboard
          ? <Dashboard onClose={() => setShowDashboard(false)} onViewContact={async c => {
              setShowDashboard(false);
              const full = await loadFullContact(c.id);
              if (full) setCurrentContact(full);
            }} />
          : <ContactList
              onView={async id => {
                const c = contacts.find(c => c.id == id);
                if (c) setCurrentContact(c); // show immediately with list data
                const full = await loadFullContact(id); // then enrich with full data
                if (full) setCurrentContact(full);
              }}
              onExport={handleExport}
              filterSearch={filterSearch}
              setFilterSearch={setFilterSearch}
              filterStatuses={filterStatuses}
              setFilterStatuses={setFilterStatuses}
              filterCounties={filterCounties}
              setFilterCounties={setFilterCounties}
              filterPhone={filterPhone}
              setFilterPhone={setFilterPhone}
              filterActivity={filterActivity}
              setFilterActivity={setFilterActivity}
              filterEmail={filterEmail}
              setFilterEmail={setFilterEmail}
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
    <AppProvider>
      <CRM />
    </AppProvider>
  );
}