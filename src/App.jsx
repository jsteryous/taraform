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
  const { user, setUser, theme, setTheme, currentContact, setCurrentContact, contacts, currentClientId } = useApp();
  const [authReady, setAuthReady]     = useState(false);
  const [showAdd, setShowAdd]         = useState(false);
  const [showImport, setShowImport]   = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

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
      if (found) setCurrentContact(found);
    }
  }, [contacts]);

  function handleExport() {
    const rows = contacts.map(c => [
      c.firstName, c.lastName, (c.phones||[]).join(';'), c.county,
      c.ownerAddress, (c.propertyAddresses||[]).join(';'),
      (c.taxMapIds||[]).join(';'), c.status, c.smsStatus,
    ]);
    const header = 'First Name,Last Name,Phones,County,Owner Address,Property Addresses,Tax Map IDs,Status,SMS Status';
    const csv = [header, ...rows.map(r => r.map(v => `"${(v||'').replace(/"/g,'""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'taraform-contacts.csv';
    a.click();
  }

  if (!authReady) return null;

  if (!user) return <LoginScreen />;

  if (currentContact) {
    return (
      <>
        <ContactDetail onClose={() => setCurrentContact(null)} />
        <Toast />
      </>
    );
  }

  return (
    <div id="app" style={{ display: 'block' }}>
      <div className="container">
        <Header
          onAddContact={() => {
            if (!currentClientId) { alert('Select a client first.'); return; }
            setShowAdd(true);
          }}
          onImport={() => {
            if (!currentClientId) { alert('Select a client first.'); return; }
            setShowImport(true);
          }}
          onExport={handleExport}
          onDashboard={() => {
            if (!currentClientId) { alert('Select a client first.'); return; }
            setShowDashboard(d => !d);
          }}
          dashboardActive={showDashboard}
        />
        {showDashboard
          ? <Dashboard onClose={() => setShowDashboard(false)} onViewContact={c => { setShowDashboard(false); setCurrentContact(c); }} />
          : <ContactList onView={id => {
              const c = contacts.find(c => c.id == id);
              if (c) setCurrentContact(c);
            }} />
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