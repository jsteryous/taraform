import { useState, useEffect, useCallback, useRef } from 'react';
import { Send, ShieldAlert, Clock, Ban, Loader2, UserX } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fetchThread, checkNumber, sendSms, optOutNumber, segmentCount, DNC_LABELS } from '../../lib/sms';
import Select from '../shared/Select';
import { useConfirm } from '../shared/ConfirmDialog';

// The thread for one contact, plus the composer.
//
// Every block shown here is advisory — the authority is sms_send_precheck() inside the Edge
// Function, which runs again at send time. This exists so the operator learns WHY a number
// is blocked before typing 300 characters into it, not to decide anything.

const BLOCK_ICONS = {
  quiet_hours: Clock,
  opted_out: Ban,
  dnc_listed: ShieldAlert,
  dnc_unscrubbed: ShieldAlert,
};

export default function SmsTab({ contact }) {
  const { showToast } = useApp();
  const [confirmOptOut, ConfirmUI] = useConfirm();
  const phones = contact.phones || [];

  const [phone, setPhone] = useState(phones[0] || '');
  const [thread, setThread] = useState([]);
  const [check, setCheck] = useState(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const endRef = useRef(null);

  // Reset when the overlay swaps to a different contact — without this the previous
  // contact's thread stays on screen under the new one's composer.
  useEffect(() => { setPhone(phones[0] || ''); setBody(''); }, [contact.id]);

  const reload = useCallback(async () => {
    if (!contact.id) return;
    try {
      setThread(await fetchThread(contact.id));
    } catch (e) {
      showToast(`Couldn't load messages: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [contact.id, showToast]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    let cancelled = false;
    if (!phone || !contact.id) { setCheck(null); return undefined; }
    checkNumber(contact.id, phone)
      .then(r => { if (!cancelled) setCheck(r); })
      .catch(() => { if (!cancelled) setCheck(null); });
    return () => { cancelled = true; };
  }, [contact.id, phone, thread.length]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [thread.length]);

  async function handleSend() {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      await sendSms({ contactId: contact.id, phone, body: body.trim() });
      setBody('');
      showToast('Sent');
      await reload();
    } catch (e) {
      // 422s carry a reason; surface the server's sentence rather than a generic failure.
      showToast(e.message, 'error');
      if (e.reason) setCheck({ allowed: false, reason: e.reason, dnc: e.dnc });
    } finally {
      setSending(false);
    }
  }

  // Someone who asks to stop by phone or email is opting out just as much as someone who
  // texts STOP. Applies to the number, so every contact holding it is covered.
  async function handleOptOut() {
    if (!await confirmOptOut(
      `Stop all texting to ${phone}? This covers every contact with this number and cannot be undone here.`
    )) return;
    try {
      const ok = await optOutNumber(phone, 'opted out from the CRM');
      if (!ok) { showToast('That number is not on any of your contacts.', 'error'); return; }
      showToast('Opted out — this number will never be texted again.');
      setCheck({ allowed: false, reason: 'opted_out', dnc: check?.dnc });
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  const blocked = check && !check.allowed;
  const BlockIcon = blocked ? (BLOCK_ICONS[check.reason] || ShieldAlert) : null;
  const segments = segmentCount(body);

  if (!phones.length) {
    return <div id="detailTabSms" className="sms-empty">No phone number on this contact.</div>;
  }

  return (
    <div id="detailTabSms" className="sms-tab">
      <div className="sms-toolbar">
        {phones.length > 1 ? (
          <Select
            value={phone}
            onChange={setPhone}
            options={phones.map(p => ({ value: p, label: p }))}
            emptyLabel={null}
          />
        ) : (
          <span className="sms-number">{phone}</span>
        )}
        {check?.dnc && (
          <span className={`sms-badge sms-dnc-${check.dnc}`}>{DNC_LABELS[check.dnc]}</span>
        )}
        {check?.reason !== 'opted_out' && (
          <button
            type="button"
            className="sms-optout-btn"
            onClick={handleOptOut}
            title="Never text this number again"
          >
            <UserX size={13} /> Opt out
          </button>
        )}
      </div>

      {blocked && (
        <div className="sms-blocked">
          <BlockIcon size={14} />
          <span>{blockText(check.reason, phone)}</span>
        </div>
      )}

      <div className="sms-thread">
        {loading && <div className="sms-empty">Loading…</div>}
        {!loading && !thread.length && <div className="sms-empty">No messages yet.</div>}
        {thread.map(m => (
          <div key={m.id} className={`sms-bubble sms-${m.direction}${m.status === 'failed' ? ' sms-failed' : ''}`}>
            <div className="sms-body">{m.body}</div>
            <div className="sms-meta">
              {new Date(m.created_at).toLocaleString()}
              {m.status === 'failed' && ` · failed${m.error_code ? ` (${m.error_code})` : ''}`}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="sms-composer">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={blocked ? 'Sending is blocked for this number.' : 'Write a message…'}
          disabled={blocked || sending}
          rows={3}
        />
        <div className="sms-composer-actions">
          <span className="sms-segments">
            {body.length} chars · {segments} segment{segments === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSend}
            disabled={blocked || sending || !body.trim()}
          >
            {sending ? <Loader2 size={14} className="sms-spin" /> : <Send size={14} />}
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
      {ConfirmUI}
    </div>
  );
}

// Says what would unblock the number, not just that it is blocked — "not scrubbed" is
// actionable, "blocked" sends the operator to the code to find out why.
function blockText(reason, phone) {
  const ac = (phone || '').replace(/\D/g, '').slice(-10).slice(0, 3);
  switch (reason) {
    case 'dnc_unscrubbed':
      return `Area code ${ac} hasn't been DNC-scrubbed. Load it with scripts/load-dnc.mjs, or record consent on this contact.`;
    case 'dnc_listed':
      return 'This number is on the National Do Not Call Registry. Only recorded consent or an existing business relationship allows a text.';
    case 'opted_out':
      return 'This contact opted out. That is permanent and cannot be undone here.';
    case 'quiet_hours':
      return "Outside 8am–9pm in the recipient's local time.";
    case 'daily_cap':
      return 'Daily send cap reached for this list.';
    case 'bad_phone':
      return 'This number is marked bad on the contact.';
    case 'invalid_number':
      return 'Not a valid US number.';
    case 'phone_not_on_contact':
      return 'That number is not on this contact.';
    default:
      return `Blocked: ${reason}`;
  }
}
