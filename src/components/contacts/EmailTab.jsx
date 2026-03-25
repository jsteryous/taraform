import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';

const BASE = 'https://taraform-server-production.up.railway.app';

export default function EmailTab({ contact }) {
  const { currentClientId } = useApp();
  const [messages, setMessages] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [customSubject, setCustomSubject] = useState('');
  const [customBody, setCustomBody]       = useState('');
  const [mode, setMode] = useState('template'); // 'template' | 'custom'

  useEffect(() => {
    if (!currentClientId || !contact?.id) return;
    loadAll();
  }, [contact?.id, currentClientId]);

  async function loadAll() {
    setLoading(true);
    const [statusRes, templatesRes, messagesRes] = await Promise.all([
      fetch(`${BASE}/api/email/status?client_id=${currentClientId}`),
      fetch(`${BASE}/api/email/templates?client_id=${currentClientId}`),
      fetch(`${BASE}/api/email/messages?contact_id=${contact.id}&client_id=${currentClientId}`),
    ]);
    const status   = await statusRes.json();
    const tmpl     = await templatesRes.json();
    const msgs     = await messagesRes.json();
    setConnected(status.connected);
    setTemplates(Array.isArray(tmpl) ? tmpl : []);
    setMessages(Array.isArray(msgs) ? msgs : []);
    setLoading(false);
  }

  async function send() {
    if (!contact.email) return;
    setSending(true);
    try {
      let subject, body;
      if (mode === 'template') {
        const t = templates.find(t => t.id === selectedTemplate);
        if (!t) return;
        subject = t.subject;
        body    = t.body;
      } else {
        subject = customSubject;
        body    = customBody;
      }

      const res = await fetch(`${BASE}/api/email/send-one`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:   currentClientId,
          contact_id:  contact.id,
          template_id: mode === 'template' ? selectedTemplate : null,
          subject,
          body,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setCustomSubject(''); setCustomBody(''); setSelectedTemplate('');
        await loadAll();
      }
    } finally {
      setSending(false);
    }
  }

  const inp = {
    width: '100%', padding: '0.5rem 0.75rem', background: 'var(--bg)',
    border: '1px solid var(--border)', borderRadius: '6px',
    color: 'var(--text)', fontSize: '0.875rem', fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  if (loading) return <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</div>;

  if (!connected) return (
    <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
      No Outlook account connected. Go to <strong>Settings → Email Settings</strong> to connect.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* No email address warning */}
      {!contact.email && (
        <div style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '6px', padding: '0.75rem', fontSize: '0.8rem', color: '#fbbf24' }}>
          No email address on file for this contact.
        </div>
      )}

      {/* Compose */}
      {contact.email && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.875rem' }}>
            <button onClick={() => setMode('template')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem', borderRadius: '5px', border: '1px solid var(--border)', cursor: 'pointer', background: mode === 'template' ? 'var(--accent)' : 'var(--bg)', color: mode === 'template' ? 'white' : 'var(--text)', fontFamily: 'inherit' }}>Use Template</button>
            <button onClick={() => setMode('custom')} style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem', borderRadius: '5px', border: '1px solid var(--border)', cursor: 'pointer', background: mode === 'custom' ? 'var(--accent)' : 'var(--bg)', color: mode === 'custom' ? 'white' : 'var(--text)', fontFamily: 'inherit' }}>Custom</button>
          </div>

          {mode === 'template' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {templates.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No templates. Add one in Settings → Email Settings.</div>
              ) : templates.map(t => (
                <label key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', padding: '0.625rem', borderRadius: '6px', border: `1px solid ${selectedTemplate === t.id ? 'rgba(99,160,255,0.5)' : 'var(--border)'}`, background: selectedTemplate === t.id ? 'rgba(99,160,255,0.08)' : 'var(--bg)', cursor: 'pointer' }}>
                  <input type="radio" name="email_template" checked={selectedTemplate === t.id} onChange={() => setSelectedTemplate(t.id)} style={{ marginTop: '2px' }} />
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.subject}</div>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input style={inp} placeholder="Subject" value={customSubject} onChange={e => setCustomSubject(e.target.value)} />
              <textarea style={{ ...inp, minHeight: '100px', resize: 'vertical' }} placeholder="Body" value={customBody} onChange={e => setCustomBody(e.target.value)} />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>To: {contact.email}</span>
            <button
              onClick={send}
              disabled={sending || (mode === 'template' ? !selectedTemplate : (!customSubject || !customBody))}
              className="btn-small btn-primary"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {/* Message history */}
      {messages.length > 0 && (
        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginBottom: '0.5rem' }}>Sent Emails</div>
          {messages.map((m, i) => (
            <div key={i} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)' }}>{m.subject}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                  {m.sent_at ? new Date(m.sent_at).toLocaleDateString() : ''}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}