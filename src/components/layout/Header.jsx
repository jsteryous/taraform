import { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { getClients, putSetting, getSetting } from '../../lib/api';
import ManageClientsModal from '../modals/ManageClientsModal';
import TemplatesModal from '../modals/TemplatesModal';
import SmsSettingsModal from '../modals/SmsSettingsModal';

export default function Header({ onAddContact, onImport, onExport }) {
  const { user, clientsList, setClientsList, currentClientId, setCurrentClientId, currentClient, theme, setTheme, loadContacts } = useApp();
  const [dropOpen, setDropOpen]           = useState(false);
  const [themeOpen, setThemeOpen]         = useState(false);
  const [showClients, setShowClients]     = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSchedule, setShowSchedule]  = useState(false);
  const [paused, setPaused]              = useState(false);
  const dropRef = useRef(null);
  const themeRef = useRef(null);

  useEffect(() => {
    getClients().then(clients => {
      setClientsList(clients);
      if (clients.length === 1 && !currentClientId) {
        setCurrentClientId(clients[0].id);
        loadContacts(clients[0].id);
      }
      if (clients.length === 0) setShowClients(true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentClientId) return;
    getSetting('automation_paused', currentClientId)
      .then(d => setPaused(d.value === 'true'))
      .catch(() => {});
  }, [currentClientId]);

  useEffect(() => {
    function handler(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false);
      if (themeRef.current && !themeRef.current.contains(e.target)) setThemeOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function handleClientSwitch(id) {
    setCurrentClientId(id);
    if (id) {
      loadContacts(id);
      getSetting('automation_paused', id).then(d => setPaused(d.value === 'true')).catch(() => {});
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  const themeIcons = { dark: '🌑', dim: '🌗', light: '☀️' };

  return (
    <>
      <header>
        <div className="header-top">
          <div className="header-left">
            <h1>Taraform</h1>
            <div className="client-switcher">
              <div className={`sms-status-dot${paused ? ' paused' : ''}`} />
              <select value={currentClientId || ''} onChange={e => handleClientSwitch(e.target.value)}>
                <option value="">— Select Client —</option>
                {clientsList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button className="client-switcher-gear" onClick={() => setShowClients(true)} title="Manage clients">⚙</button>
            </div>
          </div>
          <div className="user-info">
            <span>{user?.email}</span>
            <div ref={themeRef} style={{ position: 'relative' }}>
              <button className="theme-toggle-btn" onClick={() => setThemeOpen(o => !o)}>
                <span>{themeIcons[theme]}</span>
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
            <button className="logout-btn" onClick={handleLogout}>Sign Out</button>
          </div>
        </div>

        <div className="header-bottom">
          <div className="header-actions">
            <button className="btn-primary" onClick={onAddContact}>+ Add Contact</button>
            <button onClick={onImport}>Import CSV</button>
            <button onClick={onExport}>Export All</button>
            <div ref={dropRef} className="settings-dropdown-wrap">
              <button onClick={() => setDropOpen(o => !o)}>⚙ Settings ▾</button>
              {dropOpen && (
                <div className="settings-dropdown-menu open">
                  <button onClick={() => { setShowTemplates(true); setDropOpen(false); }}>✉ &nbsp;Templates</button>
                  <button onClick={() => { setShowSchedule(true); setDropOpen(false); }}>⏱ &nbsp;SMS Schedule</button>
                  <hr className="menu-divider" />
                  <button onClick={async () => {
                    const next = !paused;
                    await putSetting('automation_paused', next.toString(), currentClientId);
                    setPaused(next); setDropOpen(false);
                  }}>
                    {paused ? '▶  Resume SMS' : '⏸  Pause SMS'}
                  </button>
                </div>
              )}
            </div>
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
      <TemplatesModal open={showTemplates} onClose={() => setShowTemplates(false)} />
      <SmsSettingsModal open={showSchedule} onClose={() => setShowSchedule(false)} />
    </>
  );
}