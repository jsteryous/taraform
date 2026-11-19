import { memo } from 'react';
import { Building2 } from 'lucide-react';
import { useAppData } from '../../context/AppContext';
import StatusBadge from './StatusBadge';
import { resolveConfig, getStatusColor } from '../../lib/clientConfig';

const ContactCard = memo(function ContactCard({ contact, selected, onSelect, onClick }) {
  const { currentClient } = useAppData();
  const cfg = resolveConfig(currentClient);
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

      <div className="contact-name">
        {contact.kind === 'company' && <Building2 size={13} className="company-icon" />}
        {contact.firstName} {contact.lastName}
      </div>
      <div className="contact-phones">{contact.phones?.[0] ? <span className="phone-chip">{contact.phones[0]}</span> : '—'}</div>
      {showCounty && <div className="contact-county">{contact.county || '—'}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-start', gridColumn: showCounty ? 'auto' : 'span 1' }}>
        <StatusBadge cfg={cfg} status={contact.status} />
      </div>
    </div>
  );
});

export default ContactCard;