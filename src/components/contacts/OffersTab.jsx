import { useState } from 'react';
import Modal from '../shared/Modal';
import Select from '../shared/Select';
import { useApp } from '../../context/AppContext';
import { addOffer, updateOffer, deleteOffer } from '../../lib/api';
import { useConfirm } from '../shared/ConfirmDialog';

const OFFER_STATUSES = ['Pending', 'Accepted', 'Rejected', 'Countered'];

const STATUS_COLORS = {
  Pending:   '#fbbf24',
  Accepted:  '#10b981',
  Rejected:  '#f87171',
  Countered: '#60a5fa',
};

// Latest offer drives contact status. Pre-offer (New Lead, Contacted) and
// terminal (Closed, Dead/Pass) states stay manual via the header dropdown.
const OFFER_TO_CONTACT_STATUS = {
  Pending:   'Offer Made',
  Countered: 'Offer Made',
  Rejected:  'Offer Rejected/NFS',
  Accepted:  'UC',
};

function syncContactStatus(offers, onChangeMultiple) {
  if (!offers.length || !onChangeMultiple) return;
  const latest = offers[offers.length - 1];
  const next = OFFER_TO_CONTACT_STATUS[latest.status];
  if (next) onChangeMultiple({ status: next });
}

export default function OffersTab({ contact, onChangeMultiple, onOffersChange }) {
  const { loadFullContact, showToast } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({ amount: '', notes: '' });
  const [confirmRemove, ConfirmUI] = useConfirm();

  const offers = Array.isArray(contact.offers) ? contact.offers : [];

  function openAdd() {
    setEditing(null);
    setForm({ amount: '', notes: '' });
    setShowModal(true);
  }

  function openEdit(offer) {
    setEditing(offer.id);
    setForm({ amount: offer.amount, notes: offer.notes || '' });
    setShowModal(true);
  }

  async function save() {
    if (!form.amount) return;
    try {
      if (editing) {
        const existing = offers.find(o => o.id === editing);
        const next = { amount: form.amount, notes: form.notes, status: existing?.status || 'Pending' };
        await updateOffer(contact.id, editing, { ...next, clientId: contact.clientId });
        const nextOffers = offers.map(o => o.id === editing ? { ...o, ...next } : o);
        if (onOffersChange) onOffersChange(nextOffers);
        syncContactStatus(nextOffers, onChangeMultiple);
      } else {
        const next = { amount: form.amount, notes: form.notes, status: 'Pending' };
        await addOffer(contact.id, { ...next, clientId: contact.clientId });
        const tempOffer = { id: `_tmp_${crypto.randomUUID()}`, ...next, createdAt: new Date().toISOString() };
        const nextOffers = [...offers, tempOffer];
        if (onOffersChange) onOffersChange(nextOffers);
        syncContactStatus(nextOffers, onChangeMultiple);
        // Background sync to replace temp id with real DB row
        loadFullContact(contact.id).then(updated => {
          if (updated?.offers?.length) onOffersChange(updated.offers);
        });
      }
      setShowModal(false);
    } catch (e) {
      showToast('Failed to save offer: ' + e.message, 'error');
    }
  }

  async function changeStatus(offer, status) {
    if (status === offer.status) return;
    const prev = offers;
    const nextOffers = offers.map(o => o.id === offer.id ? { ...o, status } : o);
    if (onOffersChange) onOffersChange(nextOffers);
    syncContactStatus(nextOffers, onChangeMultiple);
    try {
      await updateOffer(contact.id, offer.id, {
        amount: offer.amount, notes: offer.notes || '', status, clientId: contact.clientId,
      });
    } catch (e) {
      if (onOffersChange) onOffersChange(prev);
      showToast('Failed to update status: ' + e.message, 'error');
    }
  }

  async function remove(id) {
    if (!await confirmRemove('Remove this offer?')) return;
    try {
      await deleteOffer(contact.id, id, contact.clientId);
      const nextOffers = offers.filter(o => o.id !== id);
      if (onOffersChange) onOffersChange(nextOffers);
      syncContactStatus(nextOffers, onChangeMultiple);
    } catch (e) {
      showToast('Failed to remove offer: ' + e.message, 'error');
    }
  }

  return (
    <div id="detailTabOffers">
      {ConfirmUI}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="btn-small btn-primary" onClick={openAdd}>+ Add Offer</button>
      </div>

      {offers.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No offers yet.</div>
      ) : offers.map(offer => {
        const color = STATUS_COLORS[offer.status] || 'var(--text-muted)';
        return (
          <div key={offer.id} className="offer-item">
            <div className="offer-header" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span className="offer-amount">${Number(offer.amount).toLocaleString()}</span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <Select
                value={offer.status}
                onChange={v => changeStatus(offer, v)}
                options={OFFER_STATUSES}
                emptyLabel={null}
                style={{ minWidth: '110px' }}
              />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                {offer.createdAt ? new Date(offer.createdAt).toLocaleDateString() : ''}
              </span>
            </div>
            {offer.notes && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: '0.35rem' }}>{offer.notes}</div>}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
              <button className="btn-small" onClick={() => openEdit(offer)}>Edit</button>
              <button className="btn-small btn-danger" onClick={() => remove(offer.id)}>Remove</button>
            </div>
          </div>
        );
      })}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Offer' : 'Add Offer'}
        footer={<><button onClick={() => setShowModal(false)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
        <div className="form-grid">
          <div className="form-group full-width">
            <label>Amount ($)</label>
            <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="150000" />
          </div>
          <div className="form-group full-width">
            <label>Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
          </div>
          {!editing && (
            <div className="form-group full-width" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              Status starts as <strong>Pending</strong> — change it inline on the offer row after saving.
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
