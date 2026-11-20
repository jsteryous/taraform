import { useState, useEffect, useCallback, useMemo } from 'react';
import { Route, ExternalLink } from 'lucide-react';
import { fetchCompanyLocations } from '../lib/contacts';
import { suggestAreas, stopReason, orderStops, routeLinks } from '../lib/visitDay';
import { displayName } from '../lib/links';

// Dashboard card: a day of walk-ins. Suggests the tightest bunches of companies worth a
// stop, lists one in driving order, and hands the route to Google Maps on the phone.
// The rules are lib/visitDay.js; this only loads, picks and lists.
export default function VisitDayCard({ clientId, followUp, onViewContact }) {
  const [companies, setCompanies] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [areaIdx, setAreaIdx]     = useState(0);
  const [skipped, setSkipped]     = useState(() => new Set());

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      setCompanies(await fetchCompanyLocations(clientId));
    } catch (e) {
      console.error('visit day load error:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const areas = useMemo(() => suggestAreas(companies, followUp), [companies, followUp]);
  // Worth a stop but not on the map, so they can't be planned yet.
  const unplaced = useMemo(() => (companies || []).filter(c =>
    !(Number.isFinite(c.geoLat) && Number.isFinite(c.geoLng)) && stopReason(c, followUp)).length,
  [companies, followUp]);

  const area = areas[Math.min(areaIdx, areas.length - 1)];
  const kept = useMemo(() => (area ? orderStops(area.stops.filter(s => !skipped.has(s.id))) : []), [area, skipped]);
  const legs = useMemo(() => routeLinks(kept), [kept]);
  const order = new Map(kept.map((s, i) => [s.id, i + 1]));
  // Kept stops in driving order, then the skipped ones greyed at the bottom.
  const rows = area ? [...kept, ...area.stops.filter(s => skipped.has(s.id))] : [];

  function pick(i) { setAreaIdx(i); setSkipped(new Set()); }
  function toggle(id) {
    setSkipped(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <div className="dash-card">
      <div className="dash-section-title"><Route size={13} /> Plan a visit day</div>
      {loading && <div className="outreach-muted">Loading…</div>}
      {error && <div className="outreach-error">Failed to load companies: {error}</div>}
      {!loading && !error && !area && (
        <div className="outreach-muted">
          No area to suggest yet. Visits are planned from companies on the map that are due for
          follow-up or still a Target or Prospect.
          {unplaced > 0 && <> {unplaced} {unplaced === 1 ? 'company like that has' : 'companies like that have'} no address yet.</>}
        </div>
      )}
      {!loading && area && (
        <>
          <div className="outreach-blurb">
            Companies close together that are due or still being pursued. Untick any you&rsquo;ll skip.
            {unplaced > 0 && <> {unplaced} more {unplaced === 1 ? 'needs' : 'need'} an address to be planned.</>}
          </div>
          {areas.length > 1 && (
            <div className="visit-areas" role="tablist">
              {areas.map((a, i) => (
                <button key={a.stops[0].id} type="button" role="tab" aria-selected={a === area}
                  className={`visit-area${a === area ? ' active' : ''}`} onClick={() => pick(i)}>
                  {a.name} <span className="visit-area-n">{a.stops.length}</span>
                </button>
              ))}
            </div>
          )}
          <div className="visit-summary">
            <strong>{area.name}</strong>: {area.stops.length} {area.stops.length === 1 ? 'company' : 'companies'}
            {area.due > 0 && <>, {area.due} due</>}
            {area.never > 0 && <>, {area.never} never contacted</>}
          </div>
          <ol className="visit-stops">
            {rows.map(s => {
              const off = skipped.has(s.id);
              return (
                <li key={s.id} className={`visit-stop${off ? ' off' : ''}`}>
                  <input type="checkbox" checked={!off} onChange={() => toggle(s.id)} aria-label={`Visit ${displayName(s)}`} />
                  <span className="visit-num">{off ? '' : order.get(s.id)}</span>
                  <div className="visit-body">
                    <div className="outreach-row-head">
                      <button type="button" className="outreach-name" onClick={() => onViewContact?.({ id: s.id })}>{displayName(s)}</button>
                      <span className="outreach-status">{s.status}</span>
                      {s.reason.due && <span className="visit-tag due">Due</span>}
                      {s.reason.never && <span className="visit-tag">Never contacted</span>}
                    </div>
                    <div className="visit-addr">{s.address}</div>
                  </div>
                </li>
              );
            })}
          </ol>
          {legs.length > 0 && (
            <div className="visit-links">
              {legs.map(l => (
                <a key={l.from} className="visit-go" href={l.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={13} />
                  {legs.length === 1 ? 'Open in Google Maps' : `Stops ${l.from}–${l.to} in Google Maps`}
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
