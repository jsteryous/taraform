import { memo } from 'react';
import { useAppData } from '../../context/AppContext';
import { getStatusClass } from '../../lib/utils';
import { resolveConfig, getStatusColor } from '../../lib/clientConfig';

const SMS_LABELS = {
  eligible: null, contacted: 'SMS', interested: 'interested',
  not_interested: 'not interested', do_not_contact: 'DNC', unclear: 'unclear',
};

const ContactCard = memo(function ContactCard({ contact, selected, onSelect, onClick }) {
  const { currentClient } = useAppData();
  const cfg = resolveConfig(currentClient);
  const smsLabel = SMS_LABELS[contact.smsStatus];
  const barColor = getStatusColor(cfg, contact.status);
  const showCounty = cfg.listColumns?.includes('county');

  return (
    <div
      className={`contact-item${selected ? ' selected' : ''}`}
      onClick={e => {
        if (e.metaKey || e.ctrlKey) {
          const url = `${window.location.origin}${window.location.pathname}#/contact/${contact.id}`;
          window.open(url, '_blank');
        } else {
          onClick(contact.id);
        }
      }}
    >
      {/* Dynamic color status bar */}
      <div style={{ width: '4px', alignSelf: 'stretch', borderRadius: '0 2px 2px 0', flexShrink: 0, background: barColor }} />

      <input
        type="checkbox"
        className="contact-checkbox"
        checked={selected}
        onClick={e => e.stopPropagation()}
        onChange={() => onSelect(contact.id)}
      />

      <div className="contact-name">{contact.firstName} {contact.lastName}</div>
      <div className="contact-phones">{contact.phones?.[0] || '—'}</div>
      {showCounty && <div className="contact-county">{contact.county || '—'}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-start', gridColumn: showCounty ? 'auto' : 'span 1' }}>
        <span className={`status-badge ${getStatusClass(contact.status)}`}
          style={{ background: `${barColor}22`, color: barColor, borderColor: `${barColor}44` }}>
          {contact.status}
        </span>
        {smsLabel && <span className={`sms-badge sms-${contact.smsStatus}`}>{smsLabel}</span>}
      </div>
    </div>
  );
});

export default ContactCard;