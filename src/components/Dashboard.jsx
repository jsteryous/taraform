import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { resolveConfig } from '../lib/clientConfig';
import { supabase } from '../lib/supabase';

const BASE = 'https://taraform-server-production.up.railway.app';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week',  label: '7 Days' },
  { value: 'month', label: '30 Days' },
  { value: 'alltime', label: 'All Time' },
];

const INTENT_LABELS = {
  interested:      { label: 'Interested',    color: '#10b981' },
  not_interested:  { label: 'Not Interested',color: '#6b7280' },
  opt_out:         { label: 'Opted Out',     color: '#ef4444' },
  question:        { label: 'Question',      color: '#3b82f6' },
  unclear:         { label: 'Unclear',       color: '#f59e0b' },
  unknown:         { label: 'Other',         color: '#6b7280' },
};

function downloadOffersReport(periodOffers, _contacts, period) {
  const rows = periodOffers
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(o => [
      o.contactName || '',
      o.county || '',
      (o.taxMapIds || []).join(' | '),
      Number(o.amount) || 0,
      o.status || '',
      o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '',
      o.notes || '',
    ]);

  const headers = ['Contact', 'County', 'Tax Map IDs', 'Amount', 'Status', 'Date', 'Notes'];
  const csv = [headers, ...rows]
    .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `offers-${period}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Dashboard({ onClose, onViewContact }) {
  const { currentClientId, currentClient } = useApp();
  const cfg = resolveConfig(currentClient);
  const [period, setPeriod] = useState('week');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [emailData, setEmailData] = useState(null);
  const [offerStats, setOfferStats] = useState(null);

  const loadOfferStats = useCallback(async (p) => {
    if (!currentClientId) return;

    const now = new Date();
    let since = null;
    if (p === 'today')      since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    else if (p === 'week')  since = new Date(now - 7 * 86400000).toISOString();
    else if (p === 'month') since = new Date(now - 30 * 86400000).toISOString();

    const { data: clientContacts } = await supabase
      .from('property_crm_contacts')
      .select('id, first_name, last_name, county, tax_map_ids')
      .eq('client_id', currentClientId);

    if (!clientContacts?.length) {
      setOfferStats({ allTimeCount: 0, count: 0, totalCount: 0, totalValue: 0, acceptedValue: 0, byStatus: {}, recent: [] });
      return;
    }

    const contactMap = Object.fromEntries(clientContacts.map(c => [c.id, c]));
    const contactIds = clientContacts.map(c => c.id);

    const { data: allOffers, error: offersError } = await supabase
      .from('contact_offers')
      .select('*')
      .in('contact_id', contactIds)
      .order('created_at', { ascending: false });
    if (offersError) console.error('loadOfferStats offers error:', offersError);

    const offers = allOffers || [];
    const allTimeCount = offers.length;
    const periodOffers = since ? offers.filter(o => o.created_at >= since) : offers;

    const uniqueContacts = new Set(periodOffers.map(o => o.contact_id));
    const totalValue = periodOffers.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const acceptedValue = periodOffers.filter(o => o.status === 'Accepted').reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const byStatus = {};
    for (const o of periodOffers) byStatus[o.status || 'Pending'] = (byStatus[o.status || 'Pending'] || 0) + 1;

    const recent = periodOffers.slice(0, 10).map(o => {
      const c = contactMap[o.contact_id] || {};
      return {
        contactId: o.contact_id,
        contactName: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        county: c.county || '',
        taxMapIds: c.tax_map_ids || [],
        amount: o.amount,
        status: o.status,
        notes: o.notes,
        createdAt: o.created_at,
      };
    });

    setOfferStats({ allTimeCount, count: uniqueContacts.size, totalCount: periodOffers.length, totalValue, acceptedValue, byStatus, recent });
  }, [currentClientId]);

  const load = useCallback(async (p) => {
    if (!currentClientId) return;
    setLoading(true); setError(null);
    try {
      const [smsRes, emailRes] = await Promise.all([
        fetch(`${BASE}/api/stats?client_id=${currentClientId}&period=${p}`),
        fetch(`${BASE}/api/email/stats?client_id=${currentClientId}&period=${p}`).catch(() => null),
      ]);
      if (!smsRes.ok) throw new Error(await smsRes.text());
      const raw = await smsRes.json();
      setData({
        period:              raw.period              || p,
        sentThisPeriod:      raw.sentThisPeriod      || 0,
        repliesThisPeriod:   raw.repliesThisPeriod   || 0,
        replyRate:           raw.replyRate           ?? null,
        intentBreakdown:     raw.intentBreakdown     || {},
        totalSent:           raw.totalSent           || 0,
        deliveryRate:        raw.deliveryRate        ?? null,
        smsStatusCounts:     raw.smsStatusCounts     || {},
        contactStatusCounts: raw.contactStatusCounts || {},
        pendingFollowUps:    raw.pendingFollowUps    || 0,
        totalContacts:       raw.totalContacts       || 0,
        templatePerformance: raw.templatePerformance || [],
      });
      if (emailRes?.ok) setEmailData(await emailRes.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [currentClientId]);

  useEffect(() => { load(period); loadOfferStats(period); }, [period, load, loadOfferStats]);

  const term = cfg.terminology?.contacts || 'Contacts';

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

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', paddingTop: '1rem' }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.875rem', padding: 0 }}>← Back</button>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Dashboard</h2>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{currentClient?.name}</span>

        {/* Period switcher */}
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

      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Loading…
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '1rem', color: '#f87171', fontSize: '0.875rem' }}>
          Failed to load stats: {error}
        </div>
      )}

      {!loading && data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* ── Pipeline (moved to top) ── */}
          {Object.keys(data.contactStatusCounts || {}).length > 0 && (
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                <div style={sectionTitle}>Pipeline — {term}</div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                  {data.totalContacts} total
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {Object.entries(data.contactStatusCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => {
                    const cfgStatus = cfg.statuses.find(s => s.value === status);
                    const color = cfgStatus?.color || '#6b7280';
                    return (
                      <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.875rem', borderRadius: '20px', background: `${color}18`, border: `1px solid ${color}33` }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text)' }}>{status}</span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color, fontFamily: 'var(--mono)' }}>{count}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ── Top KPI row ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
            <KpiCard label="Texts Sent" value={data.sentThisPeriod} color="#60a5fa" sub={`${data.totalSent} all-time`} style={card} bigNum={bigNum} cardLabel={cardLabel} />
            <KpiCard label="Replies" value={data.repliesThisPeriod} color="#34d399"
              sub={data.replyRate !== null ? `${data.replyRate}% reply rate` : 'No data yet'} style={card} bigNum={bigNum} cardLabel={cardLabel} />
            <KpiCard label="Delivery Rate" value={data.deliveryRate !== null ? `${data.deliveryRate}%` : '—'} color="#fbbf24"
              sub={`${data.totalSent} total sent`} style={card} bigNum={bigNum} cardLabel={cardLabel} />
            <KpiCard label="Pending Queue" value={data.pendingFollowUps} color="#a78bfa"
              sub={`${data.totalContacts} ${term.toLowerCase()}`} style={card} bigNum={bigNum} cardLabel={cardLabel} />
          </div>

          {/* ── Middle row: Contact breakdown + Reply intent ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>

            {/* SMS status breakdown */}
            <div style={card}>
              <div style={sectionTitle}>SMS Status Breakdown</div>
              {Object.keys(data.smsStatusCounts || {}).length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No data yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {Object.entries(data.smsStatusCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => {
                      const pct = Math.round((count / data.totalContacts) * 100);
                      const colors = {
                        eligible: '#6b7280', contacted: '#3b82f6', interested: '#10b981',
                        not_interested: '#6b7280', do_not_contact: '#ef4444', unclear: '#f59e0b',
                      };
                      const c = colors[status] || '#6b7280';
                      return (
                        <div key={status}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem', fontSize: '0.8rem' }}>
                            <span style={{ color: 'var(--text)', textTransform: 'capitalize' }}>{status.replace(/_/g, ' ')}</span>
                            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{count} <span style={{ opacity: 0.5 }}>({pct}%)</span></span>
                          </div>
                          <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: '2px', transition: 'width 0.4s ease' }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Reply intent breakdown */}
            <div style={card}>
              <div style={sectionTitle}>Reply Intent — {PERIODS.find(p => p.value === period)?.label}</div>
              {Object.keys(data.intentBreakdown || {}).length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No replies in this period</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {Object.entries(data.intentBreakdown)
                    .sort((a, b) => b[1] - a[1])
                    .map(([intent, count]) => {
                      const meta = INTENT_LABELS[intent] || { label: intent, color: '#6b7280' };
                      const pct = data.repliesThisPeriod > 0 ? Math.round((count / data.repliesThisPeriod) * 100) : 0;
                      return (
                        <div key={intent}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem', fontSize: '0.8rem' }}>
                            <span style={{ color: meta.color, fontWeight: 500 }}>{meta.label}</span>
                            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{count} <span style={{ opacity: 0.5 }}>({pct}%)</span></span>
                          </div>
                          <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: meta.color, borderRadius: '2px', transition: 'width 0.4s ease' }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>



          {/* ── Offers ── */}
          {offerStats !== null && (
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                <div style={sectionTitle}>Offers — {PERIODS.find(p => p.value === period)?.label}</div>
                <button
                  onClick={() => downloadOffersReport(offerStats.recent || [], [], period)}
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  ↓ Download Report
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: (offerStats?.totalCount || 0) > 0 ? '1.25rem' : 0 }}>
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.3rem' }}>Contacts w/ Offers</div>
                  <div style={{ ...bigNum, color: '#fbbf24' }}>{offerStats?.count || 0}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{offerStats?.totalCount || 0} total offer{offerStats?.totalCount !== 1 ? 's' : ''}</div>
                </div>
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.3rem' }}>Total Value</div>
                  <div style={{ ...bigNum, color: '#60a5fa', fontSize: '1.5rem' }}>${(offerStats?.totalValue || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.3rem' }}>Accepted Value</div>
                  <div style={{ ...bigNum, color: '#10b981', fontSize: '1.5rem' }}>${(offerStats?.acceptedValue || 0).toLocaleString()}</div>
                </div>
              </div>

              {/* Status breakdown */}
              {Object.keys(offerStats?.byStatus || {}).length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: (offerStats?.totalCount || 0) > 0 ? '1.25rem' : 0 }}>
                  {Object.entries(offerStats?.byStatus || {}).map(([status, count]) => {
                    const colors = { Pending: '#fbbf24', Accepted: '#10b981', Rejected: '#f87171', Countered: '#60a5fa' };
                    const c = colors[status] || '#6b7280';
                    return (
                      <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.75rem', borderRadius: '20px', background: `${c}18`, border: `1px solid ${c}33` }}>
                        <span style={{ fontSize: '0.8rem', color: c, fontWeight: 600 }}>{count}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{status}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Recent offers list */}
              {(offerStats?.recent || []).length > 0 && (
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.5rem' }}>Recent Offers</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 0, fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.4px', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                    <span>Contact</span><span>County</span><span style={{ textAlign: 'right' }}>Amount</span><span style={{ textAlign: 'right' }}>Status</span><span style={{ textAlign: 'right' }}>Date</span>
                  </div>
                  {(offerStats?.recent || []).map((o, i) => {
                    const colors = { Pending: '#fbbf24', Accepted: '#10b981', Rejected: '#f87171', Countered: '#60a5fa' };
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 0, padding: '0.5rem 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                        <span
                          onClick={() => { if (o.contactId && onViewContact) onViewContact({ id: o.contactId }); }}
                          style={{ fontSize: '0.8rem', color: onViewContact ? 'var(--accent)' : 'var(--text)', cursor: onViewContact ? 'pointer' : 'default', textDecoration: onViewContact ? 'underline' : 'none', textUnderlineOffset: '2px' }}
                        >{o.contactName}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.county || '—'}</span>
                        <span style={{ textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>${Number(o.amount).toLocaleString()}</span>
                        <span style={{ textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: colors[o.status || 'Pending'] || 'var(--text-muted)' }}>{o.status || 'Pending'}</span>
                        <span style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Email section ── */}
          {emailData && (
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={sectionTitle}>Email — {PERIODS.find(p => p.value === period)?.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: emailData.autoEnabled ? '#10b981' : '#6b7280', display: 'inline-block' }} />
                  {emailData.autoEnabled ? 'Automation on' : 'Automation off'}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <KpiCard label="Sent" value={emailData.sentThisPeriod} color="#60a5fa" sub={`${emailData.totalSent} all-time`} style={{}} bigNum={bigNum} cardLabel={cardLabel} />
                <KpiCard label="Verified" value={emailData.verifiedCount} color="#10b981" sub="safe to send" style={{}} bigNum={bigNum} cardLabel={cardLabel} />
                <KpiCard label="Blocked" value={emailData.blockedCount} color="#f87171" sub="do not email" style={{}} bigNum={bigNum} cardLabel={cardLabel} />
                <KpiCard label="Unverified" value={emailData.unverifiedCount} color="#f59e0b" sub="not yet checked" style={{}} bigNum={bigNum} cardLabel={cardLabel} />
                <KpiCard label="Unknown" value={emailData.unknownCount || 0} color="#6b7280" sub="unverifiable" style={{}} bigNum={bigNum} cardLabel={cardLabel} />
              </div>
              {emailData.sentThisPeriod === 0 && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No emails sent in this period yet.</div>
              )}
            </div>
          )}



        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, color, sub, style, bigNum, cardLabel }) {
  return (
    <div style={style}>
      <div style={cardLabel}>{label}</div>
      <div style={{ ...bigNum, color }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>{sub}</div>}
    </div>
  );
}

function NumCell({ value, color }) {
  return (
    <div style={{ textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: color || 'var(--text)', fontFamily: 'var(--mono)' }}>
      {value ?? '—'}
    </div>
  );
}