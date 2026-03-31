import { useState, useEffect } from 'react';
import Modal from '../shared/Modal';
import { useApp } from '../../context/AppContext';

const BASE = 'https://taraform-server-production.up.railway.app';

export default function EmailSettingsModal({ open, onClose }) {
  const { currentClientId } = useApp();
  const [connected, setConnected]         = useState(false);
  const [connEmail, setConnEmail]         = useState(null);
  const [templates, setTemplates]         = useState([]);
  const [loading, setLoading]             = useState(true);
  const [editing, setEditing]             = useState(null);
  const [form, setForm]                   = useState({ name: '', touch_number: '', subject: '', body: '' });
  const [showForm, setShowForm]           = useState(false);
  const [autoEnabled, setAutoEnabled]     = useState(false);
  const [dailyLimit, setDailyLimit]       = useState('25');
  const [savingAuto, setSavingAuto]       = useState(false);
  const [verifyJob, setVerifyJob]         = useState(null);
  const [verifying, setVerifying]         = useState(false);
  const [verifyLimit, setVerifyLimit]     = useState('100');

  useEffect(() => {
    if (!open || !currentClientId) return;
    loadAll();
  }, [open, currentClientId]);

  async function loadAll() {
    setLoading(true);
    const [statusRes, templatesRes, autoRes, limitRes, verifyRes] = await Promise.all([
      fetch(`${BASE}/api/email/status?client_id=${currentClientId}`),
      fetch(`${BASE}/api/email/templates?client_id=${currentClientId}`),
      fetch(`${BASE}/api/settings/email_automation_enabled?client_id=${currentClientId}`).catch(() => ({ json: () => ({}) })),
      fetch(`${BASE}/api/settings/email_daily_limit?client_id=${currentClientId}`).catch(() => ({ json: () => ({}) })),
      fetch(`${BASE}/api/email/verify-status?client_id=${currentClientId}`).catch(() => ({ json: () => ({}) })),
    ]);
    const status    = await statusRes.json();
    const tmpl      = await templatesRes.json();
    const autoSett  = await autoRes.json().catch(() => ({}));
    const limitSett = await limitRes.json().catch(() => ({}));
    const verify    = await verifyRes.json().catch(() => ({}));
    setConnected(status.connected);
    setConnEmail(status.email);
    setTemplates(Array.isArray(tmpl) ? tmpl : []);
    setAutoEnabled(autoSett?.value === 'true');
    setDailyLimit(limitSett?.value || '25');
    setVerifyJob(verify?.status !== 'idle' ? verify : null);
    setLoading(false);
  }

  async function connectOutlook() {
    const res = await fetch(`${BASE}/api/email/auth-url?client_id=${currentClientId}`);
    const { url } = await res.json();
    const popup = window.open(url, 'ms_auth', 'width=600,height=700,scrollbars=yes');
    const handler = async (e) => {
      if (e.data?.type === 'MS_AUTH_SUCCESS') {
        window.removeEventListener('message', handler);
        popup?.close();
        await loadAll();
      } else if (e.data?.type === 'MS_AUTH_ERROR') {
        window.removeEventListener('message', handler);
        alert('Connection failed: ' + e.data.error);
      }
    };
    window.addEventListener('message', handler);
  }

  async function disconnect() {
    if (!confirm('Disconnect Outlook?')) return;
    await fetch(`${BASE}/api/email/disconnect?client_id=${currentClientId}`, { method: 'DELETE' });
    setConnected(false); setConnEmail(null);
  }

  function openAdd() {
    setEditing(null);
    setForm({ name: '', touch_number: '', subject: '', body: '' });
    setShowForm(true);
  }

  function openEdit(t) {
    setEditing(t.id);
    setForm({ name: t.name, touch_number: t.touch_number || '', subject: t.subject, body: t.body });
    setShowForm(true);
  }

  async function saveTemplate() {
    if (!form.name || !form.subject || !form.body) return;
    if (editing) {
      const res = await fetch(`${BASE}/api/email/templates/${editing}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const updated = await res.json();
      setTemplates(ts => ts.map(t => t.id === editing ? updated : t));
    } else {
      const res = await fetch(`${BASE}/api/email/templates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, client_id: currentClientId }),
      });
      const created = await res.json();
      setTemplates(ts => [...ts, created]);
    }
    setShowForm(false);
  }

  async function deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    await fetch(`${BASE}/api/email/templates/${id}`, { method: 'DELETE' });
    setTemplates(ts => ts.filter(t => t.id !== id));
  }

  async function startVerification() {
    const limit = parseInt(verifyLimit || '100', 10);
    if (!confirm(`Verify up to ${limit} unverified emails using Reoon? This uses ${limit} credits.`)) return;
    setVerifying(true);
    try {
      const res = await fetch(`${BASE}/api/email/verify-start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: currentClientId, limit }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setVerifyJob({ status: 'running', total: data.total, checked: 0 });
      // Poll for updates every 30s
      const TERMINAL = ['completed', 'partial', 'failed', 'timeout', 'idle'];
      const interval = setInterval(async () => {
        try {
          const r = await fetch(`${BASE}/api/email/verify-status?client_id=${currentClientId}`);
          const j = await r.json();
          setVerifyJob(j);
          if (TERMINAL.includes(j.status)) clearInterval(interval);
        } catch (e) { /* ignore */ }
      }, 10000); // poll every 10s instead of 30s
    } catch (e) {
      alert('Verification failed: ' + e.message);
    } finally {
      setVerifying(false);
    }
  }

  async function saveAutomation(enabled, limit) {
    setSavingAuto(true);
    await Promise.all([
      fetch(`${BASE}/api/settings/email_automation_enabled`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: enabled.toString(), client_id: currentClientId }),
      }),
      fetch(`${BASE}/api/settings/email_daily_limit`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: limit.toString(), client_id: currentClientId }),
      }),
    ]);
    setSavingAuto(false);
  }

  const inp = {
    width: '100%', padding: '0.5rem 0.75rem', background: 'var(--bg)',
    border: '1px solid var(--border)', borderRadius: '6px',
    color: 'var(--text)', fontSize: '0.875rem', fontFamily: 'inherit',
    boxSizing: 'border-box',
  };
  const lbl = {
    fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.5px', color: 'var(--text-muted)', fontFamily: 'var(--mono)',
    display: 'block', marginBottom: '0.4rem',
  };

  return (
    <Modal open={open} onClose={onClose} title="✉ Email Settings" maxHeight="92vh" width="600px"
      footer={<button onClick={onClose}>Close</button>}>
      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Outlook connection */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ ...lbl, marginBottom: '0.75rem' }}>Outlook Account</div>
            {connected ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                  <span style={{ fontSize: '0.875rem' }}>{connEmail || 'Connected'}</span>
                </div>
                <button onClick={disconnect} style={{ fontSize: '0.75rem', color: '#f87171', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '5px', padding: '0.3rem 0.75rem', cursor: 'pointer' }}>Disconnect</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>No account connected</span>
                <button onClick={connectOutlook} style={{ fontSize: '0.875rem', background: '#0078d4', color: 'white', border: 'none', borderRadius: '6px', padding: '0.4rem 1rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                  Connect Outlook
                </button>
              </div>
            )}
          </div>

          {/* Automation settings */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ ...lbl, marginBottom: 0 }}>Daily Automation</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <div
                  onClick={async () => {
                    const next = !autoEnabled;
                    setAutoEnabled(next);
                    await saveAutomation(next, dailyLimit);
                  }}
                  style={{
                    width: '36px', height: '20px', borderRadius: '10px', cursor: 'pointer',
                    background: autoEnabled ? '#10b981' : 'var(--border)',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    position: 'absolute', top: '2px',
                    left: autoEnabled ? '18px' : '2px',
                    width: '16px', height: '16px', borderRadius: '50%',
                    background: 'white', transition: 'left 0.2s',
                  }} />
                </div>
                <span style={{ fontSize: '0.8rem', color: autoEnabled ? '#10b981' : 'var(--text-muted)' }}>
                  {autoEnabled ? 'On' : 'Off'}
                </span>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', opacity: autoEnabled ? 1 : 0.5 }}>
              <div>
                <span style={lbl}>Emails per day</span>
                <input type="number" min="1" max="50" style={{ ...inp, width: '100%' }}
                  value={dailyLimit}
                  onChange={e => setDailyLimit(e.target.value)}
                  onBlur={() => saveAutomation(autoEnabled, dailyLimit)}
                  disabled={!autoEnabled}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Sent 8:30 AM – 5:30 PM<br />
                  Random intervals throughout day
                </div>
              </div>
            </div>

            {autoEnabled && !connected && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: '#fbbf24' }}>
                ⚠ Connect your Outlook account above for automation to work
              </div>
            )}
            {autoEnabled && connected && templates.length === 0 && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: '#fbbf24' }}>
                ⚠ Add a Touch 1 template below for automation to send
              </div>
            )}
            {savingAuto && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Saving…</div>
            )}
          </div>

          {/* Email verification */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ ...lbl, marginBottom: 0 }}>Email Verification</div>
              <button
                onClick={startVerification}
                disabled={verifying || verifyJob?.status === 'running'}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.875rem', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit', opacity: (verifying || verifyJob?.status === 'running') ? 0.6 : 1 }}
              >
                {verifying ? 'Starting…' : verifyJob?.status === 'running' ? 'Running…' : '🔍 Verify All Emails'}
              </button>
            </div>

            {verifyJob?.status !== 'running' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', flex: 1, lineHeight: 1.5 }}>
                  Only verifies <strong>unverified</strong> contacts. Set limit to match your daily credits.
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Limit:</span>
                  <input type="number" min="1" max="50000" value={verifyLimit}
                    onChange={e => setVerifyLimit(e.target.value)}
                    style={{ width: '70px', padding: '0.25rem 0.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text)', fontSize: '0.8rem', fontFamily: 'inherit' }}
                  />
                </div>
              </div>
            )}

            {verifyJob?.status === 'running' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.5rem' }}>
                  <div style={{
                    width: '14px', height: '14px', borderRadius: '50%',
                    border: '2px solid #6366f1', borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite', flexShrink: 0,
                  }} />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Verifying {verifyJob.total || '?'} emails… results update when complete
                  </span>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <button onClick={async () => {
                  await fetch(`${BASE}/api/email/verify-reset?client_id=${currentClientId}`, { method: 'DELETE' });
                  setVerifyJob(null);
                }} style={{ fontSize: '0.72rem', color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Job stuck? Reset and try again
                </button>
              </div>
            )}

            {(verifyJob?.status === 'completed' || verifyJob?.status === 'partial') && (
              <div style={{ fontSize: '0.8rem' }}>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: '#10b981' }}>✅ {verifyJob.verified} verified</span>
                  <span style={{ color: '#f87171' }}>❌ {verifyJob.blocked} blocked</span>
                  <span style={{ color: 'var(--text-muted)' }}>⏭ {verifyJob.skipped} unknown</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{verifyJob.completedAt ? new Date(verifyJob.completedAt).toLocaleDateString() : ''}</span>
                </div>
                <button onClick={async () => {
                  try {
                    const r = await fetch(`${BASE}/api/email/verify-reprocess`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ client_id: currentClientId }),
                    });
                    const d = await r.json();
                    if (d.error) { alert(d.error); return; }
                    setVerifyJob(prev => ({ ...prev, ...d, status: 'completed' }));
                    alert(`Done — ${d.verified} verified, ${d.blocked} blocked, ${d.skipped} unknown`);
                  } catch (e) { alert('Reprocess failed: ' + e.message); }
                }} style={{ fontSize: '0.72rem', color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  ↻ Re-fetch & apply results from Reoon
                </button>
              </div>
            )}

            {verifyJob?.status === 'failed' && (
              <div style={{ fontSize: '0.8rem' }}>
                <div style={{ color: '#f87171', marginBottom: '0.4rem' }}>⚠ Job failed: {verifyJob.reason}</div>
                <button onClick={async () => {
                  try {
                    const r = await fetch(`${BASE}/api/email/verify-reprocess`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ client_id: currentClientId }),
                    });
                    const d = await r.json();
                    if (d.error) { alert(d.error); return; }
                    setVerifyJob(prev => ({ ...prev, ...d, status: 'completed' }));
                    alert(`Done — ${d.verified} verified, ${d.blocked} blocked`);
                  } catch (e) { alert('Reprocess failed: ' + e.message); }
                }} style={{ fontSize: '0.72rem', color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  ↻ Try to re-fetch results from Reoon
                </button>
              </div>
            )}

            {verifyJob?.status === 'timeout' && (
              <div style={{ fontSize: '0.8rem', color: '#fbbf24' }}>⚠ Verification timed out — try again</div>
            )}
          </div>

          {/* Templates */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ ...lbl, marginBottom: 0 }}>Email Templates</div>
              <button className="btn-small btn-primary" onClick={openAdd}>+ Add Template</button>
            </div>

            {templates.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No templates yet.</div>
            ) : templates.map(t => (
              <div key={t.id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.875rem', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {t.touch_number && (
                      <span style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--accent)', background: 'rgba(99,160,255,0.1)', border: '1px solid rgba(99,160,255,0.2)', borderRadius: '4px', padding: '0.1rem 0.4rem' }}>
                        Touch {t.touch_number}
                      </span>
                    )}
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{t.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <button className="btn-small" onClick={() => openEdit(t)}>Edit</button>
                    <button className="btn-small btn-danger" onClick={() => deleteTemplate(t.id)}>Delete</button>
                  </div>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Subject: {t.subject}</div>
              </div>
            ))}
          </div>

          {/* Template form */}
          {showForm && (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem' }}>
                {editing ? 'Edit Template' : 'New Template'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div>
                  <span style={lbl}>Name</span>
                  <input style={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Touch 1 — Initial Outreach" />
                </div>
                <div>
                  <span style={lbl}>Touch #</span>
                  <input style={inp} type="number" value={form.touch_number} onChange={e => setForm(f => ({ ...f, touch_number: e.target.value }))} placeholder="1" />
                </div>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <span style={lbl}>Subject</span>
                <input style={inp} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Question about your land in {{county}}" />
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                <span style={lbl}>Body</span>
                <textarea style={{ ...inp, minHeight: '150px', resize: 'vertical' }} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder={'Hi {{firstName}},\n\nI came across your property in {{county}}...'} />
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.875rem', fontFamily: 'var(--mono)', lineHeight: 1.8 }}>
                {'{{firstName}} {{lastName}} {{fullName}}'}<br/>
                {'{{county}} {{acreage}}'}<br/>
                {'{{propertyAddress}} {{propertyStreet}}'}<br/>
                {'{{ownerAddress}} {{taxMapId}}'}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button className="btn-small" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn-small btn-primary" onClick={saveTemplate}>Save</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}