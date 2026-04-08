import { useApp } from '../../context/AppContext';
import { resolveConfig } from '../../lib/clientConfig';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export default function StatsBar({ onFilterStatus }) {
  const { currentClient, currentClientId, contacts } = useApp();
  const cfg = resolveConfig(currentClient);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    if (!currentClientId) return;
    // Run count queries for each status pill in parallel
    const pills = cfg.statsPills.filter(p => p.status !== null);
    Promise.all(
      pills.map(({ status, label }) => {
        if (label === 'offers') {
          return supabase.from('contact_offers')
            .select('id, property_crm_contacts!inner(client_id)', { count: 'exact', head: true })
            .eq('property_crm_contacts.client_id', currentClientId)
            .then(({ count }) => ({ status, label, count: count || 0 }));
        }
        return supabase.from('property_crm_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', currentClientId)
          .eq('status', status)
          .then(({ count }) => ({ status, label, count: count || 0 }));
      })
    ).then(results => {
      const map = {};
      results.forEach(r => { map[r.label] = r.count; });
      setCounts(map);
    }).catch(() => {
      // silently ignore — counts stay at previous value
    });
  }, [currentClientId]); // eslint-disable-line

  const [totalCount, setTotalCount] = useState(null);
  useEffect(() => {
    if (!currentClientId) return;
    supabase.from('property_crm_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', currentClientId)
      .then(({ count }) => setTotalCount(count));
  }, [currentClientId]);

  return (
    <div style={{ padding: '0.75rem 2rem 0', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
      {cfg.statsPills.map(({ label, status, color }) => {
        const count = status === null
          ? (totalCount ?? '…')
          : (counts[label] ?? '…');
        return (
          <button key={label}
            onClick={() => onFilterStatus(status)}
            aria-label={`Filter by ${label}: ${count}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.75rem', borderRadius: '6px', cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface)', transition: 'background 0.15s', fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
          >
            <span style={{ fontWeight: 700, fontSize: '0.9rem', color }}>{count}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}