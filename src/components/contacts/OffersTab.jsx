import { useState } from 'react';
import Modal from '../shared/Modal';

export default function OffersTab({ contact, onChange }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({ amount: '', status: 'Pending', notes: '' });

  const offers = contact.offers || [];

  function openAdd() {
    setEditing(null);
    setForm({ amount: '', status: 'Pending', notes: '' });
    setShowModal(true);
  }

  function openEdit(offer) {
    setEditing(offer.id);
    setForm({ amount: offer.amount, status: offer.status, notes: offer.notes || '' });
    setShowModal(true);
  }

  function save() {
    if (!form.amount) return;
    const updatedOffers = editing
      ? offers.map(o => o.id === editing ? { ...o, ...form } : o)
      : [...offers, { id: Date.now(), ...form, createdAt: new Date().toISOString() }];

    onChange('offers', updatedOffers);

    // Auto-set contact status to "Offer Made" when adding a new offer
    if (!editing) {
      onChange('status', 'Offer Made');
    }

    setShowModal(false);
  }

  function remove(id) {
    if (!confirm('Remove this offer?')) return;
    onChange('offers', offers.filter(o => o.id !== id));
  }

  const statusColors = {
    Pending:   '#fbbf24',
    Accepted:  '#10b981',
    Rejected:  '#f87171',
    Countered: '#60a5fa',
  };

  return (
    <div id="detailTabOffers">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="btn-small btn-primary" onClick={openAdd}>+ Add Offer</button>
      </div>

      {offers.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No offers yet.</div>
      ) : offers.map(offer => (
        <div key={offer.id} className="offer-item">
          <div className="offer-header" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span className="offer-amount">${Number(offer.amount).toLocaleString()}</span>
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, fontFamily: 'var(--mono)',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              color: statusColors[offer.status] || 'var(--text-muted)',
              background: `${statusColors[offer.status]}18` || 'transparent',
              border: `1px solid ${statusColors[offer.status]}44` || 'transparent',
              padding: '0.15rem 0.5rem', borderRadius: '10px',
            }}>{offer.status}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString() : ''}
            </span>
          </div>
          {offer.notes && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>{offer.notes}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <button className="btn-small" onClick={() => openEdit(offer)}>Edit</button>
            <button className="btn-small btn-danger" onClick={() => remove(offer.id)}>Remove</button>
          </div>
        </div>
      ))}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Offer' : 'Add Offer'}
        footer={<><button onClick={() => setShowModal(false)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
        <div className="form-grid">
          <div className="form-group full-width">
            <label>Amount ($)</label>
            <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="150000" />
          </div>
          <div className="form-group full-width">
            <label>Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {['Pending','Accepted','Rejected','Countered'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group full-width">
            <label>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
          </div>
        </div>
      </Modal>
    </div>
  );
}