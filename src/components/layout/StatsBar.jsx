import { useApp } from '../../context/AppContext';
import { resolveConfig } from '../../lib/clientConfig';
import { useState, useEffect } from 'react';
import { countContacts, countCompanies } from '../../lib/contacts';
import { Building2 } from 'lucide-react';

const pillStyle = { display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', transition: 'background 0.15s', fontFamily: 'inherit' };

export default function StatsBar({ onFilterStatus, showCompanies = true, onToggleCompanies }) {
  const { currentClient, currentClientId } = useApp();
  const cfg = resolveConfig(currentClient);
  // Only workspaces with companies have anything to hide; elsewhere every row is a person.
  const hideCompanies = !!cfg.companies && !showCompanies;
  const [counts, setCounts] = useState({});
  const [totalCount, setTotalCount] = useState(null);
  const [companyCount, setCompanyCount] = useState(null);

  useEffect(() => {
    if (!currentClientId) return;
    // Every pill counts CONTACTS in its status — the same set its click filters to.
    // (The 'offers' pill used to count contact_offers rows instead, which drifted:
    // an offer row stays forever, but the contact moves on to Offer Rejected/NFS,
    // UC, Dead/Pass … so the pill read 7 and the filtered list showed 3.)
    // countContacts runs the list's own query, so with companies hidden the counts leave
    // them out exactly as the list does.
    const companies = hideCompanies ? false : true;
    const pills = cfg.statsPills.filter(p => p.status !== null);
    Promise.all(
      pills.map(({ status, label }) =>
        countContacts(currentClientId, { statuses: [status], companies }).then(count => ({ label, count }))
      )
    ).then(results => {
      const map = {};
      results.forEach(r => { map[r.label] = r.count; });
      setCounts(map);
    }).catch(() => {
      // silently ignore — counts stay at previous value
    });
    countContacts(currentClientId, { companies }).then(setTotalCount).catch(() => {});
  }, [currentClientId, hideCompanies]); // eslint-disable-line

  useEffect(() => {
    if (!currentClientId || !cfg.companies) return;
    countCompanies(currentClientId).then(setCompanyCount).catch(() => {});
  }, [currentClientId, cfg.companies]);

  const hover = {
    onMouseEnter: e => { e.currentTarget.style.background = 'var(--surface-hover)'; },
    onMouseLeave: e => { e.currentTarget.style.background = 'var(--surface)'; },
  };

  return (
    <div className="stats-row">
      {cfg.statsPills.map(({ label, status, color }) => {
        const count = status === null
          ? (totalCount ?? '…')
          : (counts[label] ?? '…');
        return (
          <button key={label}
            onClick={() => onFilterStatus(status)}
            aria-label={`Filter by ${label}: ${count}`}
            style={pillStyle} {...hover}
          >
            <span style={{ fontWeight: 700, fontSize: '0.9rem', color }}>{count}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{label}</span>
          </button>
        );
      })}
      {cfg.companies && onToggleCompanies && (
        // A toggle, not a status filter: it shows or hides companies across the whole
        // list and leaves the status selection alone.
        <button
          onClick={onToggleCompanies}
          aria-pressed={showCompanies}
          aria-label={`${showCompanies ? 'Hide' : 'Show'} companies: ${companyCount ?? '…'}`}
          title={showCompanies ? 'Companies shown — click to hide' : 'Companies hidden — click to show'}
          style={{ ...pillStyle, borderStyle: showCompanies ? 'solid' : 'dashed', borderColor: showCompanies ? '#a78bfa' : 'var(--border)', opacity: showCompanies ? 1 : 0.75 }}
          {...hover}
        >
          <Building2 size={13} color={showCompanies ? '#a78bfa' : 'var(--text-muted)'} />
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: showCompanies ? '#a78bfa' : 'var(--text-muted)' }}>{companyCount ?? '…'}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{showCompanies ? 'companies shown' : 'companies hidden'}</span>
        </button>
      )}
    </div>
  );
}
