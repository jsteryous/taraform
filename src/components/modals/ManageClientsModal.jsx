import { useState } from 'react';
import Modal from '../shared/Modal';
import { useApp } from '../../context/AppContext';
import { createClient, updateClient, deleteClient, getClients } from '../../lib/api';

export default function ManageClientsModal({ open, onClose, onClientsChange }) {
  const { clientsList, setClientsList, showToast } = useApp();
  const [newName, setNewName]     = useState('');
  const [newTwilio, setNewTwilio] = useState('');
  const [activeEditor, setActiveEditor] = useState(null);

  async function refresh() {
    const clients = await getClients();
    setClientsList(clients);
    onClientsChange?.(clients);
    return clients;
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    await createClient({ name: newName.trim(), twilio_number: newTwilio.trim() || null });
    setNewName(''); setNewTwilio('');
    await refresh();
    showToast('Client created');
  }

  async function handleEdit(id) {
    const c = clientsList.find(c => c.id === id);
    const name   = prompt('Client name:', c.name);
    if (name === null) return;
    const twilio = prompt('Twilio number:', c.twilio_number || '');
    if (twilio === null) return;
    await updateClient(id, { name: name.trim(), twilio_number: twilio.trim() || null });
    await refresh();
    showToast('Client updated');
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete "${name}"?`)) return;
    await deleteClient(id);
    await refresh();
    showToast('Client deleted');
  }

  async function saveFieldDefs(clientId, defs) {
    const cleaned = defs.filter(d => d.key && d.label);
    await updateClient(clientId, { custom_field_definitions: cleaned });
    const clients = await refresh();
    showToast('Fields saved');
    return clients;
  }

  return (
    <Modal open={open} onClose={onClose} title="Clients" width="580px">
      {/* Client list */}
      <div style={{ marginBottom: '1.5rem' }}>
        {clientsList.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No clients yet.</p>
        ) : clientsList.map(c => (
          <div key={c.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '0.5rem', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 500 }}>{c.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{c.twilio_number || 'No Twilio number'}</div>
              </div>
              <button className="btn-small" onClick={() => setActiveEditor(activeEditor === c.id ? null : c.id)}
                style={activeEditor === c.id ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' } : {}}>
                Fields {(c.custom_field_definitions?.length) ? `(${c.custom_field_definitions.length})` : ''}
              </button>
              <button className="btn-small" onClick={() => handleEdit(c.id)}>Edit</button>
              <button className="btn-small btn-danger" onClick={() => handleDelete(c.id, c.name)} style={{ padding: '0.375rem 0.6rem' }}>×</button>
            </div>

            {activeEditor === c.id && (
              <FieldEditor
                client={c}
                onSave={defs => saveFieldDefs(c.id, defs)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add new client */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem' }}>Add New Client</div>
        <div className="form-grid">
          <div className="form-group full-width">
            <label>Business Name *</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Table Rock Partners" />
          </div>
          <div className="form-group full-width">
            <label>Twilio Number</label>
            <input value={newTwilio} onChange={e => setNewTwilio(e.target.value)} placeholder="+18645551234" />
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Outbound SMS will send from this number.</div>
          </div>
          <div className="form-group full-width">
            <button className="btn-primary" onClick={handleCreate}>+ Add Client</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function FieldEditor({ client, onSave }) {
  const [defs, setDefs] = useState(client.custom_field_definitions || []);

  function add() { setDefs(d => [...d, { key: '', label: '' }]); }
  function remove(i) { setDefs(d => d.filter((_, idx) => idx !== i)); }
  function updateLabel(i, val) {
    setDefs(d => d.map((def, idx) => {
      if (idx !== i) return def;
      const autoKey = !def.key ? val.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') : def.key;
      return { ...def, label: val, key: autoKey };
    }));
  }
  function updateKey(i, val) {
    setDefs(d => d.map((def, idx) => idx === i ? { ...def, key: val.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') } : def));
  }

  return (
    <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg)', borderRadius: '6px' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        These fields appear on every contact. Keys become template variables: <code style={{ background: 'var(--surface)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>{'{{key}}'}</code>
      </div>
      {defs.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>No custom fields.</div>}
      {defs.map((def, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
          <input value={def.label} onChange={e => updateLabel(i, e.target.value)} placeholder="Label (e.g. Roof Age)"
            style={{ padding: '0.4rem 0.6rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text)', fontSize: '0.8rem' }} />
          <input value={def.key} onChange={e => updateKey(i, e.target.value)} placeholder="key_name"
            style={{ padding: '0.4rem 0.6rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'var(--mono)' }} />
          <button className="btn-small btn-danger" onClick={() => remove(i)} style={{ padding: '0.3rem 0.5rem' }}>×</button>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
        <button className="btn-small" onClick={add}>+ Add Field</button>
        <button className="btn-small btn-primary" onClick={() => onSave(defs)}>Save Fields</button>
      </div>
    </div>
  );
}