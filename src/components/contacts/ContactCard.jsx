import { memo } from 'react';
import { Building2 } from 'lucide-react';
import { useAppData } from '../../context/AppContext';
import StatusBadge from './StatusBadge';
import { resolveConfig, getStatusColor } from '../../lib/clientConfig';
import { levelLabel } from '../../lib/waysIn';

const ContactCard = memo(function ContactCard({ contact, selected, onSelect, onClick, level = null, levelMine = false }) {
  const { currentClient } = useAppData();
  const cfg = resolveConfig(currentClient);
  const barColor = getStatusColor(cfg, contact.status);
  const showCounty = cfg.listColumns?.includes('county');

  return (
    <div
      className={`contact-item${selected ? ' selected' : ''}${cfg.connections ? ' contact-item--levels' : ''}`}
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

      <div className="contact-status-cell">
        <span className="contact-status-slot"><StatusBadge cfg={cfg} status={contact.status} /></span>
        {/* How well you know them (or, if you haven't said, the team's warmest — dashed). */}
        {level && (
          <span className={`familiarity-chip familiarity-chip--${level}${levelMine ? '' : ' familiarity-chip--team'}`}
            title={levelMine ? 'How well you know them' : 'You haven’t met them; a teammate has'}>
            {levelLabel(level)}
          </span>
        )}
      </div>
    </div>
  );
});

export default ContactCard;