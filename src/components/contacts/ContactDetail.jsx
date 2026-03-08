import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { formatPhone, getStatusClass } from '../../lib/utils';
import NotesTab from './NotesTab';
import SmsTab from './SmsTab';
import OffersTab from './OffersTab';

const STATUSES = ['New Lead','Contacted','Offer Made','Offer Rejected/NFS','UC','Closed','Dead/Pass'];

export default function ContactDetail({ onClose }) {
  const { currentContact, setCurrentContact, saveContact, deleteContact, currentClient, showToast } = useApp();
  const [tab, setTab]   = useState('notes');
  const [draft, setDraft] = useState(null);

  const fieldDefs = currentClient?.custom_field_definitions || [];

  // Show land fields only if client has them enabled (or has no custom config = legacy land client)
  const visibleFields = currentClient?.visible_fields ||
    (fieldDefs.length === 0 ? ['county', 'taxMapIds', 'ownerAddress', 'propertyAddresses'] : []);

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

  function updateCustomField(key, value) {
    const updated = {
      ...draft,
      customFields: { ...draft.customFields, [key]: value },
      updatedAt: new Date().toISOString(),
    };
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
    update('phones', phones.filter((p, i) => p || i < phones.length - 1));
  }

  function addPhone() { update('phones', [...(draft.phones || []), '']); }
  function removePhone(idx) { update('phones', (draft.phones || []).filter((_, i) => i !== idx)); }

  function updateMultiField(field, idx, val) {
    const arr = [...(draft[field] || [])];
    arr[idx] = val;
    update(field, arr.filter((v, i) => v || i < arr.length - 1));
  }
  function addToMultiField(field) { update(field, [...(draft[field] || []), '']); }
  function removeFromMultiField(field, idx) { update(field, (draft[field] || []).filter((_, i) => i !== idx)); }

  const smsStatus = currentContact.smsStatus || 'eligible';

  return (
    <div id="contactDetailPage" className="active">
      <div className="detail-page-header">
        <button className="back-btn" onClick={onClose}>← Back</button>
        <div id="pageStatusBadge">
          <div className={`status-badge ${getStatusClass(draft.status)}`}>{draft.status}</div>
        </div>
        <button className="btn-small btn-danger" onClick={handleDelete}>Delete</button>
      </div>

      <div className="detail-layout">
        {/* ── Sidebar ── */}
        <div className="detail-sidebar">
          {/* Name */}
          <div className="contact-name-header">
            <input
              className="name-input"
              value={draft.firstName || ''}
              onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))}
              onBlur={e => update('firstName', e.target.value)}
              placeholder="First"
            />
            <input
              className="name-input"
              value={draft.lastName || ''}
              onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))}
              onBlur={e => update('lastName', e.target.value)}
              placeholder="Last"
              style={{ fontWeight: 600 }}
            />
          </div>

          {/* SMS badge */}
          {smsStatus !== 'eligible' && (
            <div style={{ marginBottom: '0.75rem' }}>
              <span className={`sms-badge sms-${smsStatus}`}>SMS: {smsStatus.replace('_', ' ')}</span>
            </div>
          )}

          {/* Core fields */}
          <div className="info-section" style={{ marginTop: 0 }}>
            <div className="info-item">
              <div className="info-label">Status</div>
              <select className="detail-input" value={draft.status || 'New Lead'} onChange={e => update('status', e.target.value)}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="info-item">
              <div className="info-label">Phones</div>
              {(draft.phones?.length ? draft.phones : ['']).map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                  <input
                    type="tel"
                    value={p}
                    placeholder="(864) 555-1234"
                    style={{ flex: 1, padding: '0.2rem 0', background: 'transparent', border: 'none', borderBottom: '1px solid transparent', color: 'var(--text)', fontSize: '0.875rem' }}
                    onChange={e => updatePhone(i, e.target.value)}
                  />
                  {p && <button className="btn-small" onClick={() => { navigator.clipboard.writeText(p); showToast('Copied!'); }} style={{ padding: '0.3rem 0.5rem' }}>📋</button>}
                  <button className="btn-small btn-danger" onClick={() => removePhone(i)} style={{ padding: '0.3rem 0.5rem' }}>×</button>
                </div>
              ))}
              <button className="btn-small" onClick={addPhone} style={{ marginTop: '0.5rem', width: '100%' }}>+ Add Phone</button>
            </div>

            {/* Land fields — shown based on client config */}
            {visibleFields.includes('county') && (
              <div className="info-item">
                <div className="info-label">County</div>
                <input className="detail-input" value={draft.county || ''} onChange={e => setDraft(d => ({ ...d, county: e.target.value }))} onBlur={e => update('county', e.target.value)} />
              </div>
            )}
            {visibleFields.includes('taxMapIds') && (
              <div className="info-item">
                <div className="info-label">Tax Map IDs</div>
                {(draft.taxMapIds?.length ? draft.taxMapIds : ['']).map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                    <input value={t} onChange={e => updateMultiField('taxMapIds', i, e.target.value)} style={{ flex: 1, padding: '0.2rem 0', background: 'transparent', border: 'none', borderBottom: '1px solid transparent', color: 'var(--text)', fontSize: '0.875rem' }} />
                    <button className="btn-small btn-danger" onClick={() => removeFromMultiField('taxMapIds', i)} style={{ padding: '0.3rem 0.5rem' }}>×</button>
                  </div>
                ))}
                <button className="btn-small" onClick={() => addToMultiField('taxMapIds')} style={{ marginTop: '0.5rem', width: '100%' }}>+ Add Tax ID</button>
              </div>
            )}
          </div>

          {/* Addresses */}
          {(visibleFields.includes('ownerAddress') || visibleFields.includes('propertyAddresses')) && (
            <div className="info-section">
              <div className="info-section-title">Addresses</div>
              {visibleFields.includes('ownerAddress') && (
                <div className="info-item">
                  <div className="info-label">Owner Address</div>
                  <input className="detail-input" value={draft.ownerAddress || ''} onChange={e => setDraft(d => ({ ...d, ownerAddress: e.target.value }))} onBlur={e => update('ownerAddress', e.target.value)} />
                </div>
              )}
              {visibleFields.includes('propertyAddresses') && (
                <div className="info-item">
                  <div className="info-label">Property Addresses</div>
                  {(draft.propertyAddresses?.length ? draft.propertyAddresses : ['']).map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                      <input value={a} onChange={e => updateMultiField('propertyAddresses', i, e.target.value)} style={{ flex: 1, padding: '0.2rem 0', background: 'transparent', border: 'none', borderBottom: '1px solid transparent', color: 'var(--text)', fontSize: '0.875rem' }} />
                      <button className="btn-small btn-danger" onClick={() => removeFromMultiField('propertyAddresses', i)} style={{ padding: '0.3rem 0.5rem' }}>×</button>
                    </div>
                  ))}
                  <button className="btn-small" onClick={() => addToMultiField('propertyAddresses')} style={{ marginTop: '0.5rem', width: '100%' }}>+ Add Property</button>
                </div>
              )}
            </div>
          )}

          {/* Custom fields */}
          {fieldDefs.length > 0 && (
            <div className="info-section">
              <div className="info-section-title">Custom Fields</div>
              {fieldDefs.map(def => (
                <div key={def.key} className="info-item">
                  <div className="info-label">{def.label}</div>
                  <input
                    className="detail-input"
                    value={draft.customFields?.[def.key] || ''}
                    placeholder="—"
                    onChange={e => setDraft(d => ({ ...d, customFields: { ...d.customFields, [def.key]: e.target.value } }))}
                    onBlur={e => updateCustomField(def.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Main area ── */}
        <div className="notes-main-area">
          <div className="detail-tabs">
            {['notes', 'sms', 'offers'].map(t => (
              <button key={t} className={`detail-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                {t === 'notes' ? 'Notes & Activity' : t === 'sms' ? '💬 SMS' : 'Offers'}
              </button>
            ))}
          </div>
          {tab === 'notes'  && <NotesTab  contact={draft} onChange={update} />}
          {tab === 'sms'    && <SmsTab    contact={draft} />}
          {tab === 'offers' && <OffersTab contact={draft} onChange={update} />}
        </div>
      </div>
    </div>
  );
}