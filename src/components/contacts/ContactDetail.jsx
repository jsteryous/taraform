import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { getStatusClass } from '../../lib/utils';
import { resolveConfig } from '../../lib/clientConfig';
import NotesTab from './NotesTab';
import SmsTab from './SmsTab';
import OffersTab from './OffersTab';
import EmailTab from './EmailTab';

const SMS_STATUS_COLORS = {
  eligible: 'var(--text-muted)', contacted: 'var(--accent)',
  interested: 'var(--success)', not_interested: 'var(--text-muted)',
  do_not_contact: 'var(--danger)', unclear: 'var(--warning)',
};

const fieldLabel = {
  fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.6px', color: 'var(--text-muted)', marginBottom: '0.3rem',
  fontFamily: 'var(--mono)',
};

const fieldValue = {
  fontSize: '0.875rem', color: 'var(--text)', lineHeight: 1.5,
};

export default function ContactDetail({ onClose }) {
  const { currentContact, setCurrentContact, saveContact, deleteContact, currentClient, showToast } = useApp();
  const cfg = resolveConfig(currentClient);
  const STATUSES = cfg.statuses.map(s => s.value);
  const [tab, setTab] = useState(cfg.tabs.find(t => t !== 'offers') || 'notes');
  const [draft, setDraft] = useState(null);

  const fieldDefs = currentClient?.custom_field_definitions || [];
  const visibleFields = cfg.visibleFields;

  useEffect(() => {
    if (currentContact) setDraft({ ...currentContact });
  }, [currentContact?.id]);

  if (!currentContact || !draft) return null;

  function update(field, value) {
    const updated = { ...draft, [field]: value, updatedAt: new Date().toISOString() };
    setDraft(updated);
    setCurrentContact(updated);
    saveContact(updated);
  }

  function updateMultiple(fields) {
    const updated = { ...draft, ...fields, updatedAt: new Date().toISOString() };
    setDraft(updated);
    setCurrentContact(updated);
    saveContact(updated);
  }

  function updateCustomField(key, value) {
    const updated = { ...draft, customFields: { ...draft.customFields, [key]: value }, updatedAt: new Date().toISOString() };
    setDraft(updated);
    setCurrentContact(updated);
    saveContact(updated);
  }

  async function handleDelete() {
    if (!confirm('Delete this contact?')) return;
    await deleteContact(currentContact.id);
    onClose();
  }

  function updatePhone(idx, val) {
    const phones = [...(draft.phones || [])];
    phones[idx] = val;
    update('phones', phones);
  }
  function addPhone() { update('phones', [...(draft.phones || []), '']); }
  function removePhone(idx) { update('phones', (draft.phones || []).filter((_, i) => i !== idx)); }

  function updateMultiField(field, idx, val) {
    const arr = [...(draft[field] || [])];
    arr[idx] = val;
    update(field, arr);
  }
  function addToMultiField(field) { update(field, [...(draft[field] || []), '']); }
  function removeFromMultiField(field, idx) { update(field, (draft[field] || []).filter((_, i) => i !== idx)); }

  const smsStatus = draft.smsStatus || 'eligible';
  const smsColor = SMS_STATUS_COLORS[smsStatus] || 'var(--text-muted)';

  const inlineInput = {
    background: 'transparent', border: 'none', borderBottom: '1px solid transparent',
    color: 'var(--text)', fontSize: '0.875rem', padding: '0.15rem 0',
    width: '100%', outline: 'none', fontFamily: 'inherit',
  };

  const addBtn = {
    width: '100%', marginTop: '0.4rem', padding: '0.35rem',
    fontSize: '0.75rem', background: 'var(--bg)', border: '1px dashed var(--border)',
    borderRadius: '5px', color: 'var(--text-muted)', cursor: 'pointer',
  };

  const removeBtn = {
    background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: '4px',
    color: '#f87171', cursor: 'pointer', padding: '0.2rem 0.45rem', fontSize: '0.8rem', flexShrink: 0,
  };

  return (
    <div id="contactDetailPage" className="active">
      {/* Header */}
      <div className="detail-page-header">
        <button className="back-button" onClick={onClose}>← Back</button>
        <span className={`status-badge ${getStatusClass(draft.status)}`}>{draft.status}</span>
        <button onClick={handleDelete} style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', borderRadius: '6px', padding: '0.4rem 0.875rem', cursor: 'pointer', fontSize: '0.8rem' }}>Delete</button>
      </div>

      <div className="detail-page-content">
        {/* ── Sidebar ── */}
        <div className="contact-info-sidebar">

          {/* Name */}
          <div style={{ marginBottom: '1rem' }}>
            <input
              value={draft.firstName || ''}
              onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))}
              onBlur={e => update('firstName', e.target.value)}
              onFocus={e => e.target.style.borderBottomColor = 'var(--accent)'}
              onBlurCapture={e => e.target.style.borderBottomColor = 'transparent'}
              placeholder="First name"
              style={{ ...inlineInput, fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.25rem' }}
            />
            <input
              value={draft.lastName || ''}
              onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))}
              onBlur={e => update('lastName', e.target.value)}
              onFocus={e => e.target.style.borderBottomColor = 'var(--accent)'}
              placeholder="Last name"
              style={{ ...inlineInput, fontSize: '1.3rem', fontWeight: 700 }}
            />
          </div>

          {/* SMS status pill */}
          {smsStatus !== 'eligible' && (
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600, background: `${smsColor}22`, color: smsColor, border: `1px solid ${smsColor}44`, fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                SMS · {smsStatus.replace(/_/g, ' ')}
              </span>
            </div>
          )}

          {/* Status */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={fieldLabel}>Status</div>
            <select value={draft.status || 'New Lead'} onChange={e => update('status', e.target.value)}
              style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.875rem' }}>
              {STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Lead Source */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={fieldLabel}>Lead Source</div>
            <select value={draft.leadSource || ''} onChange={e => update('leadSource', e.target.value)}
              style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.875rem' }}>
              <option value="">—</option>
              <option>Launch Control</option>
              <option>Snipe</option>
            </select>
          </div>

          {/* Contact Method */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={fieldLabel}>Contact Method</div>
            <select value={draft.contactMethod || ''} onChange={e => update('contactMethod', e.target.value)}
              style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.875rem' }}>
              <option value="">—</option>
              <option>Launch Control</option>
              <option>Manual Text</option>
              <option>Call</option>
            </select>
          </div>

          {/* Phones */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={fieldLabel}>Phones</div>
            {(draft.phones?.length ? draft.phones : ['']).map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                <input type="tel" value={p} placeholder="(864) 555-1234" style={{ ...inlineInput, flex: 1 }}
                  onChange={e => updatePhone(i, e.target.value)}
                  onFocus={e => e.target.style.borderBottomColor = 'var(--accent)'}
                  onBlur={e => { e.target.style.borderBottomColor = 'transparent'; }}
                />
                {p && <button onClick={() => { navigator.clipboard.writeText(p); showToast('Copied!'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem' }}>📋</button>}
                <button onClick={() => removePhone(i)} style={removeBtn}>×</button>
              </div>
            ))}
            <button style={addBtn} onClick={addPhone}>+ Add Phone</button>
          </div>

          {/* Email */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={fieldLabel}>Email</div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="email" value={draft.email || ''} placeholder="—"
                style={{ ...inlineInput, flex: 1 }}
                onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                onBlur={e => update('email', e.target.value)}
                onFocus={e => e.target.style.borderBottomColor = 'var(--accent)'}
              />
              {draft.email && (
                <button onClick={() => { navigator.clipboard.writeText(draft.email); showToast('Copied!'); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem' }}>📋</button>
              )}
            </div>
          </div>

          {/* County */}
          {visibleFields.includes('county') && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={fieldLabel}>County</div>
              <input value={draft.county || ''} style={{ ...inlineInput, ...fieldValue }}
                onChange={e => setDraft(d => ({ ...d, county: e.target.value }))}
                onBlur={e => update('county', e.target.value)}
                onFocus={e => e.target.style.borderBottomColor = 'var(--accent)'}
                placeholder="—"
              />
            </div>
          )}

          {/* Tax Map IDs */}
          {visibleFields.includes('taxMapIds') && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={fieldLabel}>Tax Map IDs</div>
              {(draft.taxMapIds || []).filter(Boolean).map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <input value={t} style={{ ...inlineInput, flex: 1, ...fieldValue }}
                    onChange={e => updateMultiField('taxMapIds', i, e.target.value)}
                    onFocus={e => e.target.style.borderBottomColor = 'var(--accent)'}
                    onBlur={e => e.target.style.borderBottomColor = 'transparent'}
                    placeholder="—"
                  />
                  <button onClick={() => removeFromMultiField('taxMapIds', i)} style={removeBtn}>×</button>
                </div>
              ))}
              <button style={addBtn} onClick={() => addToMultiField('taxMapIds')}>+ Add Tax ID</button>
            </div>
          )}

          {/* Addresses section */}
          {(visibleFields.includes('ownerAddress') || visibleFields.includes('propertyAddresses')) && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.875rem', marginTop: '0.25rem' }}>

              {visibleFields.includes('ownerAddress') && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={fieldLabel}>Owner Address</div>
                  <input value={draft.ownerAddress || ''} style={{ ...inlineInput, ...fieldValue }}
                    onChange={e => setDraft(d => ({ ...d, ownerAddress: e.target.value }))}
                    onBlur={e => update('ownerAddress', e.target.value)}
                    onFocus={e => e.target.style.borderBottomColor = 'var(--accent)'}
                    placeholder="—"
                  />
                </div>
              )}

              {visibleFields.includes('propertyAddresses') && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={fieldLabel}>Property Addresses</div>
                  {(draft.propertyAddresses || []).filter(Boolean).map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <input value={a} style={{ ...inlineInput, flex: 1, ...fieldValue }}
                        onChange={e => updateMultiField('propertyAddresses', i, e.target.value)}
                        onFocus={e => e.target.style.borderBottomColor = 'var(--accent)'}
                        onBlur={e => e.target.style.borderBottomColor = 'transparent'}
                        placeholder="—"
                      />
                      <button onClick={() => removeFromMultiField('propertyAddresses', i)} style={removeBtn}>×</button>
                    </div>
                  ))}
                  <button style={addBtn} onClick={() => addToMultiField('propertyAddresses')}>+ Add Property</button>
                </div>
              )}
            </div>
          )}

          {/* Custom fields */}
          {fieldDefs.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.875rem', marginTop: '0.25rem' }}>
              {fieldDefs.map(def => (
                <div key={def.key} style={{ marginBottom: '1rem' }}>
                  <div style={fieldLabel}>{def.label}</div>
                  <input value={draft.customFields?.[def.key] || ''} placeholder="—"
                    style={{ ...inlineInput, ...fieldValue }}
                    onChange={e => setDraft(d => ({ ...d, customFields: { ...d.customFields, [def.key]: e.target.value } }))}
                    onBlur={e => updateCustomField(def.key, e.target.value)}
                    onFocus={e => e.target.style.borderBottomColor = 'var(--accent)'}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Main area ── */}
        <div className="notes-main-area">
          <div className="detail-tabs">
            {cfg.tabs.filter(t => t !== 'offers').map(t => (
              <button key={t} className={`detail-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                {t === 'notes' ? 'Notes & Activity' : t === 'sms' ? '💬 SMS' : '✉ Email'}
              </button>
            ))}
          </div>
          {tab === 'notes' && <NotesTab contact={draft} onChange={update} />}
          {tab === 'sms'   && <SmsTab   contact={draft} />}
          {tab === 'email' && <EmailTab contact={draft} />}
        </div>

        {/* ── Offers — equal split right column ── */}
        {cfg.tabs.includes('offers') && (
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '1.5rem' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              height: '41px', borderBottom: '1px solid var(--border)', marginBottom: '1rem',
            }}>
              <span style={{
                fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.6px', color: 'var(--text-muted)', fontFamily: 'var(--mono)',
              }}>Offers</span>
              {(draft.offers || []).length > 0 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                  {(draft.offers || []).length} offer{(draft.offers || []).length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <OffersTab contact={draft} onChange={update} onChangeMultiple={updateMultiple} />
          </div>
        )}

      </div>
    </div>
  );
}