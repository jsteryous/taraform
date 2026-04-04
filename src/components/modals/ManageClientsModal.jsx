import { useState, useEffect } from 'react';
import Modal from '../shared/Modal';
import { useApp } from '../../context/AppContext';
import { createClient, updateClient, deleteClient, getClients, getClientUsers, addClientUser, removeClientUser } from '../../lib/api';
import { PRESET_TYPES, LAND_CONFIG, RESTAURANT_CONFIG, GENERIC_CONFIG, resolveConfig } from '../../lib/clientConfig';

const ALL_TABS      = ['notes', 'sms', 'email', 'offers'];
const TAB_LABELS    = { notes: 'Notes & Activity', sms: 'SMS', email: 'Email', offers: 'Offers' };
const ALL_FIELDS    = ['county', 'taxMapIds', 'acreage', 'ownerAddress', 'propertyAddresses'];
const FIELD_LABELS  = { county: 'County', taxMapIds: 'Tax Map IDs', acreage: 'Acreage', ownerAddress: 'Owner Address', propertyAddresses: 'Property Addresses' };
const ALL_COLUMNS   = ['name', 'phone', 'county', 'status'];
const COLUMN_LABELS = { name: 'Name', phone: 'Phone', county: 'County', status: 'Status' };
const PRESETS       = { land: LAND_CONFIG, restaurant: RESTAURANT_CONFIG, generic: GENERIC_CONFIG };

export default function ManageClientsModal({ open, onClose, onClientsChange }) {
  const { clientsList, setClientsList, showToast } = useApp();
  const [newName, setNewName]     = useState('');
  const [newTwilio, setNewTwilio] = useState('');
  const [activeEditor, setActiveEditor] = useState(null);
  const [editorTab, setEditorTab] = useState('settings');

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

  async function handleDelete(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await deleteClient(id);
      if (activeEditor === id) setActiveEditor(null);
      await refresh();
      showToast('Client deleted');
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Delete failed — check console');
    }
  }

  async function saveClientConfig(clientId, patch) {
    console.log('[ManageClients] saving client', clientId, patch);
    try {
      const result = await updateClient(clientId, patch);
      console.log('[ManageClients] save result', result);
      await refresh();
      showToast('Saved');
    } catch (err) {
      console.error('[ManageClients] save failed', err);
      showToast('Save failed — check console');
    }
  }

  function handleToggleEditor(clientId) {
    if (activeEditor === clientId) {
      setActiveEditor(null);
    } else {
      setActiveEditor(clientId);
      setEditorTab('settings');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage Clients" width="740px">
      <div style={{ marginBottom: '1.5rem' }}>
        {clientsList.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No clients yet.</p>
        ) : clientsList.map(c => (
          <div key={c.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.5rem', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                  {c.twilio_number || 'No Twilio number'} · {resolveConfig(c).terminology.contacts}
                </div>
              </div>
              <button className="btn-small"
                onClick={() => handleToggleEditor(c.id)}
                style={activeEditor === c.id ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' } : {}}>
                {activeEditor === c.id ? 'Close' : 'Configure'}
              </button>
              <button className="btn-small btn-danger" onClick={() => handleDelete(c.id, c.name)} style={{ padding: '0.375rem 0.6rem' }}>×</button>
            </div>
            {activeEditor === c.id && (
              <ClientEditor client={c} tab={editorTab} onTabChange={setEditorTab}
                onSave={patch => saveClientConfig(c.id, patch)} showToast={showToast} />
            )}
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
        <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem' }}>Add New Client</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Business Name *</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Rosso Restaurant" />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Twilio Number</label>
            <input value={newTwilio} onChange={e => setNewTwilio(e.target.value)} placeholder="+18645551234" />
          </div>
        </div>
        <button className="btn-primary" onClick={handleCreate}>+ Add Client</button>
      </div>
    </Modal>
  );
}

function ClientEditor({ client, tab, onTabChange, onSave, showToast }) {
  const EDITOR_TABS = { settings: 'Settings', fields: 'Custom Fields', members: 'Members' };
  return (
    <div style={{ marginTop: '0.75rem', background: 'var(--bg)', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {Object.entries(EDITOR_TABS).map(([key, label]) => (
          <button key={key} onClick={() => onTabChange(key)} style={{
            padding: '0.5rem 1rem', fontSize: '0.8rem', fontWeight: 600, background: 'none', border: 'none',
            borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
            color: tab === key ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--sans)',
          }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ padding: '1rem' }}>
        {tab === 'settings' && <ViewConfig client={client} onSave={onSave} />}
        {tab === 'fields'   && <FieldEditor client={client} onSave={onSave} />}
        {tab === 'members'  && <MembersEditor client={client} showToast={showToast} />}
      </div>
    </div>
  );
}

function ViewConfig({ client, onSave }) {
  const cfg = resolveConfig(client);
  const saved = client.config || {};
  const [type,     setType]     = useState(saved.type || 'land');
  const [name,     setName]     = useState(client.name || '');
  const [twilio,   setTwilio]   = useState(client.twilio_number || '');
  const [term,     setTerm]     = useState(cfg.terminology?.contact || 'Contact');
  const [statuses, setStatuses] = useState(cfg.statuses);
  const [pills,    setPills]    = useState(cfg.statsPills);
  const [tabs,     setTabs]     = useState(cfg.tabs);
  const [fields,   setFields]   = useState(cfg.visibleFields);
  const [columns,  setColumns]  = useState(cfg.listColumns || ['name','phone','status']);

  function loadPreset(newType) {
    setType(newType);
    const preset = PRESETS[newType] || PRESETS.generic;
    setStatuses(preset.statuses);
    setPills(preset.statsPills);
    setTabs(preset.tabs);
    setFields(preset.visibleFields);
    setColumns(preset.listColumns);
    setTerm(preset.terminology.contact);
  }

  function addStatus() { setStatuses(s => [...s, { value: 'New Status', color: '#6b7280' }]); }
  function removeStatus(i) { setStatuses(s => s.filter((_, idx) => idx !== i)); }
  function updateStatus(i, key, val) { setStatuses(s => s.map((st, idx) => idx === i ? { ...st, [key]: val } : st)); }

  function togglePill(status) {
    setPills(prev => {
      if (prev.some(p => p.status === status)) return prev.filter(p => p.status !== status);
      const st = statuses.find(s => s.value === status);
      const label = status === null ? 'total' : status.toLowerCase();
      return [...prev, { label, status, color: st?.color || 'var(--text)' }];
    });
  }

  function toggleTab(t) { setTabs(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]); }
  function toggleField(f) { setFields(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]); }
  function toggleColumn(c) { setColumns(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]); }

  function handleSave() {
    // Preserve custom_field_definitions when saving general settings
    const existingCustomFields = client.config?.custom_field_definitions;
    onSave({
      name: name.trim(),
      twilio_number: twilio.trim() || null,
      config: {
        type,
        terminology: { contact: term, contacts: term + 's' },
        statuses,
        statsPills: pills,
        tabs,
        visibleFields: fields,
        listColumns: columns,
        ...(existingCustomFields !== undefined ? { custom_field_definitions: existingCustomFields } : {}),
      },
    });
  }

  const sL = { fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '0.5rem', fontFamily: 'var(--mono)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Preset loader */}
      <div>
        <div style={sL}>Load Preset</div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {PRESET_TYPES.map(p => (
            <button key={p.value} className="btn-small" onClick={() => loadPreset(p.value)}
              style={type === p.value ? { background: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.5)', color: '#60a5fa' } : {}}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Basic info */}
      <div>
        <div style={sL}>Basic Info</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '0.75rem' }}>Client Name</label>
            <input value={name} onChange={e => setName(e.target.value)} style={{ fontSize: '0.8rem' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '0.75rem' }}>Twilio Number</label>
            <input value={twilio} onChange={e => setTwilio(e.target.value)} style={{ fontSize: '0.8rem', fontFamily: 'var(--mono)' }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '0.75rem' }}>Contact Term</label>
            <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Contact / Customer / Lead" style={{ fontSize: '0.8rem' }} />
          </div>
        </div>
      </div>

      {/* Statuses */}
      <div>
        <div style={sL}>Status Options</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {statuses.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.4rem', alignItems: 'center' }}>
              <input value={s.value} onChange={e => updateStatus(i, 'value', e.target.value)}
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text)' }} />
              <input type="color" value={s.color} onChange={e => updateStatus(i, 'color', e.target.value)}
                style={{ width: '32px', height: '28px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'none', padding: 0 }} />
              <button className="btn-small btn-danger" onClick={() => removeStatus(i)} style={{ padding: '0.2rem 0.4rem' }}>×</button>
            </div>
          ))}
          <button className="btn-small" onClick={addStatus} style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}>+ Add Status</button>
        </div>
      </div>

      {/* Stats pills */}
      <div>
        <div style={sL}>Stats Bar</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Which counts show at the top of the list.</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          <Chip active={pills.some(p => p.status === null)} label="Total" onChange={() => togglePill(null)} />
          {statuses.map(s => (
            <Chip key={s.value} active={pills.some(p => p.status === s.value)} label={s.value} color={s.color} onChange={() => togglePill(s.value)} />
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div>
        <div style={sL}>Contact Detail Tabs</div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {ALL_TABS.map(t => <Chip key={t} active={tabs.includes(t)} label={TAB_LABELS[t]} onChange={() => toggleTab(t)} />)}
        </div>
      </div>

      {/* Sidebar fields */}
      <div>
        <div style={sL}>Sidebar Fields</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {ALL_FIELDS.map(f => <Chip key={f} active={fields.includes(f)} label={FIELD_LABELS[f]} onChange={() => toggleField(f)} />)}
        </div>
      </div>

      {/* List columns */}
      <div>
        <div style={sL}>List Columns</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
          {ALL_COLUMNS.map(c => <Chip key={c} active={columns.includes(c)} label={COLUMN_LABELS[c]} onChange={() => toggleColumn(c)} />)}
        </div>
      </div>

      <button className="btn-primary" onClick={handleSave} style={{ alignSelf: 'flex-start' }}>Save Changes</button>
    </div>
  );
}

function Chip({ active, label, color, onChange }) {
  return (
    <button onClick={onChange} style={{
      padding: '0.3rem 0.7rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 500,
      cursor: 'pointer', fontFamily: 'var(--sans)', transition: 'all 0.15s',
      background: active ? (color ? `${color}22` : 'rgba(59,130,246,0.15)') : 'var(--surface)',
      border: `1px solid ${active ? (color || 'rgba(59,130,246,0.5)') : 'var(--border)'}`,
      color: active ? (color || '#60a5fa') : 'var(--text-muted)',
    }}>
      {active ? '✓ ' : ''}{label}
    </button>
  );
}

function MembersEditor({ client, showToast }) {
  const [members, setMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getClientUsers(client.id)
      .then(setMembers)
      .catch(() => {});
  }, [client.id]);

  async function handleInvite() {
    const email = inviteEmail.trim();
    if (!email) return;
    setLoading(true);
    try {
      await addClientUser(client.id, email);
      const updated = await getClientUsers(client.id);
      setMembers(updated);
      setInviteEmail('');
      showToast(`${email} added`);
    } catch (err) {
      showToast(err.message || 'Failed to add user');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(userId, email) {
    if (!confirm(`Remove ${email} from this client?`)) return;
    try {
      await removeClientUser(client.id, userId);
      setMembers(m => m.filter(u => u.user_id !== userId));
      showToast('Member removed');
    } catch (err) {
      showToast(err.message || 'Failed to remove user');
    }
  }

  const sL = { fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '0.5rem', fontFamily: 'var(--mono)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <div style={sL}>Current Members</div>
        {members.length === 0 ? (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No members yet.</div>
        ) : members.map(m => (
          <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
            <div>
              <span style={{ color: 'var(--text)' }}>{m.email || m.user_id}</span>
              <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', fontFamily: 'var(--mono)', color: m.role === 'owner' ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'uppercase' }}>{m.role}</span>
            </div>
            {m.role !== 'owner' && (
              <button className="btn-small btn-danger" onClick={() => handleRemove(m.user_id, m.email)} style={{ padding: '0.2rem 0.5rem' }}>Remove</button>
            )}
          </div>
        ))}
      </div>

      <div>
        <div style={sL}>Invite by Email</div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleInvite()}
            placeholder="user@example.com"
            style={{ flex: 1, fontSize: '0.85rem' }}
          />
          <button className="btn-primary btn-small" onClick={handleInvite} disabled={loading}>
            {loading ? '…' : 'Add'}
          </button>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
          User must already have a Taraform account.
        </div>
      </div>
    </div>
  );
}

function FieldEditor({ client, onSave }) {
  // custom_field_definitions lives inside config to avoid a separate DB column
  const [defs, setDefs] = useState(client.config?.custom_field_definitions || []);

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

  function handleSave() {
    const filtered = defs.filter(d => d.key && d.label);
    // Merge into config so it's stored in the config JSONB column
    onSave({ config: { ...(client.config || {}), custom_field_definitions: filtered } });
  }

  return (
    <div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        These appear on every contact sidebar. Keys become template variables: <code style={{ background: 'var(--surface)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>{'{{key}}'}</code>
      </div>
      {defs.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>No custom fields yet.</div>}
      {defs.map((def, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
          <input value={def.label} onChange={e => updateLabel(i, e.target.value)} placeholder="Label (e.g. Acreage)"
            style={{ padding: '0.4rem 0.6rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text)', fontSize: '0.8rem' }} />
          <input value={def.key} onChange={e => updateKey(i, e.target.value)} placeholder="key_name"
            style={{ padding: '0.4rem 0.6rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'var(--mono)' }} />
          <button className="btn-small btn-danger" onClick={() => remove(i)} style={{ padding: '0.3rem 0.5rem' }}>×</button>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
        <button className="btn-small" onClick={add}>+ Add Field</button>
        <button className="btn-small btn-primary" onClick={handleSave}>Save Fields</button>
      </div>
    </div>
  );
}
