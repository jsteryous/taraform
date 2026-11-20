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
  const showPhone = cfg.listColumns?.includes('phone');
  const levels = !!cfg.connections;

  return (
    <div
      className={`contact-item${selected ? ' selected' : ''}${levels ? ' contact-item--levels' : ''}`}
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
      {showPhone && <div className="contact-phones">{contact.phones?.[0] ? <span className="phone-chip">{contact.phones[0]}</span> : '—'}</div>}
      {showCounty && <div className="contact-county">{contact.county || '—'}</div>}

      <div className="contact-status-cell"><StatusBadge cfg={cfg} status={contact.status} /></div>
      {/* How well you know them (or, if you haven't said, the team's warmest — dashed). */}
      {levels && (
        <div className="contact-level-cell">
          {level && (
            <span className={`familiarity-chip familiarity-chip--${level}${levelMine ? '' : ' familiarity-chip--team'}`}
              title={levelMine ? 'How well you know them' : 'You haven’t met them; a teammate has'}>
              {levelLabel(level)}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

export default ContactCard;