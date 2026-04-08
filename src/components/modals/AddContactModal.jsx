import { useState } from 'react';
import Modal from '../shared/Modal';
import { useApp } from '../../context/AppContext';
import { normalizeCounty, parseCustomFieldDefs } from '../../lib/utils';
import { resolveConfig } from '../../lib/clientConfig';

const COUNTIES = ['Greenville','Spartanburg','Anderson','Pickens','Cherokee','Laurens','Union','York','Chester','Oconee'];

function findDuplicates(contact, existing) {
  return existing.filter(c => {
    if (c.id === contact.id) return false;
    const nameMatch = contact.firstName && contact.lastName &&
      c.firstName?.toLowerCase() === contact.firstName.toLowerCase() &&
      c.lastName?.toLowerCase() === contact.lastName.toLowerCase();
    const addressMatch = contact.propertyAddresses?.length && c.propertyAddresses?.length &&
      contact.propertyAddresses.some(a1 => c.propertyAddresses.some(a2 => a1.toLowerCase() === a2.toLowerCase()));
    const taxMatch = contact.taxMapIds?.length && c.taxMapIds?.length &&
      contact.taxMapIds.some(t1 => c.taxMapIds.some(t2 => t1.toLowerCase() === t2.toLowerCase()));
    return nameMatch || addressMatch || taxMatch;
  });
}

export default function AddContactModal({ open, onClose }) {
  const { saveContact, currentClientId, contacts, currentClient } = useApp();
  const cfg = resolveConfig(currentClient);
  const visibleFields = cfg.visibleFields;
  const statuses = cfg.statuses.map(s => s.value);
  const term = cfg.terminology?.contact || 'Contact';
  const fieldDefs = parseCustomFieldDefs(currentClient?.custom_field_definitions);

  const [form, setForm] = useState(defaultForm(statuses));
  const [dupeWarning, setDupeWarning] = useState(null);

  function defaultForm(sts) {
    return { firstName:'', lastName:'', phones:[''], county:'', ownerAddress:'', propertyAddresses:[''], taxMapIds:[''], status: sts?.[0] || 'New Lead', notes:'' };
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.firstName.trim() && !form.lastName.trim()) {
      alert('Please enter at least a first or last name.');
      return;
    }
    const contact = {
      id: Date.now(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phones: form.phones.map(p => p.trim()).filter(Boolean),
      county: normalizeCounty(form.county),
      ownerAddress: form.ownerAddress.trim(),
      propertyAddresses: form.propertyAddresses.filter(Boolean),
      taxMapIds: form.taxMapIds.filter(Boolean),
      status: form.status,
      notes: form.notes.trim(),
      activityLog: form.notes ? [{ id: Date.now(), text: form.notes, timestamp: new Date().toISOString(), type: 'note' }] : [],
      customFields: {},
      smsStatus: 'eligible',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const dupes = findDuplicates(contact, contacts);
    if (dupes.length > 0 && !dupeWarning) {
      setDupeWarning({ contact, dupes });
      return;
    }

    await saveContact(contact);
    setForm(defaultForm());
    setDupeWarning(null);
    onClose();
  }

  async function confirmSaveDespiteDupe() {
    if (!dupeWarning) return;
    await saveContact(dupeWarning.contact);
    setForm(defaultForm());
    setDupeWarning(null);
    onClose();
  }

  function update(field, val) { setForm(f => ({ ...f, [field]: val })); }
  function updateArr(field, i, val) { setForm(f => { const a = [...f[field]]; a[i] = val; return { ...f, [field]: a }; }); }
  function addArr(field) { setForm(f => ({ ...f, [field]: [...f[field], ''] })); }

  return (
    <Modal open={open} onClose={() => { setDupeWarning(null); onClose(); }} title={`Add ${term}`} width="600px"
      footer={
        dupeWarning ? (
          <><button onClick={() => setDupeWarning(null)}>← Edit</button><button className="btn-primary" onClick={confirmSaveDespiteDupe}>Save Anyway</button></>
        ) : (
          <><button onClick={onClose}>Cancel</button><button className="btn-primary" onClick={handleSave}>Save Contact</button></>
        )
      }>

      {/* Duplicate warning */}
      {dupeWarning && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 600, color: '#fbbf24', marginBottom: '0.5rem' }}>⚠ Possible duplicate detected</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>This contact may already exist:</div>
          {dupeWarning.dupes.map(d => (
            <div key={d.id} style={{ fontSize: '0.875rem', padding: '0.4rem 0.6rem', background: 'var(--surface)', borderRadius: '5px', marginBottom: '0.35rem' }}>
              <strong>{d.firstName} {d.lastName}</strong>
              {d.county && <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{d.county}</span>}
              {d.taxMapIds?.[0] && <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>{d.taxMapIds[0]}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="form-grid">
        <div className="form-group">
          <label>First Name</label>
          <input value={form.firstName} onChange={e => update('firstName', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Last Name</label>
          <input value={form.lastName} onChange={e => update('lastName', e.target.value)} />
        </div>
        <div className="form-group full-width">
          <label>Phone Numbers</label>
          {form.phones.map((p, i) => (
            <input key={i} type="tel" value={p} onChange={e => updateArr('phones', i, e.target.value)}
              placeholder="(864) 555-1234" style={{ marginBottom: '0.5rem' }} />
          ))}
          <button className="btn-small" onClick={() => addArr('phones')}>+ Add Phone</button>
        </div>
        <div className="form-group">
          <label>Status</label>
          <select value={form.status} onChange={e => update('status', e.target.value)}>
            {statuses.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        {visibleFields.includes('county') && (
          <div className="form-group">
            <label>County</label>
            <select value={form.county} onChange={e => update('county', e.target.value)}>
              <option value="">-- Select county --</option>
              {COUNTIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        )}
        {visibleFields.includes('ownerAddress') && (
          <div className="form-group full-width">
            <label>Owner Address</label>
            <input value={form.ownerAddress} onChange={e => update('ownerAddress', e.target.value)} />
          </div>
        )}
        {visibleFields.includes('propertyAddresses') && (
          <div className="form-group full-width">
            <label>Property Addresses</label>
            {form.propertyAddresses.map((a, i) => (
              <input key={i} value={a} onChange={e => updateArr('propertyAddresses', i, e.target.value)} style={{ marginBottom: '0.5rem' }} />
            ))}
            <button className="btn-small" onClick={() => addArr('propertyAddresses')}>+ Add Address</button>
          </div>
        )}
        {visibleFields.includes('taxMapIds') && (
          <div className="form-group full-width">
            <label>Tax Map IDs</label>
            {form.taxMapIds.map((t, i) => (
              <input key={i} value={t} onChange={e => updateArr('taxMapIds', i, e.target.value)} style={{ marginBottom: '0.5rem' }} />
            ))}
            <button className="btn-small" onClick={() => addArr('taxMapIds')}>+ Add Tax ID</button>
          </div>
        )}
        <div className="form-group full-width">
          <label>Notes</label>
          <textarea value={form.notes} onChange={e => update('notes', e.target.value)} rows={3} />
        </div>
      </div>
    </Modal>
  );
}