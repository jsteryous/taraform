import { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { getClients } from '../../lib/api';
import ManageClientsModal from '../modals/ManageClientsModal';
import {
  Settings, LayoutDashboard, ChevronDown, Moon, SunMoon, Sun, Plus, LogOut,
} from 'lucide-react';

function hasActiveFilters(f) {
  if (!f) return false;
  return !!(f.search || (f.statuses !== null) || (f.counties?.length) || f.phone || f.email || f.activity);
}

export default function Header({ onAddContact, onImport, onExport, onDashboard, dashboardActive }) {
  const { user, clientsList, setClientsList, currentClientId, setCurrentClientId, currentClient, theme, setTheme, loadContacts, showToast, filters, totalCount } = useApp();
  const filtered = hasActiveFilters(filters);
  const [clientDropOpen, setClientDropOpen] = useState(false);
  const [themeOpen, setThemeOpen]         = useState(false);
  const [showClients, setShowClients]     = useState(false);
  const themeRef = useRef(null);
  const clientDropRef = useRef(null);

  useEffect(() => {
    getClients().then(clients => {
      setClientsList(clients);
      if (clients.length === 1 && !currentClientId) {
        setCurrentClientId(clients[0].id);
        loadContacts(clients[0].id);
      }
      if (clients.length === 0) setShowClients(true);
    }).catch(() => showToast('Failed to load clients — check your connection'));
  }, []); // eslint-disable-line

  useEffect(() => {
    function handler(e) {
      if (themeRef.current && !themeRef.current.contains(e.target)) setThemeOpen(false);
      if (clientDropRef.current && !clientDropRef.current.contains(e.target)) setClientDropOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') { setThemeOpen(false); setClientDropOpen(false); }
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  async function handleClientSwitch(id) {
    setCurrentClientId(id);
    if (id) loadContacts(id);
    // settings are re-fetched by the useEffect on currentClientId
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  const ThemeIcon = { dark: Moon, dim: SunMoon, light: Sun }[theme] || Moon;

  return (
    <>
      <header>
        <div className="header-top">
          <div className="header-left">
            <h1>Taraform</h1>
            <div className="client-switcher">
              <div ref={clientDropRef} style={{ position: 'relative' }}>
                <button className="client-drop-btn" onClick={() => setClientDropOpen(o => !o)}>
                  <span>{clientsList.find(c => c.id === currentClientId)?.name || '— Select Client —'}</span>
                  <ChevronDown size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
                </button>
                {clientDropOpen && (
                  <div className="client-drop-menu">
                    <div className="client-drop-label">— Select Client —</div>
                    {clientsList.map(c => (
                      <div key={c.id}
                        className={`client-drop-item${c.id === currentClientId ? ' active' : ''}`}
                        onClick={() => { handleClientSwitch(c.id); setClientDropOpen(false); }}
                      >
                        {c.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button className="client-switcher-gear" onClick={() => setShowClients(true)} title="Manage clients"><Settings size={14} /></button>
            </div>
          </div>
          <div className="user-info">
            <span>{user?.email}</span>
            <div ref={themeRef} style={{ position: 'relative' }}>
              <button className="theme-toggle-btn" onClick={() => setThemeOpen(o => !o)}>
                <ThemeIcon size={14} />
                <span style={{ textTransform: 'capitalize' }}>{theme}</span>
              </button>
              {themeOpen && (
                <div className="theme-panel" style={{ display: 'block' }}>
                  {['dark', 'dim', 'light'].map(t => (
                    <button key={t} className={`theme-option${theme === t ? ' active' : ''}`} onClick={() => { setTheme(t); setThemeOpen(false); }}>
                      <span className={`swatch swatch-${t}`} /> {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="logout-btn" onClick={handleLogout} title="Sign out"><LogOut size={14} /></button>
          </div>
        </div>

        <div className="header-bottom">
          <div className="header-actions">
            <button className="btn-primary" onClick={onAddContact} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Plus size={14} /> Add Contact</button>
            <button onClick={onImport}>Import CSV</button>
            <button onClick={onExport} title={filtered ? 'Exports all contacts matching your current filters' : 'Exports all contacts for this client'}>
              {currentClientId && totalCount > 0
                ? (filtered ? `Export Filtered (${totalCount})` : `Export All (${totalCount})`)
                : 'Export All'}
            </button>
            <button onClick={onDashboard}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', ...(dashboardActive ? { background: 'color-mix(in srgb, var(--accent) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--accent) 50%, transparent)', color: 'var(--accent)' } : {}) }}>
              <LayoutDashboard size={14} /> Dashboard
            </button>
          </div>
          <div id="statsBar" className="stats-bar" />
        </div>
      </header>

      <ManageClientsModal
        open={showClients}
        onClose={() => setShowClients(false)}
        onClientsChange={clients => {
          setClientsList(clients);
          if (clients.length === 1 && !currentClientId) {
            setCurrentClientId(clients[0].id);
            loadContacts(clients[0].id);
          }
        }}
      />
    </>
  );
}