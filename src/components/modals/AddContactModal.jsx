import { useState } from 'react';
import Modal from '../shared/Modal';
import { useApp } from '../../context/AppContext';
import { normalizeCounty } from '../../lib/utils';

const COUNTIES = ['Greenville','Spartanburg','Anderson','Pickens','Cherokee','Laurens','Union','York','Chester','Oconee'];

export default function AddContactModal({ open, onClose }) {
  const { saveContact, currentClientId, contacts, currentClient } = useApp();
  const [form, setForm] = useState(defaultForm());
  const fieldDefs = currentClient?.custom_field_definitions || [];
  const visibleFields = currentClient?.visible_fields || ['county','taxMapIds','ownerAddress','propertyAddresses'];

  function defaultForm() {
    return { firstName:'', lastName:'', phones:[''], county:'', ownerAddress:'', propertyAddresses:[''], taxMapIds:[''], status:'New Lead', notes:'' };
  }

  async function handleSave(e) {
    e.preventDefault();
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
      offers: [],
      activityLog: form.notes ? [{ id: Date.now(), text: form.notes, timestamp: new Date().toISOString(), type: 'note' }] : [],
      customFields: {},
      smsStatus: 'eligible',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveContact(contact);
    setForm(defaultForm());
    onClose();
  }

  function update(field, val) { setForm(f => ({ ...f, [field]: val })); }
  function updateArr(field, i, val) { setForm(f => { const a = [...f[field]]; a[i] = val; return { ...f, [field]: a }; }); }
  function addArr(field) { setForm(f => ({ ...f, [field]: [...f[field], ''] })); }

  return (
    <Modal open={open} onClose={onClose} title="Add Contact" width="600px"
      footer={<><button onClick={onClose}>Cancel</button><button className="btn-primary" onClick={handleSave}>Save Contact</button></>}>
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
            {['New Lead','Contacted','Offer Made','Offer Rejected/NFS','UC','Closed','Dead/Pass'].map(s => <option key={s}>{s}</option>)}
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