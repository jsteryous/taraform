import { useState, useEffect, useCallback } from 'react';
import Modal from '../shared/Modal';
import { useConfirm } from '../shared/ConfirmDialog';
import { useApp } from '../../context/AppContext';
import { fetchInbox, fetchUnrouted, markRead, optOutNumber } from '../../lib/sms';
import { MessageSquare, UserX, TriangleAlert, Ban } from 'lucide-react';

// Every reply, in one place.
//
// This exists because the per-contact Messages tab was the ONLY reader of sms_messages:
// a reply arrived and the operator found out by happening to open that contact. Two kinds
// of message were effectively invisible — replies nobody thought to go looking for, and
// replies from numbers matching no contact (contact_id null, so no per-contact query can
// ever return them).
//
// It is also the release valve for the unread-reply send block. sms_send_precheck() refuses
// to text a number with an unread inbound message, so "mark read" here is not cosmetic —
// it is what lets the next message go out, and it means a human has seen the reply first.

function relative(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function formatNumber(digits) {
  const d = (digits || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : digits;
}

export default function InboxModal({ open, onClose, onViewContact }) {
  const { currentClientId, showToast, refreshUnread } = useApp();
  const [confirmOptOut, ConfirmUI] = useConfirm();
  const [rows, setRows] = useState([]);
  const [unrouted, setUnrouted] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!currentClientId) return;
    setLoading(true);
    try {
      // Unrouted is a separate read because those rows have no client to scope them to;
      // an error there must not blank the inbox itself.
      const [inbox, dead] = await Promise.all([
        fetchInbox(currentClientId),
        fetchUnrouted().catch(() => []),
      ]);
      setRows(inbox);
      setUnrouted(dead);
    } catch (e) {
      showToast(`Couldn't load the inbox: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [currentClientId, showToast]);

  useEffect(() => { if (open) reload(); }, [open, reload]);

  async function handleMarkAllRead() {
    const ids = rows.filter(r => !r.read_at).map(r => r.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      await markRead(ids);
      await reload();
      refreshUnread();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleOptOut(phone) {
    if (!await confirmOptOut(
      `Stop all texting to ${formatNumber(phone)}? This covers every contact with this number and cannot be undone here.`
    )) return;
    try {
      const ok = await optOutNumber(phone, 'opted out from the inbox');
      if (!ok) { showToast('That number is not on any of your contacts.', 'error'); return; }
      showToast('Opted out — this number will never be texted again.');
      await reload();
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  async function handleOpen(row) {
    // Opening the contact is the normal way a reply gets read; SmsTab marks the thread read
    // when it loads, which is also what clears the send block.
    if (!row.contact_id) {
      showToast('This reply came from a number that is not on any contact.', 'warning');
      return;
    }
    onClose();
    onViewContact(row.contact_id);
  }

  const unread = rows.filter(r => !r.read_at).length;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`Inbox${unread ? ` · ${unread} unread` : ''}`}
        width="680px"
        footer={
          <button onClick={handleMarkAllRead} disabled={busy || !unread}>
            Mark all read
          </button>
        }
      >
        {loading && <div className="sms-empty">Loading…</div>}

        {!loading && !rows.length && !unrouted.length && (
          <div className="sms-empty">
            <MessageSquare size={16} style={{ opacity: 0.5 }} />
            <div style={{ marginTop: '0.5rem' }}>No replies yet.</div>
          </div>
        )}

        {!loading && unrouted.length > 0 && (
          <div className="inbox-unrouted">
            <div className="inbox-unrouted-head">
              <TriangleAlert size={13} />
              <span>
                {unrouted.length} repl{unrouted.length === 1 ? 'y' : 'ies'} arrived on a number no
                client owns. Set the sending number in Manage Clients so these route properly.
              </span>
            </div>
            {unrouted.map(u => (
              <div key={`u${u.id}`} className="inbox-row inbox-row-dead">
                <div className="inbox-row-main">
                  <div className="inbox-row-top">
                    <span className="inbox-name">{formatNumber(u.from_number)}</span>
                    <span className="inbox-time">{relative(u.created_at)}</span>
                  </div>
                  <div className="inbox-body">{u.body}</div>
                </div>
                {u.was_stop && <span className="inbox-tag inbox-tag-stop"><Ban size={11} /> opted out</span>}
              </div>
            ))}
          </div>
        )}

        {!loading && rows.map(r => (
          <div key={r.id} className={`inbox-row${r.read_at ? '' : ' inbox-row-unread'}`}>
            <div
              className="inbox-row-main"
              role="button"
              tabIndex={0}
              onClick={() => handleOpen(r)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(r); } }}
            >
              <div className="inbox-row-top">
                {!r.read_at && <span className="inbox-dot" aria-label="unread" />}
                <span className="inbox-name">
                  {r.contact_name || formatNumber(r.peer_number)}
                </span>
                {!r.contact_name && <span className="inbox-tag">no contact</span>}
                {r.opted_out && <span className="inbox-tag inbox-tag-stop"><Ban size={11} /> opted out</span>}
                <span className="inbox-time">{relative(r.created_at)}</span>
              </div>
              <div className="inbox-body">{r.body}</div>
            </div>
            {!r.opted_out && (
              <button
                type="button"
                className="sms-optout-btn"
                onClick={() => handleOptOut(r.peer_number)}
                title="Never text this number again"
              >
                <UserX size={13} /> Opt out
              </button>
            )}
          </div>
        ))}
      </Modal>
      {ConfirmUI}
    </>
  );
}
