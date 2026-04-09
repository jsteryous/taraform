import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { getStatusClass, formatPhone, parseCustomFieldDefs } from '../../lib/utils';
import { resolveConfig } from '../../lib/clientConfig';
import NotesTab from './NotesTab';
import SmsTab from './SmsTab';
import OffersTab from './OffersTab';
import EmailTab from './EmailTab';
import Select from '../shared/Select';
import { useConfirm } from '../shared/ConfirmDialog';
import { ArrowLeft, Copy, Check, MessageSquare, Mail, Trash2 } from 'lucide-react';

const SMS_STATUS_COLORS = {
  eligible: 'var(--text-muted)', contacted: 'var(--accent)',
  interested: 'var(--success)', not_interested: 'var(--text-muted)',
  do_not_contact: 'var(--danger)', unclear: 'var(--warning)',
};


export default function ContactDetail({ onClose }) {
  const { currentContact, setCurrentContact, saveContact, deleteContact, currentClient, showToast } = useApp();
  const cfg = resolveConfig(currentClient);
  const STATUSES = cfg.statuses.map(s => s.value);
  const [tab, setTab] = useState(cfg.tabs.find(t => t !== 'offers') || 'notes');
  const [draft, setDraft] = useState(null);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved'
  const saveTimer = useRef(null);
  const [confirmDelete, ConfirmUI] = useConfirm();

  const fieldDefs = parseCustomFieldDefs(currentClient?.custom_field_definitions);
  const visibleFields = cfg.visibleFields;

  useEffect(() => {
    if (currentContact) setDraft({ ...currentContact });
  }, [currentContact?.id, currentContact?.offers]);

  if (!currentContact || !draft) return null;

  function markSaved() {
    clearTimeout(saveTimer.current);
    setSaveStatus('saved');
    saveTimer.current = setTimeout(() => setSaveStatus(''), 1800);
  }

  async function update(field, value) {
    const prev = draft;
    const updated = { ...draft, [field]: value, updatedAt: new Date().toISOString() };
    setDraft(updated);
    setCurrentContact(updated);
    clearTimeout(saveTimer.current);
    setSaveStatus('saving');
    try {
      await saveContact(updated);
      markSaved();
    } catch {
      showToast('Save failed — try again', 'error');
      setSaveStatus('');
      setDraft(prev);
      setCurrentContact(prev);
    }
  }

  async function updateMultiple(fields) {
    const prev = draft;
    const updated = { ...draft, ...fields, updatedAt: new Date().toISOString() };
    setDraft(updated);
    setCurrentContact(updated);
    clearTimeout(saveTimer.current);
    setSaveStatus('saving');
    try {
      await saveContact(updated);
      markSaved();
    } catch {
      showToast('Save failed — try again', 'error');
      setSaveStatus('');
      setDraft(prev);
      setCurrentContact(prev);
    }
  }

  async function updateCustomField(key, value) {
    const prev = draft;
    const updated = { ...draft, customFields: { ...draft.customFields, [key]: value }, updatedAt: new Date().toISOString() };
    setDraft(updated);
    setCurrentContact(updated);
    clearTimeout(saveTimer.current);
    setSaveStatus('saving');
    try {
      await saveContact(updated);
      markSaved();
    } catch {
      showToast('Save failed — try again', 'error');
      setSaveStatus('');
      setDraft(prev);
      setCurrentContact(prev);
    }
  }

  async function handleDelete() {
    if (!await confirmDelete('Delete this contact? This cannot be undone.')) return;
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


  return (
    <div id="contactDetailPage" className="active">
      {ConfirmUI}
      {/* Header */}
      <div className="detail-page-header">
        <button className="back-button" onClick={onClose}><ArrowLeft size={15} /> Back</button>
        <span className={`status-badge ${getStatusClass(draft.status)}`}>{draft.status}</span>
        {saveStatus === 'saving' && <span className="save-indicator">Saving…</span>}
        {saveStatus === 'saved' && <span className="save-indicator saved"><Check size={12} /> Saved</span>}
        <button className="btn-danger-ghost" onClick={handleDelete}><Trash2 size={13} /> Delete</button>
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
              placeholder="First name"
              className="inline-input name-input"
              style={{ marginBottom: '0.25rem' }}
            />
            <input
              value={draft.lastName || ''}
              onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))}
              onBlur={e => update('lastName', e.target.value)}
              placeholder="Last name"
              className="inline-input name-input"
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
            <div className="field-label">Status</div>
            <Select value={draft.status || 'New Lead'} onChange={v => update('status', v)} options={STATUSES} emptyLabel={null} />
          </div>

          {/* Lead Source */}
          {cfg.leadSourceOptions?.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="field-label">Lead Source</div>
              <Select value={draft.leadSource || ''} onChange={v => update('leadSource', v)} options={cfg.leadSourceOptions} />
            </div>
          )}

          {/* Contact Method */}
          {cfg.contactMethodOptions?.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="field-label">Contact Method</div>
              <Select value={draft.contactMethod || ''} onChange={v => update('contactMethod', v)} options={cfg.contactMethodOptions} />
            </div>
          )}

          {/* Phones */}
          <div style={{ marginBottom: '1rem' }}>
            <div className="field-label">Phones</div>
            {(draft.phones?.length ? draft.phones : ['']).map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                <input type="tel" value={p} placeholder="(864) 555-1234"
                  className="inline-input" style={{ flex: 1 }}
                  onChange={e => {
                    const phones = [...(draft.phones || [])];
                    phones[i] = e.target.value;
                    setDraft(d => ({ ...d, phones }));
                  }}
                  onBlur={e => updatePhone(i, formatPhone(e.target.value))}
                />
                {p && <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(p); showToast('Copied!'); }} title="Copy"><Copy size={13} /></button>}
                <button className="remove-field-btn" onClick={() => removePhone(i)}>×</button>
              </div>
            ))}
            <button className="add-field-btn" onClick={addPhone}>+ Add Phone</button>
          </div>

          {/* Email */}
          <div style={{ marginBottom: '1rem' }}>
            <div className="field-label">Email</div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="email" value={draft.email || ''} placeholder="—"
                className="inline-input" style={{ flex: 1 }}
                onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                onBlur={e => update('email', e.target.value)}
              />
              {draft.email && (
                <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(draft.email); showToast('Copied!'); }} title="Copy"><Copy size={13} /></button>
              )}
            </div>
          </div>

          {/* County */}
          {visibleFields.includes('county') && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="field-label">County</div>
              <input value={draft.county || ''} className="inline-input"
                onChange={e => setDraft(d => ({ ...d, county: e.target.value }))}
                onBlur={e => update('county', e.target.value)}
                placeholder="—"
              />
            </div>
          )}

          {/* Tax Map IDs */}
          {visibleFields.includes('taxMapIds') && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="field-label">Tax Map IDs</div>
              {(draft.taxMapIds || []).filter(Boolean).map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <input value={t} className="inline-input" style={{ flex: 1 }}
                    onChange={e => {
                      const arr = [...(draft.taxMapIds || [])];
                      arr[i] = e.target.value;
                      setDraft(d => ({ ...d, taxMapIds: arr }));
                    }}
                    onBlur={e => updateMultiField('taxMapIds', i, e.target.value)}
                    placeholder="—"
                  />
                  <button className="remove-field-btn" onClick={() => removeFromMultiField('taxMapIds', i)}>×</button>
                </div>
              ))}
              <button className="add-field-btn" onClick={() => addToMultiField('taxMapIds')}>+ Add Tax ID</button>
            </div>
          )}

          {/* Acreage */}
          {visibleFields.includes('acreage') && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="field-label">Acreage</div>
              <input value={draft.acreage || ''} className="inline-input"
                onChange={e => setDraft(d => ({ ...d, acreage: e.target.value }))}
                onBlur={e => update('acreage', e.target.value)}
                placeholder="—"
              />
            </div>
          )}

          {/* Addresses section */}
          {(visibleFields.includes('ownerAddress') || visibleFields.includes('propertyAddresses')) && (
            <div className="sidebar-section">

              {visibleFields.includes('ownerAddress') && (
                <div style={{ marginBottom: '1rem' }}>
                  <div className="field-label">Owner Address</div>
                  <input value={draft.ownerAddress || ''} className="inline-input"
                    onChange={e => setDraft(d => ({ ...d, ownerAddress: e.target.value }))}
                    onBlur={e => update('ownerAddress', e.target.value)}
                    placeholder="—"
                  />
                </div>
              )}

              {visibleFields.includes('propertyAddresses') && (
                <div style={{ marginBottom: '1rem' }}>
                  <div className="field-label">Property Addresses</div>
                  {(draft.propertyAddresses || []).filter(Boolean).map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <input value={a} className="inline-input" style={{ flex: 1 }}
                        onChange={e => {
                          const arr = [...(draft.propertyAddresses || [])];
                          arr[i] = e.target.value;
                          setDraft(d => ({ ...d, propertyAddresses: arr }));
                        }}
                        onBlur={e => updateMultiField('propertyAddresses', i, e.target.value)}
                        placeholder="—"
                      />
                      <button className="remove-field-btn" onClick={() => removeFromMultiField('propertyAddresses', i)}>×</button>
                    </div>
                  ))}
                  <button className="add-field-btn" onClick={() => addToMultiField('propertyAddresses')}>+ Add Property</button>
                </div>
              )}
            </div>
          )}

          {/* Custom fields */}
          {(() => {
            const knownKeys = new Set(fieldDefs.map(d => d.key));
            const adHocKeys = Object.keys(draft.customFields || {}).filter(k => !knownKeys.has(k) && draft.customFields[k]);
            if (fieldDefs.length === 0 && adHocKeys.length === 0) return null;
            return (
              <div className="sidebar-section">
                {fieldDefs.map(def => (
                  <div key={def.key} style={{ marginBottom: '1rem' }}>
                    <div className="field-label">{def.label}</div>
                    <input value={draft.customFields?.[def.key] || ''} placeholder="—"
                      className="inline-input"
                      onChange={e => setDraft(d => ({ ...d, customFields: { ...d.customFields, [def.key]: e.target.value } }))}
                      onBlur={e => updateCustomField(def.key, e.target.value)}
                    />
                  </div>
                ))}
                {adHocKeys.map(key => (
                  <div key={key} style={{ marginBottom: '1rem' }}>
                    <div className="field-label">{key.replace(/_/g, ' ')}</div>
                    <input value={draft.customFields?.[key] || ''} placeholder="—"
                      className="inline-input"
                      onChange={e => setDraft(d => ({ ...d, customFields: { ...d.customFields, [key]: e.target.value } }))}
                      onBlur={e => updateCustomField(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* ── Main area ── */}
        <div className="notes-main-area">
          <div className="detail-tabs" role="tablist" aria-label="Contact sections">
            {cfg.tabs.filter(t => t !== 'offers').map(t => (
              <button key={t}
                role="tab"
                id={`tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`tabpanel-${t}`}
                tabIndex={tab === t ? 0 : -1}
                className={`detail-tab${tab === t ? ' active' : ''}`}
                onClick={() => setTab(t)}
                onKeyDown={e => {
                  const tabs = cfg.tabs.filter(x => x !== 'offers');
                  const idx = tabs.indexOf(t);
                  if (e.key === 'ArrowRight') { e.preventDefault(); setTab(tabs[(idx + 1) % tabs.length]); }
                  if (e.key === 'ArrowLeft')  { e.preventDefault(); setTab(tabs[(idx - 1 + tabs.length) % tabs.length]); }
                }}
              >
                {t === 'notes' ? 'Notes & Activity'
                  : t === 'sms'   ? <span className="tab-label"><MessageSquare size={13} /> SMS</span>
                  :                 <span className="tab-label"><Mail size={13} /> Email</span>}
              </button>
            ))}
          </div>
          <div role="tabpanel" id="tabpanel-notes" aria-labelledby="tab-notes" hidden={tab !== 'notes'}>
            {tab === 'notes' && <NotesTab contact={draft} onChange={update} />}
          </div>
          <div role="tabpanel" id="tabpanel-sms" aria-labelledby="tab-sms" hidden={tab !== 'sms'}>
            {tab === 'sms' && <SmsTab contact={draft} />}
          </div>
          <div role="tabpanel" id="tabpanel-email" aria-labelledby="tab-email" hidden={tab !== 'email'}>
            {tab === 'email' && <EmailTab contact={draft} />}
          </div>
        </div>

        {/* ── Offers — equal split right column ── */}
        {cfg.tabs.includes('offers') && (
          <div className="offers-column">
            <div className="offers-column-header">
              <span className="field-label">Offers</span>
              {(draft.offers || []).length > 0 && (
                <span className="offers-count">
                  {(draft.offers || []).length} offer{(draft.offers || []).length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <OffersTab contact={draft} onChange={update} onChangeMultiple={updateMultiple}
              onOffersChange={offers => setDraft(prev => ({ ...prev, offers }))} />
          </div>
        )}

      </div>
    </div>
  );
}