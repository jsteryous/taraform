import { useState } from 'react';
import Select from '../shared/Select';
import { useApp } from '../../context/AppContext';
import { addOffer, updateOffer, deleteOffer } from '../../lib/api';
import { useConfirm } from '../shared/ConfirmDialog';
import { getOfferStatusColors } from '../../lib/clientConfig';

const OFFER_STATUSES = ['Pending', 'Accepted', 'Rejected', 'Countered'];

// Latest offer drives contact status. Pre-offer (New Lead, Contacted) and
// terminal (Closed, Dead/Pass) states stay manual via the header dropdown.
const OFFER_TO_CONTACT_STATUS = {
  Pending:   'Offer Made',
  Countered: 'Offer Made',
  Rejected:  'Offer Rejected/NFS',
  Accepted:  'UC',
};

export default function OffersTab({ contact, onChangeMultiple, onOffersChange }) {
  const { loadFullContact, showToast, theme } = useApp();
  const statusColors = getOfferStatusColors(theme);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState('');
  const [confirmRemove, ConfirmUI] = useConfirm();

  const offers = Array.isArray(contact.offers) ? contact.offers : [];

  // Batched local update: when the latest-offer status maps to a new contact
  // status, we MUST send both fields in a single useDraftSave call. Two
  // sequential setDraft calls race because useDraftSave reads draftRef.current
  // synchronously, so the second setDraft would clobber the first.
  function applyOffers(nextOffers) {
    const prevLatest = offers[offers.length - 1]?.status;
    const nextLatest = nextOffers[nextOffers.length - 1]?.status;
    const prevMapped = prevLatest ? OFFER_TO_CONTACT_STATUS[prevLatest] : null;
    const nextMapped = nextLatest ? OFFER_TO_CONTACT_STATUS[nextLatest] : null;

    if (nextMapped && nextMapped !== prevMapped && onChangeMultiple) {
      onChangeMultiple({ offers: nextOffers, status: nextMapped });
    } else if (onOffersChange) {
      onOffersChange(nextOffers);
    }
  }

  async function add() {
    if (!amount) return;
    try {
      const next = { amount, status: 'Pending', notes: '' };
      await addOffer(contact.id, { ...next, clientId: contact.clientId });
      const tempOffer = { id: `_tmp_${crypto.randomUUID()}`, ...next, createdAt: new Date().toISOString() };
      applyOffers([...offers, tempOffer]);
      // Background sync to replace temp id with real DB row
      loadFullContact(contact.id).then(updated => {
        if (updated?.offers?.length) onOffersChange(updated.offers);
      });
      setAdding(false);
      setAmount('');
    } catch (e) {
      showToast('Failed to add offer: ' + e.message, 'error');
    }
  }

  async function changeStatus(offer, status) {
    if (status === offer.status) return;
    const prevOffers = offers;
    const nextOffers = prevOffers.map(o => o.id === offer.id ? { ...o, status } : o);
    applyOffers(nextOffers);
    try {
      await updateOffer(contact.id, offer.id, {
        amount: offer.amount, notes: offer.notes || '', status, clientId: contact.clientId,
      });
    } catch (e) {
      if (onOffersChange) onOffersChange(prevOffers);
      showToast('Failed to update status: ' + e.message, 'error');
    }
  }

  async function remove(id) {
    if (!await confirmRemove('Remove this offer?')) return;
    try {
      await deleteOffer(contact.id, id, contact.clientId);
      applyOffers(offers.filter(o => o.id !== id));
    } catch (e) {
      showToast('Failed to remove offer: ' + e.message, 'error');
    }
  }

  function cancelAdd() {
    setAdding(false);
    setAmount('');
  }

  return (
    <div id="detailTabOffers">
      {ConfirmUI}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        {adding ? (
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>$</span>
            <input
              type="number"
              autoFocus
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  add();
                if (e.key === 'Escape') cancelAdd();
              }}
              placeholder="150000"
              className="inline-input"
              style={{ width: '130px' }}
            />
            <button className="btn-small btn-primary" onClick={add} disabled={!amount}>Save</button>
            <button className="btn-small" onClick={cancelAdd}>Cancel</button>
          </div>
        ) : (
          <button className="btn-small btn-primary" onClick={() => setAdding(true)}>+ Add Offer</button>
        )}
      </div>

      {offers.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No offers yet.</div>
      ) : offers.map(offer => {
        const color = statusColors[offer.status] || 'var(--text-muted)';
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
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
              <button className="btn-small btn-danger" onClick={() => remove(offer.id)}>Remove</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
