import { useState, useRef } from 'react';
import Modal from '../shared/Modal';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../lib/supabase';

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const rows = lines.slice(1).map(line => {
    const vals = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; }
      else cur += ch;
    }
    vals.push(cur);
    return vals.map(v => v.replace(/^"|"$/g, '').trim());
  });
  return { headers, rows };
}

export default function EmailVerificationImportModal({ open, onClose }) {
  const { contacts, setContacts, currentClientId } = useApp();
  const [step, setStep]       = useState('upload'); // upload | preview | done
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef();

  function handleClose() {
    setStep('upload'); setPreview(null);
    onClose();
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { headers, rows } = parseCSV(ev.target.result);
      const h = headers.map(x => x.toLowerCase().trim());

      // Handle duplicate column names — find all indices
      const allEmailIdxs = headers.reduce((acc, hdr, i) => {
        if (hdr.toLowerCase().trim() === 'email') acc.push(i);
        return acc;
      }, []);
      const allStatusIdxs = headers.reduce((acc, hdr, i) => {
        if (hdr.toLowerCase().trim() === 'status') acc.push(i);
        return acc;
      }, []);

      // Use the FIRST Email column (Taraform's export) for matching
      const emailIdx = allEmailIdxs[0] ?? -1;
      // Use the LAST status column (Reoon's verification result)
      const reoonStatusIdx = allStatusIdxs[allStatusIdxs.length - 1] ?? -1;
      // Fallback: is_safe_to_send
      const safeIdx = h.indexOf('is_safe_to_send');

      if (emailIdx === -1) {
        alert('Could not find Email column.');
        return;
      }
      if (reoonStatusIdx === -1 && safeIdx === -1) {
        alert('Could not find a verification status column. Make sure this is a Reoon/NeverBounce export.');
        return;
      }

      const verified = [], invalid = [], skipped = [];

      for (const row of rows) {
        const email = row[emailIdx]?.trim().toLowerCase();
        if (!email) { skipped.push({ reason: 'no email' }); continue; }

        // Determine result — prefer Reoon status column
        let result = reoonStatusIdx >= 0 ? row[reoonStatusIdx]?.trim().toLowerCase() : null;
        if (!result && safeIdx >= 0) {
          result = row[safeIdx]?.trim().toLowerCase() === 'true' ? 'safe' : 'invalid';
        }

        // Match to existing contact by email (case-insensitive)
        const match = contacts.find(c => c.email?.toLowerCase() === email);
        if (!match) { skipped.push({ email, reason: 'not found in Taraform' }); continue; }

        // safe / inbox_full = verified; invalid = blocked; unknown/empty = skip
        if (result === 'safe' || result === 'inbox_full') {
          verified.push({ contact: match, email, result });
        } else if (result === 'invalid') {
          invalid.push({ contact: match, email, result });
        } else {
          skipped.push({ email, reason: `status: ${result || 'unknown'}` });
        }
      }

      setPreview({ verified, invalid, skipped });
      setStep('preview');
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    try {
      // Mark verified contacts
      for (const { contact } of preview.verified) {
        await supabase.from('property_crm_contacts')
          .update({ email_status: 'verified', updated_at: new Date().toISOString() })
          .eq('id', contact.id);
        setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, emailStatus: 'verified' } : c));
      }
      // Mark invalid contacts
      for (const { contact } of preview.invalid) {
        await supabase.from('property_crm_contacts')
          .update({ email_status: 'do_not_email', updated_at: new Date().toISOString() })
          .eq('id', contact.id);
        setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, emailStatus: 'do_not_email' } : c));
      }
      setStep('done');
    } finally {
      setImporting(false);
    }
  }

  const statBadge = (n, color, label) => (
    <div style={{ textAlign: 'center', padding: '1rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px' }}>
      <div style={{ fontSize: '2rem', fontWeight: 800, color }}>{n}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{label}</div>
    </div>
  );

  return (
    <Modal open={open} onClose={handleClose} title="✉ Import Email Verification"
      footer={
        step === 'preview'
          ? <><button onClick={() => setStep('upload')}>← Back</button>
              <button className="btn-primary" onClick={handleImport} disabled={importing}>
                {importing ? 'Updating…' : `Update ${(preview?.verified.length || 0) + (preview?.invalid.length || 0)} contacts`}
              </button></>
          : <button onClick={handleClose}>{step === 'done' ? 'Done' : 'Cancel'}</button>
      }>

      {step === 'upload' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Upload a CSV from your email verifier (NeverBounce, ZeroBounce, etc.) that includes an <code style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>is_safe_to_send</code> and <code style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>email</code> column.
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem', lineHeight: 1.7 }}>
            ✅ <strong>Safe to send</strong> → marked <code style={{ fontFamily: 'var(--mono)' }}>verified</code><br />
            ❌ <strong>Not safe</strong> → marked <code style={{ fontFamily: 'var(--mono)' }}>do_not_email</code><br />
            ⏭ <strong>No email / not found</strong> → skipped
          </div>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
          <button className="btn-primary" onClick={() => fileRef.current.click()}>
            Choose CSV File
          </button>
        </div>
      )}

      {step === 'preview' && preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
            {statBadge(preview.verified.length, '#10b981', 'Will be verified')}
            {statBadge(preview.invalid.length,  '#f87171', 'Will be blocked')}
            {statBadge(preview.skipped.length,  '#6b7280', 'Skipped')}
          </div>

          {preview.verified.length > 0 && (
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#10b981', fontFamily: 'var(--mono)', marginBottom: '0.4rem' }}>
                Verified ✅
              </div>
              {preview.verified.slice(0, 5).map(({ contact, email }, i) => (
                <div key={i} style={{ fontSize: '0.8rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                  {contact.firstName} {contact.lastName} — <span style={{ color: 'var(--text-muted)' }}>{email}</span>
                </div>
              ))}
              {preview.verified.length > 5 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>+{preview.verified.length - 5} more</div>}
            </div>
          )}

          {preview.invalid.length > 0 && (
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#f87171', fontFamily: 'var(--mono)', marginBottom: '0.4rem' }}>
                Will Block ❌
              </div>
              {preview.invalid.slice(0, 5).map(({ contact, email }, i) => (
                <div key={i} style={{ fontSize: '0.8rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                  {contact.firstName} {contact.lastName} — <span style={{ color: 'var(--text-muted)' }}>{email}</span>
                </div>
              ))}
              {preview.invalid.length > 5 && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>+{preview.invalid.length - 5} more</div>}
            </div>
          )}
        </div>
      )}

      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: '1.5rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>✅</div>
          <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.25rem' }}>Verification imported</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {preview?.verified.length} verified · {preview?.invalid.length} blocked
          </div>
        </div>
      )}
    </Modal>
  );
}