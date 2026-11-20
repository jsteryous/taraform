import { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Map as MapIcon } from 'lucide-react';
import { fetchCompanyLocations } from '../lib/contacts';
import { groupByLocation, boundsOf } from '../lib/geo';
import { displayName } from '../lib/links';

const SHOWN = 8;
// Where the map opens before any company has a pin.
const DEFAULT_CENTER = [34.85, -82.39];
const DEFAULT_ZOOM = 11;

// Dashboard card for workspaces with companies: every company with an address as a pin,
// colored by status, and the companies that aren't on the map yet, so missing addresses
// are a visible to-do instead of silently absent pins. Step 1 of PLAN.md "Call days".
//
// The map is OpenStreetMap tiles through Leaflet: free, no key. Coordinates come from the
// server (lib/geo.js explains the states); this only reads and draws.
export default function CompanyMap({ clientId, statuses, onViewContact }) {
  const [groups, setGroups]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      setGroups(groupByLocation(await fetchCompanyLocations(clientId)));
    } catch (e) {
      console.error('company map load error:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // Stable across renders, so the pins (and the map's fit) are redrawn only on new data.
  const colorOf = useCallback(status => statuses?.find(s => s.value === status)?.color || '#9ca3af', [statuses]);
  const placed = groups?.placed || [];
  const todo = groups ? [...groups.notFound, ...groups.pending, ...groups.missing] : [];

  return (
    <div className="dash-card">
      <div className="dash-section-title"><MapIcon size={13} /> Map</div>
      {loading && <div className="outreach-muted">Loading…</div>}
      {error && <div className="outreach-error">Failed to load the map: {error}</div>}
      {!loading && groups && (
        <>
          <div className="outreach-blurb">
            {placed.length} {placed.length === 1 ? 'company' : 'companies'} on the map
            {todo.length > 0 && <> · {todo.length} not yet</>}
          </div>
          <PinMap points={placed} colorOf={colorOf} onViewContact={onViewContact} />
          <Legend statuses={statuses} points={placed} />
          {todo.length > 0 && <NotOnMap groups={groups} onViewContact={onViewContact} />}
        </>
      )}
    </div>
  );
}

// Leaflet is imperative, so it lives in a ref: created once, pins redrawn when they change.
function PinMap({ points, colorOf, onViewContact }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const openRef = useRef(onViewContact);
  openRef.current = onViewContact;

  useEffect(() => {
    map.current = L.map(el.current, { scrollWheelZoom: false }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    layer.current.clearLayers();
    for (const c of points) {
      L.circleMarker([c.geoLat, c.geoLng], {
        radius: 8, weight: 2, color: '#ffffff', fillColor: colorOf(c.status), fillOpacity: 0.95,
      })
        .bindTooltip(`${escapeHtml(displayName(c))} · ${escapeHtml(c.status || '')}`)
        .on('click', () => openRef.current?.({ id: c.id }))
        .addTo(layer.current);
    }
    const b = boundsOf(points);
    if (b) map.current.fitBounds(b, { padding: [30, 30], maxZoom: 15 });
  }, [points, colorOf]);

  return <div ref={el} className="company-map" role="region" aria-label="Map of companies" />;
}

// Only the statuses that have a pin, so the key stays short.
function Legend({ statuses, points }) {
  const used = new Set(points.map(p => p.status));
  const shown = (statuses || []).filter(s => used.has(s.value));
  if (!shown.length) return null;
  return (
    <div className="company-map-legend">
      {shown.map(s => (
        <span key={s.value} className="company-map-key">
          <span className="company-map-dot" style={{ background: s.color }} />{s.value}
        </span>
      ))}
    </div>
  );
}

// The cleanup list: what to fix first (an address the geocoder couldn't match), then
// what's on its way, then the companies with no address at all.
function NotOnMap({ groups, onViewContact }) {
  const [all, setAll] = useState(false);
  const rows = [
    ...groups.notFound.map(c => ({ c, why: 'Address not found' })),
    ...groups.pending.map(c => ({ c, why: 'Being placed' })),
    ...groups.missing.map(c => ({ c, why: 'No address' })),
  ];
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <div className="company-map-todo">
      <div className="company-map-todo-title">Not on the map yet</div>
      {shown.map(({ c, why }) => (
        <div key={c.id} className="outreach-row-head company-map-todo-row">
          <button type="button" className="outreach-name" onClick={() => onViewContact?.({ id: c.id })}>{displayName(c)}</button>
          <span className={`outreach-status${why === 'Address not found' ? ' company-map-warn' : ''}`}>{why}</span>
        </div>
      ))}
      {rows.length > SHOWN && (
        <button type="button" className="outreach-more" onClick={() => setAll(a => !a)}>
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
