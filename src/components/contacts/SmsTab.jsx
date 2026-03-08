import { useState, useEffect, useRef } from 'react';
import { getMessages, sendMessage } from '../../lib/api';
import { useApp } from '../../context/AppContext';

const INTENT_LABELS = {
  INTERESTED: { label: 'Interested', color: 'var(--success)' },
  WANTS_CALL: { label: 'Wants Call', color: 'var(--success)' },
  NOT_INTERESTED: { label: 'Not Interested', color: 'var(--text-muted)' },
  OPT_OUT: { label: 'Opted Out', color: 'var(--danger)' },
  UNCLEAR: { label: 'Unclear', color: 'var(--warning)' },
};

export default function SmsTab({ contact }) {
  const { showToast } = useApp();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [text, setText]         = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    getMessages(contact.id)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [contact.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    if (!text.trim() || contact.smsStatus === 'do_not_contact') return;
    setSending(true);
    try {
      await sendMessage({ contactId: contact.id, message: text.trim() });
      const updated = await getMessages(contact.id);
      setMessages(updated);
      setText('');
    } catch (err) {
      showToast('Failed to send');
    } finally {
      setSending(false);
    }
  }

  const optedOut = contact.smsStatus === 'do_not_contact';

  return (
    <div id="detailTabSms" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sms-thread" style={{ flex: 1, overflowY: 'auto', padding: '1rem 0' }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading...</div>
        ) : messages.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No messages yet.</div>
        ) : messages.map(msg => {
          const isOut = msg.direction === 'out';
          const intent = INTENT_LABELS[msg.intent_category];
          return (
            <div key={msg.id} className={`sms-bubble ${isOut ? 'sms-out' : 'sms-in'}`}>
              <div className="sms-body">{msg.body}</div>
              <div className="sms-meta">
                {new Date(msg.sent_at || msg.received_at || msg.created_at).toLocaleString()}
                {intent && <span style={{ marginLeft: '0.5rem', color: intent.color, fontSize: '0.7rem' }}>{intent.label}</span>}
                {msg.status === 'delivered' && isOut && <span style={{ marginLeft: '0.5rem', color: 'var(--success)', fontSize: '0.7rem' }}>✓ delivered</span>}
                {msg.status === 'failed' && <span style={{ marginLeft: '0.5rem', color: 'var(--danger)', fontSize: '0.7rem' }}>✗ failed</span>}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {optedOut ? (
        <div className="sms-opt-out-warning">⛔ This contact has opted out — sending is disabled.</div>
      ) : (
        <div className="sms-send-bar">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Type a message..."
            rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <button className="btn-primary" onClick={handleSend} disabled={sending || !text.trim()}>
            {sending ? '...' : 'Send'}
          </button>
        </div>
      )}
    </div>
  );
}