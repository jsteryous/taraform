import { useApp } from '../../context/AppContext';

export default function StatsBar({ filtered, onFilterStatus }) {
  const { contacts } = useApp();

  const total   = contacts.length;
  const offers  = contacts.filter(c => c.status === 'Offer Made').length;
  const uc      = contacts.filter(c => c.status === 'UC').length;
  const closed  = contacts.filter(c => c.status === 'Closed').length;

  return (
    <div className="stats-bar">
      <div className="stat-pill" onClick={() => onFilterStatus(null)} style={{ cursor: 'pointer' }}>
        <span className="pill-num">{total}</span>
        <span className="pill-label">total</span>
      </div>
      <div className="stat-pill pill-offers" onClick={() => onFilterStatus('Offer Made')} style={{ cursor: 'pointer' }}>
        <span className="pill-num">{offers}</span>
        <span className="pill-label">offers</span>
      </div>
      <div className="stat-pill pill-uc" onClick={() => onFilterStatus('UC')} style={{ cursor: 'pointer' }}>
        <span className="pill-num">{uc}</span>
        <span className="pill-label">under contract</span>
      </div>
      <div className="stat-pill pill-closed" onClick={() => onFilterStatus('Closed')} style={{ cursor: 'pointer' }}>
        <span className="pill-num">{closed}</span>
        <span className="pill-label">closed</span>
      </div>
    </div>
  );
}