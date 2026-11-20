import { useState, useEffect, useRef, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Map as MapIcon, MapPin } from 'lucide-react';
import { fetchCompanyLocations } from '../lib/contacts';
import { groupByLocation, boundsOf } from '../lib/geo';
import { displayName } from '../lib/links';

// Vite bundles the library, so the worker isn't next to it where MapLibre looks by default.
maplibregl.setWorkerUrl(workerUrl);

const SHOWN = 8;
// Where the map opens before any company has a pin.
const DEFAULT_CENTER = [-82.39, 34.85]; // [lng, lat]
const DEFAULT_ZOOM = 11;

// Dashboard card for workspaces with companies: every company with an address as a pin,
// colored by status, and the companies that aren't on the map yet, so missing addresses
// are a visible to-do instead of silently absent pins. Step 1 of PLAN.md "Call days".
//
// The map is MapLibre over OpenFreeMap vector tiles (OpenStreetMap data): free, no key. Coordinates come from the
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

// MapLibre is imperative, so it lives in a ref: created once, pins redrawn when they change.
// Pins are a GeoJSON layer drawn by the map itself (not DOM markers), with the company name
// beside each pin once you zoom in. The basemap follows the app theme and is swapped in place
// when the theme changes; every style load re-adds the pin layers (setStyle drops them).
function PinMap({ points, colorOf, onViewContact }) {
  const el = useRef(null);
  const map = useRef(null);
  const data = useRef(EMPTY);
  const openRef = useRef(onViewContact);
  openRef.current = onViewContact;
  const theme = useBodyTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current,
      style: STYLES[themeRef.current],
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      cooperativeGestures: true,   // the page scrolls past the map; ctrl/two fingers to zoom
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // The compact attribution opens expanded on wide screens; start it folded to its (i).
    m.once('load', () => el.current?.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'company-map-popup' });
    m.on('style.load', () => addPinLayers(m, data.current, themeRef.current));
    m.on('mouseenter', PIN_LAYER, e => {
      m.getCanvas().style.cursor = 'pointer';
      const f = e.features[0];
      popup.setLngLat(f.geometry.coordinates)
        .setHTML(`<strong>${escapeHtml(f.properties.name)}</strong>${f.properties.status ? `<span>${escapeHtml(f.properties.status)}</span>` : ''}`)
        .addTo(m);
    });
    m.on('mouseleave', PIN_LAYER, () => { m.getCanvas().style.cursor = ''; popup.remove(); });
    m.on('click', PIN_LAYER, e => openRef.current?.({ id: e.features[0].properties.id }));

    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // Theme switch: new basemap, same camera; style.load puts the pins back.
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) { firstTheme.current = false; return; }
    map.current?.setStyle(STYLES[theme]);
  }, [theme]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    data.current = {
      type: 'FeatureCollection',
      features: points.map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.geoLng, c.geoLat] },
        properties: { id: c.id, name: displayName(c), status: c.status || '', color: colorOf(c.status) },
      })),
    };
    m.getSource(PIN_SOURCE)?.setData(data.current);
    const b = boundsOf(points);
    if (b) {
      // [[s, w], [n, e]] -> maplibre's [[w, s], [e, n]]
      m.fitBounds([[b[0][1], b[0][0]], [b[1][1], b[1][0]]], { padding: 50, maxZoom: 14, duration: 0 });
    }
  }, [points, colorOf]);

  return (
    <div className="company-map-wrap">
      <div ref={el} className="company-map" role="region" aria-label="Map of companies" />
      {points.length === 0 && (
        <div className="company-map-empty">
          <MapPin size={16} />
          <span>Add an address on a company&rsquo;s page and it shows up here within about 10 minutes.</span>
        </div>
      )}
    </div>
  );
}

// OpenFreeMap: free vector tiles from OpenStreetMap data, no key, commercial use allowed.
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark:  'https://tiles.openfreemap.org/styles/dark',
};
const PIN_SOURCE = 'companies';
const PIN_LAYER = 'company-pins';
const EMPTY = { type: 'FeatureCollection', features: [] };

function addPinLayers(m, geojson, theme) {
  if (m.getSource(PIN_SOURCE)) return;
  const dark = theme === 'dark';
  m.addSource(PIN_SOURCE, { type: 'geojson', data: geojson });
  // A soft halo under each pin so it reads against busy streets.
  m.addLayer({
    id: 'company-pins-halo', type: 'circle', source: PIN_SOURCE,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 9, 14, 15],
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.25,
      'circle-blur': 0.4,
    },
  });
  m.addLayer({
    id: PIN_LAYER, type: 'circle', source: PIN_SOURCE,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5.5, 14, 8.5],
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-color': dark ? '#0f0f0f' : '#ffffff',
    },
  });
  m.addLayer({
    id: 'company-labels', type: 'symbol', source: PIN_SOURCE, minzoom: 12,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-offset': [0.9, 0],
      'text-anchor': 'left',
      'text-max-width': 12,
      'text-optional': true,
    },
    paint: {
      'text-color': dark ? '#e8e8e8' : '#1f2937',
      'text-halo-color': dark ? 'rgba(10,10,10,0.85)' : 'rgba(255,255,255,0.9)',
      'text-halo-width': 1.5,
    },
  });
}

// 'light' or 'dark' (dim counts as dark), following the class App puts on <body>.
function useBodyTheme() {
  const read = () => (document.body.classList.contains('theme-light') ? 'light' : 'dark');
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(read()));
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return theme;
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
