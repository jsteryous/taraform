import { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';
import { getClients, putSetting, getSetting } from '../../lib/api';
import ManageClientsModal from '../modals/ManageClientsModal';
import TemplatesModal from '../modals/TemplatesModal';
import SmsSettingsModal from '../modals/SmsSettingsModal';
import EmailSettingsModal from '../modals/EmailSettingsModal';
import EmailVerificationImportModal from '../modals/EmailVerificationImportModal';
import {
  Settings, LayoutDashboard, FileText, Clock, Mail, ShieldCheck,
  Play, Pause, ChevronDown, Moon, SunMoon, Sun, Plus, LogOut,
} from 'lucide-react';

export default function Header({ onAddContact, onImport, onExport, onDashboard, dashboardActive }) {
  const { user, clientsList, setClientsList, currentClientId, setCurrentClientId, currentClient, theme, setTheme, loadContacts, showToast } = useApp();
  const [dropOpen, setDropOpen]           = useState(false);
  const [clientDropOpen, setClientDropOpen] = useState(false);
  const [themeOpen, setThemeOpen]         = useState(false);
  const [showClients, setShowClients]     = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSchedule, setShowSchedule]  = useState(false);
  const [showEmail, setShowEmail]        = useState(false);
  const [showEmailVerify, setShowEmailVerify] = useState(false);
  const [paused, setPaused]              = useState(false);
  const [emailAuto, setEmailAuto]        = useState(false);
  const dropRef = useRef(null);
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
    if (!currentClientId) return;
    getSetting('automation_paused', currentClientId)
      .then(d => setPaused(d.value === 'true'))
      .catch(() => {});
    getSetting('email_automation_enabled', currentClientId)
      .then(d => setEmailAuto(d.value === 'true'))
      .catch(() => {});
  }, [currentClientId]);

  useEffect(() => {
    function handler(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false);
      if (themeRef.current && !themeRef.current.contains(e.target)) setThemeOpen(false);
      if (clientDropRef.current && !clientDropRef.current.contains(e.target)) setClientDropOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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
              <div className={`sms-status-dot${paused ? ' paused' : ''}`} title={paused ? 'SMS paused' : 'SMS active'} />
              <div
                title={emailAuto ? 'Email automation on' : 'Email automation off'}
                onClick={async () => {
                  const next = !emailAuto;
                  setEmailAuto(next);
                  try {
                    await putSetting('email_automation_enabled', next.toString(), currentClientId);
                  } catch {
                    setEmailAuto(!next);
                    showToast('Failed to update email automation');
                  }
                }}
                style={{
                  width: '8px', height: '8px', borderRadius: '50%', cursor: 'pointer', flexShrink: 0,
                  background: emailAuto ? '#10b981' : '#6b7280',
                  boxShadow: emailAuto ? '0 0 0 2px rgba(16,185,129,0.25)' : 'none',
                  transition: 'all 0.2s',
                }}
              />
              <div ref={clientDropRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setClientDropOpen(o => !o)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: 'pointer', color: 'var(--text)', fontSize: '0.875rem', fontWeight: 500, fontFamily: 'var(--sans)', minWidth: '160px', justifyContent: 'space-between' }}
                >
                  <span>{clientsList.find(c => c.id === currentClientId)?.name || '— Select Client —'}</span>
                  <ChevronDown size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
                </button>
                {clientDropOpen && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: '200px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 600, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
                    <div style={{ padding: '0.35rem 0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', borderBottom: '1px solid var(--border)', userSelect: 'none' }}>— Select Client —</div>
                    {clientsList.map(c => (
                      <div key={c.id}
                        onClick={() => { handleClientSwitch(c.id); setClientDropOpen(false); }}
                        style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem', color: c.id === currentClientId ? 'var(--accent)' : 'var(--text)', cursor: 'pointer', fontWeight: c.id === currentClientId ? 600 : 400, background: c.id === currentClientId ? 'rgba(59,130,246,0.08)' : 'transparent' }}
                        onMouseEnter={e => { if (c.id !== currentClientId) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = c.id === currentClientId ? 'rgba(59,130,246,0.08)' : 'transparent'; }}
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
            <button onClick={onExport}>Export All</button>
            <button onClick={onDashboard}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', ...(dashboardActive ? { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.5)', color: '#818cf8' } : {}) }}>
              <LayoutDashboard size={14} /> Dashboard
            </button>
            <div ref={dropRef} className="settings-dropdown-wrap">
              <button onClick={() => setDropOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Settings size={14} /> Settings <ChevronDown size={12} style={{ opacity: 0.6 }} /></button>
              {dropOpen && (
                <div className="settings-dropdown-menu open">
                  <button onClick={() => { setShowTemplates(true); setDropOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><FileText size={14} /> SMS Templates</button>
                  <button onClick={() => { setShowSchedule(true); setDropOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Clock size={14} /> SMS Schedule</button>
                  <button onClick={() => { setShowEmail(true); setDropOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Mail size={14} /> Email Settings</button>
                  <button onClick={() => { setShowEmailVerify(true); setDropOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><ShieldCheck size={14} /> Import Email Verification</button>
                  <hr className="menu-divider" />
                  <button onClick={async () => {
                    const next = !paused;
                    setPaused(next); setDropOpen(false);
                    try {
                      await putSetting('automation_paused', next.toString(), currentClientId);
                    } catch {
                      setPaused(!next);
                      showToast('Failed to update SMS automation');
                    }
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>{paused ? <Play size={14} /> : <Pause size={14} />} {paused ? 'Resume SMS' : 'Pause SMS'}</span>
                  </button>
                  <button onClick={async () => {
                    const next = !emailAuto;
                    setEmailAuto(next); setDropOpen(false);
                    try {
                      await putSetting('email_automation_enabled', next.toString(), currentClientId);
                    } catch {
                      setEmailAuto(!next);
                      showToast('Failed to update email automation');
                    }
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>{emailAuto ? <Pause size={14} /> : <Play size={14} />} {emailAuto ? 'Pause Email' : 'Resume Email'}</span>
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
      <EmailSettingsModal open={showEmail} onClose={() => setShowEmail(false)} />
      <EmailVerificationImportModal open={showEmailVerify} onClose={() => setShowEmailVerify(false)} />
    </>
  );
}