import { getStatusClass, getBarClass } from '../../lib/utils';

const SMS_LABELS = {
  eligible: null, contacted: 'SMS', interested: 'interested',
  not_interested: 'not interested', do_not_contact: 'DNC', unclear: 'unclear',
};

export default function ContactCard({ contact, selected, onSelect, onClick }) {
  const smsLabel = SMS_LABELS[contact.smsStatus];

  return (
    <div
      className={`contact-item${selected ? ' selected' : ''}`}
      onClick={e => {
        if (e.metaKey || e.ctrlKey) {
          const url = new URL(window.location.href);
          url.searchParams.set('contact', contact.id);
          window.open(url.toString(), '_blank');
        } else {
          onClick(contact.id);
        }
      }}
    >
      {/* Colored status bar on left edge */}
      <div className={`contact-status-bar ${getBarClass(contact.status)}`} />

      <input
        type="checkbox"
        className="contact-checkbox"
        checked={selected}
        onClick={e => e.stopPropagation()}
        onChange={() => onSelect(contact.id)}
      />

      <div className="contact-name">{contact.firstName} {contact.lastName}</div>
      <div className="contact-phones">{contact.phones?.[0] || '—'}</div>
      <div className="contact-county">{contact.county || '—'}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-start' }}>
        <span className={`status-badge ${getStatusClass(contact.status)}`}>{contact.status}</span>
        {smsLabel && <span className={`sms-badge sms-${contact.smsStatus}`}>{smsLabel}</span>}
      </div>
    </div>
  );
}