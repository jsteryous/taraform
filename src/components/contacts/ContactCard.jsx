import { useApp } from '../../context/AppContext';
import { getStatusClass } from '../../lib/utils';

const SMS_LABELS = {
  eligible: null, contacted: 'contacted', interested: 'interested',
  not_interested: 'not interested', do_not_contact: 'DNC', unclear: 'unclear',
};

export default function ContactCard({ contact, selected, onSelect, onClick }) {
  const { currentClient } = useApp();
  const fieldDefs = currentClient?.custom_field_definitions || [];
  const smsLabel = SMS_LABELS[contact.smsStatus];

  return (
    <div
      className={`contact-card${selected ? ' selected' : ''}`}
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
      <input
        type="checkbox"
        className="contact-checkbox"
        checked={selected}
        onClick={e => e.stopPropagation()}
        onChange={() => onSelect(contact.id)}
      />
      <div className="contact-info">
        <div className="contact-name">
          {contact.firstName} {contact.lastName}
        </div>
        <div className="contact-meta">
          {contact.phones[0] && <span>{contact.phones[0]}</span>}
          {contact.county && <span className="contact-county">{contact.county}</span>}
        </div>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
          <span className={`status-badge ${getStatusClass(contact.status)}`} style={{ fontSize: '0.6rem' }}>
            {contact.status}
          </span>
          {smsLabel && (
            <span className={`sms-badge sms-${contact.smsStatus}`} style={{ fontSize: '0.6rem' }}>
              SMS: {smsLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}