import { useState, useEffect, useCallback } from 'react';
import { useApp, EMPTY_FILTERS } from '../context/AppContext';
import { resolveConfig } from '../lib/clientConfig';
import { summarizeNoteActivity } from '../lib/activityStats';
import { applyContactFilters, myFollowUps } from '../lib/contactFilters';
import { fetchNoteActivity } from '../lib/notes';
import { supabase } from '../lib/supabase';
import { ArrowLeft, CalendarClock } from 'lucide-react';

// The dashboard is about the person looking at it, not the workspace: their follow-ups
// and the notes they logged. Same layout for every preset — nothing here is land- or
// bank-specific, and anything workspace-wide belongs in the list and its stats pills.
export default function Dashboard({ onClose, onViewContact }) {
  const { user, currentClientId, currentClient, setFilters } = useApp();
  const cfg = resolveConfig(currentClient);
  const userId = user?.id;
  const [noteStats, setNoteStats]     = useState(null);
  const [noteLoading, setNoteLoading] = useState(true);
  const [noteError, setNoteError]     = useState(null);
  const [fuStats, setFuStats]         = useState(null);
  const [fuLoading, setFuLoading]     = useState(true);
  const [fuError, setFuError]         = useState(null);

  // My follow-ups due — the same filter pipeline as the list view (applyContactFilters
  // with the followUp facet from myFollowUps), so this count always equals what "Work the
  // queue" shows. Ordered most-neglected first: never-noted, then oldest last note.
  const loadFollowUps = useCallback(async () => {
    setFuLoading(true);
    setFuError(null);
    if (!currentClientId || !userId) { setFuLoading(false); return; }
    try {
      const followUp = myFollowUps(resolveConfig(currentClient).followUp, userId);
      let q = supabase.from('property_crm_contacts')
        .select('id,first_name,last_name,status,follow_up_on,last_note_at', { count: 'exact' })
        .eq('client_id', currentClientId)
        .order('last_note_at', { ascending: true, nullsFirst: true })
        .limit(10);
      q = applyContactFilters(q, { followUp });
      const { data, count, error } = await q;
      if (error) throw error;
      setFuStats({ count: count || 0, rows: data || [] });
    } catch (e) {
      console.error('loadFollowUps error:', e);
      setFuError(e.message);
    } finally {
      setFuLoading(false);
    }
  }, [currentClientId, currentClient, userId]);

  useEffect(() => {
    loadFollowUps();
  }, [loadFollowUps]);

  function workTheQueue() {
    setFilters({ ...EMPTY_FILTERS, followUp: myFollowUps(cfg.followUp, userId) });
    onClose();
  }

  // Notes I logged, bucketed today/7d/30d. One fetch covers all three windows.
  const loadNoteStats = useCallback(async () => {
    setNoteLoading(true);
    setNoteError(null);
    if (!currentClientId || !userId) { setNoteLoading(false); return; }
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      setNoteStats(summarizeNoteActivity(await fetchNoteActivity(currentClientId, userId, since)));
    } catch (e) {
      console.error('loadNoteStats error:', e);
      setNoteError(e.message);
    } finally {
      setNoteLoading(false);
    }
  }, [currentClientId, userId]);

  useEffect(() => {
    loadNoteStats();
  }, [loadNoteStats]);

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
  const cols = '2fr 1fr 1fr';

  return (
    <div style={{ padding: '0 2rem 2rem', maxWidth: '960px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', paddingTop: '1rem' }}>
        <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.875rem', padding: 0 }}><ArrowLeft size={14} /> Back</button>
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Dashboard</h2>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user?.email}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* ── My follow-ups due ── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
            <div style={{ ...sectionTitle, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CalendarClock size={13} /> My Follow-ups Due
            </div>
            {!fuLoading && fuStats?.count > 0 && (
              <button
                onClick={workTheQueue}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem', background: 'var(--accent)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                Work the queue →
              </button>
            )}
          </div>

          {fuLoading && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</div>
          )}

          {fuError && (
            <div style={{ color: '#f87171', fontSize: '0.875rem' }}>Failed to load follow-ups: {fuError}</div>
          )}

          {!fuLoading && fuStats && (
            fuStats.count === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                You have nobody due for follow-up. Nice work.
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ ...bigNum, color: 'var(--warning)' }}>{fuStats.count}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    of your {fuStats.count !== 1 ? cfg.terminology.contacts.toLowerCase() : cfg.terminology.contact.toLowerCase()} due — most neglected first
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '0.4px', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                  <span>{cfg.terminology.contact}</span><span>Status</span><span style={{ textAlign: 'right' }}>Due / Last Note</span>
                </div>
                {fuStats.rows.map(r => {
                  const name = `${r.first_name || ''} ${r.last_name || ''}`.trim() || '—';
                  const lastNote = r.last_note_at
                    ? `${Math.floor((Date.now() - new Date(r.last_note_at)) / 86400000)}d ago`
                    : 'Never';
                  return (
                    <div key={r.id} style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, padding: '0.5rem 0', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                      <span
                        onClick={() => { if (onViewContact) onViewContact({ id: r.id }); }}
                        style={{ fontSize: '0.8rem', color: onViewContact ? 'var(--accent)' : 'var(--text)', cursor: onViewContact ? 'pointer' : 'default', textDecoration: onViewContact ? 'underline' : 'none', textUnderlineOffset: '2px' }}
                      >{name}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{r.status || '—'}</span>
                      <span style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                        {r.follow_up_on ? `due ${new Date(r.follow_up_on + 'T00:00:00').toLocaleDateString()}` : lastNote}
                      </span>
                    </div>
                  );
                })}
                {fuStats.count > fuStats.rows.length && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingTop: '0.5rem' }}>
                    + {fuStats.count - fuStats.rows.length} more in your queue
                  </div>
                )}
              </>
            )
          )}
        </div>

        {/* ── My activity (notes I logged) ── */}
        <div style={card}>
          <div style={sectionTitle}>My Activity — Notes Logged</div>

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
                    {noteStats[key].contacts} {noteStats[key].contacts !== 1 ? cfg.terminology.contacts.toLowerCase() : cfg.terminology.contact.toLowerCase()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
