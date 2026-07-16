import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { resolveConfig, getOfferStatusColors } from '../lib/clientConfig';
import { summarizeNoteActivity } from '../lib/activityStats';
import { supabase } from '../lib/supabase';
import { ArrowLeft, Download } from 'lucide-react';

const PERIODS = [
  { value: 'today',   label: 'Today' },
  { value: 'week',    label: '7 Days' },
  { value: 'month',   label: '30 Days' },
  { value: 'alltime', label: 'All Time' },
];

function downloadOffersReport(recent, period) {
  const rows = recent
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(o => [
      o.contactName || '',
      o.county || '',
      (o.taxMapIds || []).join(' | '),
      Number(o.amount) || 0,
      o.status || '',
      o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '',
    ]);

  const headers = ['Contact', 'County', 'Tax Map IDs', 'Amount', 'Status', 'Date'];
  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `offers-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Dashboard({ onClose, onViewContact }) {
  const { currentClientId, currentClient, theme } = useApp();
  const cfg = resolveConfig(currentClient);
  const offerColors = getOfferStatusColors(theme);
  const [period, setPeriod]         = useState('week');
  const [offerStats, setOfferStats] = useState(null);
  const [offerLoading, setOfferLoading] = useState(true);
  const [offerError, setOfferError] = useState(null);
  const [noteStats, setNoteStats]     = useState(null);
  const [noteLoading, setNoteLoading] = useState(true);
  const [noteError, setNoteError]     = useState(null);

  // Notes logged across the client's contacts, bucketed today/7d/30d. One fetch per
  // client (the card shows all three windows at once, so the period toggle doesn't apply).
  const loadNoteStats = useCallback(async () => {
    setNoteLoading(true);
    setNoteError(null);
    if (!currentClientId) { setNoteLoading(false); return; }
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data, error } = await supabase.rpc('note_activity', {
        p_client_id: currentClientId,
        p_since: since,
      });
      if (error) throw error;
      setNoteStats(summarizeNoteActivity(data));
    } catch (e) {
      console.error('loadNoteStats error:', e);
      setNoteError(e.message);
    } finally {
      setNoteLoading(false);
    }
  }, [currentClientId]);

  useEffect(() => {
    loadNoteStats();
  }, [loadNoteStats]);

  const loadOfferStats = useCallback(async (p) => {
    setOfferLoading(true);
    setOfferError(null);
    if (!currentClientId) { setOfferLoading(false); return; }

    const now = new Date();
    let since = null;
    if (p === 'today')      since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    else if (p === 'week')  since = new Date(now - 7 * 86400000).toISOString();
    else if (p === 'month') since = new Date(now - 30 * 86400000).toISOString();

    try {
      let q = supabase
        .from('contact_offers')
        .select('id, contact_id, amount, status, created_at, property_crm_contacts!inner(first_name, last_name, county, tax_map_ids, client_id)')
        .eq('property_crm_contacts.client_id', currentClientId)
        .order('created_at', { ascending: false });
      if (since) q = q.gte('created_at', since);

      const { data: rows, error: offersError } = await q;
      if (offersError) throw offersError;

      const offers = (rows || []).map(row => ({
        id: row.id,
        contact_id: row.contact_id,
        amount: row.amount,
        status: row.status,
        created_at: row.created_at,
        contactName: `${row.property_crm_contacts?.first_name || ''} ${row.property_crm_contacts?.last_name || ''}`.trim(),
        county: row.property_crm_contacts?.county || '',
        taxMapIds: row.property_crm_contacts?.tax_map_ids || [],
      }));

      const uniqueContacts = new Set(offers.map(o => o.contact_id));
      const totalValue     = offers.reduce((s, o) => s + (Number(o.amount) || 0), 0);
      const acceptedValue  = offers.filter(o => o.status === 'Accepted').reduce((s, o) => s + (Number(o.amount) || 0), 0);
      const byStatus = {};
      for (const o of offers) byStatus[o.status || 'Pending'] = (byStatus[o.status || 'Pending'] || 0) + 1;

      const recent = offers.map(o => ({
        contactId:   o.contact_id,
        contactName: o.contactName,
        county:      o.county,
        taxMapIds:   o.taxMapIds,
        amount:      o.amount,
        status:      o.status,
        createdAt:   o.created_at,
      }));

      setOfferStats({ count: uniqueContacts.size, totalCount: offers.length, totalValue, acceptedValue, byStatus, recent });
    } catch (e) {
      console.error('loadOfferStats error:', e);
      setOfferError(e.message);
    } finally {
      setOfferLoading(false);
    }
  }, [currentClientId]);

  useEffect(() => {
    loadOfferStats(period);
  }, [period, loadOfferStats]);

  // ── Styles ────────────────────────────────────────────────────
  const card = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: '10px', padding: '1.25rem',
  };
  const bigNum = { fontSize: '2rem', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.5px' };
  const cardLabel = {
    fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.6px', color: 'var(--text-muted)', fontFamily: 'var(--mono)',
    marginBottom: '0.5rem',
  };
  const sectionTitle = {
    fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.6px', color: 'var(--text-muted)', fontFamily: 'var(--mono)',
    marginBottom: '0.875rem',
  };

  return (
    <div style={{ padding: '0 2rem 2rem', maxWidth: '960px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', paddingTop: '1rem' }}>
        <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.875rem', padding: 0 }}><ArrowLeft size={14} /> Back</button>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Dashboard</h2>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{currentClient?.name}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.2rem' }}>
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)} style={{
              padding: '0.3rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 500,
              border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', transition: 'all 0.15s',
              background: period === p.value ? 'var(--accent)' : 'transparent',
              color: period === p.value ? 'white' : 'var(--text-muted)',
            }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* ── Activity (notes logged) ── */}
        <div style={card}>
          <div style={sectionTitle}>Activity — Notes Logged</div>

          {noteLoading && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</div>
          )}

          {noteError && (
            <div style={{ color: '#f87171', fontSize: '0.875rem' }}>Failed to load activity: {noteError}</div>
          )}

          {!noteLoading && noteStats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
              {[
                { key: 'today', label: 'Today' },
                { key: 'week',  label: '7 Days' },
                { key: 'month', label: '30 Days' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <div style={{ ...cardLabel, marginBottom: '0.3rem' }}>{label}</div>
                  <div style={{ ...bigNum, color: 'var(--accent)' }}>{noteStats[key].notes}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    {noteStats[key].contacts} contact{noteStats[key].contacts !== 1 ? 's' : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Offers ── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
            <div style={sectionTitle}>Offers — {PERIODS.find(p => p.value === period)?.label}</div>
            {offerStats && (
              <button
                onClick={() => downloadOffersReport(offerStats.recent || [], period)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', padding: '0.3rem 0.75rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                <Download size={12} /> Download Report
              </button>
            )}
          </div>

          {offerLoading && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</div>
          )}

          {offerError && (
            <div style={{ color: '#f87171', fontSize: '0.875rem' }}>Failed to load offers: {offerError}</div>
          )}

          {!offerLoading && offerStats && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: (offerStats.totalCount || 0) > 0 ? '1.25rem' : 0 }}>
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.3rem' }}>Contacts w/ Offers</div>
                  <div style={{ ...bigNum, color: offerColors.Pending }}>{offerStats.count}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{offerStats.totalCount} total offer{offerStats.totalCount !== 1 ? 's' : ''}</div>
                </div>
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.3rem' }}>Total Value</div>
                  <div style={{ ...bigNum, color: offerColors.Countered, fontSize: '1.5rem' }}>${offerStats.totalValue.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.3rem' }}>Accepted Value</div>
                  <div style={{ ...bigNum, color: offerColors.Accepted, fontSize: '1.5rem' }}>${offerStats.acceptedValue.toLocaleString()}</div>
                </div>
              </div>

              {Object.keys(offerStats.byStatus).length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: offerStats.totalCount > 0 ? '1.25rem' : 0 }}>
                  {Object.entries(offerStats.byStatus).map(([status, count]) => {
                    const c = offerColors[status] || '#6b7280';
                    return (
                      <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.75rem', borderRadius: '20px', background: `${c}18`, border: `1px solid ${c}33` }}>
                        <span style={{ fontSize: '0.8rem', color: c, fontWeight: 600 }}>{count}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{status}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {offerStats.recent.length > 0 && (
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.5rem' }}>Recent Offers</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 0, fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.4px', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                    <span>Contact</span><span>County</span><span style={{ textAlign: 'right' }}>Amount</span><span style={{ textAlign: 'right' }}>Status</span><span style={{ textAlign: 'right' }}>Date</span>
                  </div>
                  <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
                  {offerStats.recent.map((o, i) => {
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 0, padding: '0.5rem 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                        <span
                          onClick={() => { if (o.contactId && onViewContact) onViewContact({ id: o.contactId }); }}
                          style={{ fontSize: '0.8rem', color: onViewContact ? 'var(--accent)' : 'var(--text)', cursor: onViewContact ? 'pointer' : 'default', textDecoration: onViewContact ? 'underline' : 'none', textUnderlineOffset: '2px' }}
                        >{o.contactName}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.county || '—'}</span>
                        <span style={{ textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>${Number(o.amount).toLocaleString()}</span>
                        <span style={{ textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: offerColors[o.status || 'Pending'] || 'var(--text-muted)' }}>{o.status || 'Pending'}</span>
                        <span style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '—'}</span>
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}

              {offerStats.totalCount === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No offers in this period.</div>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
