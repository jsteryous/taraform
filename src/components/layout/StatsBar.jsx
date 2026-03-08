import { useApp } from '../../context/AppContext';

export default function StatsBar({ filtered, onFilterStatus }) {
  const { contacts } = useApp();

  const total  = contacts.length;
  const offers = contacts.filter(c => c.status === 'Offer Made').length;
  const uc     = contacts.filter(c => c.status === 'UC').length;
  const closed = contacts.filter(c => c.status === 'Closed').length;

  const pill = (label, count, colorVar, status) => (
    <div
      onClick={() => onFilterStatus(status)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.4rem',
        padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer',
        border: '1px solid var(--border)', background: 'var(--surface)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
    >
      <span style={{ fontWeight: 700, fontSize: '0.9rem', color: colorVar }}>{count}</span>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{label}</span>
    </div>
  );

  return (
    <div style={{ padding: '0.75rem 2rem 0', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {pill('total', total, 'var(--text)', null)}
      {pill('offers', offers, '#fbbf24', 'Offer Made')}
      {pill('under contract', uc, '#34d399', 'UC')}
      {pill('closed', closed, '#10b981', 'Closed')}
    </div>
  );
}