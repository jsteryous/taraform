import { useState, useEffect } from 'react';
import Modal from '../shared/Modal';
import { useApp } from '../../context/AppContext';
import { getEmailTemplates, sendEmailBatch } from '../../lib/api';

export default function SendEmailModal({ open, onClose, selectedContacts }) {
  const { currentClientId, showToast } = useApp();
  const [templates, setTemplates]   = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [status, setStatus]         = useState(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    if (!open || !currentClientId) return;
    setStatus(null); setTemplateId('');
    getEmailTemplates(currentClientId)
      .then(d => { setTemplates(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(e => { showToast('Failed to load templates: ' + e.message); setLoading(false); });
  }, [open, currentClientId]);

  const withEmail    = selectedContacts.filter(c => c.email);
  const withoutEmail = selectedContacts.filter(c => !c.email);

  async function send() {
    if (!templateId || withEmail.length === 0) return;
    setStatus('sending');
    try {
      const data = await sendEmailBatch({
        client_id:   currentClientId,
        contact_ids: withEmail.map(c => c.id),
        template_id: templateId,
      });
      setStatus(data);
    } catch (e) {
      showToast('Failed to send emails: ' + e.message);
      setStatus(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="✉ Send Emails"
      footer={
        status && status !== 'sending'
          ? <button className="btn-primary" onClick={onClose}>Done</button>
          : <>
              <button onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={send}
                disabled={!templateId || status === 'sending' || withEmail.length === 0}>
                {status === 'sending' ? 'Queuing…' : `Send to ${withEmail.length}`}
              </button>
            </>
      }>
      {loading ? (
        <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>Loading…</div>
      ) : status && status !== 'sending' ? (
        <div style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</div>
          <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>{status.queued} email{status.queued !== 1 ? 's' : ''} queued</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Sending in background with random delays. Check your Sent folder.
            {status.skipped > 0 && ` ${status.skipped} skipped (no email).`}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.875rem', display: 'flex', gap: '1.5rem' }}>
            <div><div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#10b981' }}>{withEmail.length}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>have email</div></div>
            {withoutEmail.length > 0 && <div><div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f87171' }}>{withoutEmail.length}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>no email — skip</div></div>}
          </div>
          {templates.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No email templates yet. Add one in Settings → Email Settings.</div>
          ) : (
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginBottom: '0.5rem' }}>Select Template</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {templates.map(t => (
                  <label key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '0.75rem', borderRadius: '8px', border: `1px solid ${templateId === t.id ? 'rgba(99,160,255,0.5)' : 'var(--border)'}`, background: templateId === t.id ? 'rgba(99,160,255,0.08)' : 'var(--bg)', cursor: 'pointer' }}>
                    <input type="radio" name="template" value={t.id} checked={templateId === t.id} onChange={() => setTemplateId(t.id)} style={{ marginTop: '2px' }} />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        {t.touch_number && <span style={{ fontSize: '0.65rem', fontFamily: 'var(--mono)', color: 'var(--accent)', background: 'rgba(99,160,255,0.1)', border: '1px solid rgba(99,160,255,0.2)', borderRadius: '4px', padding: '0.1rem 0.35rem' }}>Touch {t.touch_number}</span>}
                        <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{t.name}</span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t.subject}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}