import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { resolveConfig } from '../lib/clientConfig';

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

export default function Dashboard({ onClose }) {
  const { currentClientId, currentClient, contacts } = useApp();
  const cfg = resolveConfig(currentClient);
  const [period, setPeriod] = useState('week');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  // Compute offers from contacts (stored as JSONB array per contact)
  const offerStats = useMemo(() => {
    const now = Date.now();
    const cutoffs = {
      today: new Date(new Date().setHours(0,0,0,0)).getTime(),
      week:  now - 7  * 24 * 60 * 60 * 1000,
      month: now - 30 * 24 * 60 * 60 * 1000,
      alltime: 0,
    };
    const cutoff = cutoffs[period] || cutoffs.week;

    const allOffers = contacts.flatMap(c =>
      (c.offers || []).map(o => ({ ...o, contactName: `${c.firstName} ${c.lastName}`.trim() }))
    );
    const periodOffers = allOffers.filter(o => o.createdAt && new Date(o.createdAt).getTime() >= cutoff);

    const totalValue   = periodOffers.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    const byStatus     = {};
    periodOffers.forEach(o => { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });
    const acceptedValue = periodOffers.filter(o => o.status === 'Accepted').reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

    return { all: periodOffers, count: periodOffers.length, totalValue, byStatus, acceptedValue };
  }, [contacts, period]);

  const load = useCallback(async (p) => {
    if (!currentClientId) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${BASE}/api/stats?client_id=${currentClientId}&period=${p}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [currentClientId]);

  useEffect(() => { load(period); }, [period, load]);

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
              {Object.keys(data.smsStatusCounts).length === 0 ? (
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
              {Object.keys(data.intentBreakdown).length === 0 ? (
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

          {/* ── Template performance ── */}
          {data.templatePerformance?.length > 0 && (
            <div style={card}>
              <div style={sectionTitle}>Template Performance</div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: '0', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.4px', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.5rem' }}>
                <span>Template</span><span style={{ textAlign: 'right' }}>Sent</span><span style={{ textAlign: 'right' }}>Replies</span><span style={{ textAlign: 'right' }}>Reply %</span><span style={{ textAlign: 'right' }}>Interested</span><span style={{ textAlign: 'right' }}>Opt-outs</span>
              </div>
              {data.templatePerformance.map((t, i) => (
                <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', gap: '0', padding: '0.6rem 0', borderBottom: i < data.templatePerformance.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text)' }}>{t.name || `Touch ${t.touchNumber || i + 1}`}</div>
                    {t.touchNumber && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>Touch {t.touchNumber}</div>}
                  </div>
                  <NumCell value={t.sent} />
                  <NumCell value={t.replies} />
                  <NumCell value={t.replyRate !== null ? `${t.replyRate}%` : '—'} color={t.replyRate > 10 ? '#34d399' : t.replyRate > 5 ? '#fbbf24' : undefined} />
                  <NumCell value={t.interested} color={t.interested > 0 ? '#10b981' : undefined} />
                  <NumCell value={t.optOuts} color={t.optOuts > 0 ? '#f87171' : undefined} />
                </div>
              ))}
            </div>
          )}

          {/* ── Offers ── */}
          {offerStats.count > 0 || contacts.some(c => c.offers?.length) ? (
            <div style={card}>
              <div style={sectionTitle}>Offers — {PERIODS.find(p => p.value === period)?.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: offerStats.all.length ? '1.25rem' : 0 }}>
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.3rem' }}>Total Offers</div>
                  <div style={{ ...bigNum, color: '#fbbf24' }}>{offerStats.count}</div>
                </div>
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.3rem' }}>Total Value</div>
                  <div style={{ ...bigNum, color: '#60a5fa', fontSize: '1.5rem' }}>${offerStats.totalValue.toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.3rem' }}>Accepted Value</div>
                  <div style={{ ...bigNum, color: '#10b981', fontSize: '1.5rem' }}>${offerStats.acceptedValue.toLocaleString()}</div>
                </div>
              </div>

              {/* Status breakdown */}
              {Object.keys(offerStats.byStatus).length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: offerStats.all.length ? '1.25rem' : 0 }}>
                  {Object.entries(offerStats.byStatus).map(([status, count]) => {
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
              {offerStats.all.length > 0 && (
                <div>
                  <div style={{ ...cardLabel, marginBottom: '0.5rem' }}>Recent Offers</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 0, fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.4px', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                    <span>Contact</span><span style={{ textAlign: 'right' }}>Amount</span><span style={{ textAlign: 'right' }}>Status</span><span style={{ textAlign: 'right' }}>Date</span>
                  </div>
                  {offerStats.all.slice(0, 10).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((o, i) => {
                    const colors = { Pending: '#fbbf24', Accepted: '#10b981', Rejected: '#f87171', Countered: '#60a5fa' };
                    return (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 0, padding: '0.5rem 0', borderBottom: i < Math.min(offerStats.all.length, 10) - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text)' }}>{o.contactName}</span>
                        <span style={{ textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--mono)' }}>${Number(o.amount).toLocaleString()}</span>
                        <span style={{ textAlign: 'right', fontSize: '0.75rem', fontWeight: 600, color: colors[o.status] || 'var(--text-muted)' }}>{o.status}</span>
                        <span style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          {/* ── Contact status breakdown ── */}
          {Object.keys(data.contactStatusCounts).length > 0 && (
            <div style={card}>
              <div style={sectionTitle}>Pipeline — {term}</div>
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