import { useApp } from '../../context/AppContext';
import { resolveConfig } from '../../lib/clientConfig';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export default function StatsBar({ filtered, onFilterStatus }) {
  const { contacts, currentClient, currentClientId } = useApp();
  const cfg = resolveConfig(currentClient);
  const [totalCount, setTotalCount] = useState(null);

  useEffect(() => {
    if (!currentClientId) return;
    supabase
      .from('property_crm_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', currentClientId)
      .then(({ count }) => setTotalCount(count));
  }, [currentClientId]);

  return (
    <div style={{ padding: '0.75rem 2rem 0', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {cfg.statsPills.map(({ label, status, color }) => {
        let count;
        if (status === null) {
          count = totalCount ?? contacts.length;
        } else if (label === 'offers') {
          count = contacts.filter(c => c.offers?.length > 0).length;
        } else {
          count = contacts.filter(c => c.status === status).length;
        }
        return (
          <div key={label}
            onClick={() => onFilterStatus(status)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
          >
            <span style={{ fontWeight: 700, fontSize: '0.9rem', color }}>{count}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}