import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApp, EMPTY_FILTERS } from '../../context/AppContext';
import ContactCard from './ContactCard';
import StatsBar from '../layout/StatsBar';
import VirtualList from './VirtualList';
import { resolveConfig } from '../../lib/clientConfig';
import { contactMatchesFilters } from '../../lib/contactFilters';
import { useConfirm } from '../shared/ConfirmDialog';
import { Search, X, ChevronDown, Building2, Inbox } from 'lucide-react';

const PHONE_OPTIONS = [
  { value: '',        label: 'Any Phone' },
  { value: 'has',     label: 'Has phone' },
  { value: 'missing', label: 'No phone' },
];
const EMAIL_OPTIONS = [
  { value: '',        label: 'Any Email' },
  { value: 'has',     label: 'Has email' },
  { value: 'missing', label: 'No email' },
];

export default function ContactList({ onView, onExport }) {
  const {
    contacts, totalCount, loadingContacts,
    currentClientId, currentClient,
    deleteContact, showToast,
    loadContacts, loadMoreContacts,
    filters, setFilters,
  } = useApp();

  const { search: filterSearch, statuses: filterStatuses, counties: filterCounties,
          phone: filterPhone, activity: filterActivity, email: filterEmail } = filters;

  const setFilterSearch    = useCallback((val) => setFilters(f => ({ ...f, search: val })),   [setFilters]);
  const setFilterStatuses  = useCallback((val) => setFilters(f => ({ ...f, statuses: val })), [setFilters]);
  const setFilterCounties  = useCallback((val) => setFilters(f => ({ ...f, counties: val })), [setFilters]);
  const setFilterPhone     = useCallback((val) => setFilters(f => ({ ...f, phone: val })),    [setFilters]);
  const setFilterActivity  = useCallback((val) => setFilters(f => ({ ...f, activity: val })), [setFilters]);
  const setFilterEmail     = useCallback((val) => setFilters(f => ({ ...f, email: val })),    [setFilters]);

  const cfg          = resolveConfig(currentClient);
  const ALL_STATUSES = useMemo(() => cfg.statuses.map(s => s.value), [cfg]);

  // Local UI state
  const [selected,      setSelected]      = useState(new Set());
  const [statusOpen,    setStatusOpen]    = useState(false);
  const [countyOpen,    setCountyOpen]    = useState(false);
  const [moreOpen,      setMoreOpen]      = useState(false);
  const [confirmBulkDelete, ConfirmUI]    = useConfirm();

  // Draft op/days for the custom "Note … N days" activity filter. Kept locally so
  // the inputs hold their values while the radio is off or the day field is mid-edit;
  // committed into filters.activity as "note_lt_N" / "note_gt_N".
  const [noteOp,   setNoteOp]   = useState('lt');
  const [noteDays, setNoteDays] = useState('30');

  // Accumulated county options (see the effect below) — reset per client.
  const [countyPool, setCountyPool] = useState([]);
  const countyPoolClient = useRef(null);

  const statusRef    = useRef(null);
  const countyRef    = useRef(null);
  const moreRef      = useRef(null);
  const searchTimer  = useRef(null);
  const noteTimer    = useRef(null);
  const selectAllRef = useRef(null);

  // Derive working values from props
  const search           = filterSearch   ?? '';
  const phoneFilter      = filterPhone    ?? '';
  const activityFilter   = filterActivity ?? '';
  const emailFilter      = filterEmail    ?? '';

  // Memoize Sets — avoids new object identity on every render
  const selectedStatuses = useMemo(() => new Set(filterStatuses ?? ALL_STATUSES), [filterStatuses, ALL_STATUSES]);
  const selectedCounties = useMemo(() => new Set(filterCounties ?? []), [filterCounties]);

  // Re-apply the active filters client-side. The list is already server-filtered, but a
  // contact edited in the detail overlay (status → Dead/Pass, a freshly logged note, …)
  // can drift out of the filter; re-checking here drops it on return without a refetch.
  // Note activity needs activity_log, which is now in LIST_FIELDS. See contactFilters.js.
  const filtered = useMemo(() => contacts.filter(c => contactMatchesFilters(c, filters)), [contacts, filters]);

  // Reload when filters change
  useEffect(() => {
    if (!currentClientId) return;
    const query = {
      statuses: filterStatuses ?? null,
      counties: filterCounties?.length ? filterCounties : null,
      phone:    phoneFilter || null,
      email:    emailFilter || null,
      search:   search || null,
      activity: activityFilter || null,
    };
    clearTimeout(searchTimer.current);
    if (search) {
      searchTimer.current = setTimeout(() => loadContacts(currentClientId, query), 300);
    } else {
      loadContacts(currentClientId, query);
    }
  }, [currentClientId, filters, loadContacts]);

  // Indeterminate checkbox state can't be set via JSX — requires a DOM ref.
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && selected.size < filtered.length;
    }
  }, [selected.size, filtered.length]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e) {
      if (statusRef.current && !statusRef.current.contains(e.target)) setStatusOpen(false);
      if (countyRef.current && !countyRef.current.contains(e.target)) setCountyOpen(false);
      if (moreRef.current   && !moreRef.current.contains(e.target))   setMoreOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') { setStatusOpen(false); setCountyOpen(false); setMoreOpen(false); }
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  function handleStatPillFilter(status) {
    if (status === null) setFilterStatuses(null);
    else setFilterStatuses([status]);
  }

  const hasActiveFilters =
    (filterStatuses !== null && filterStatuses.length < ALL_STATUSES.length) ||
    (filterCounties?.length > 0) ||
    phoneFilter !== '' ||
    emailFilter !== '' ||
    activityFilter !== '' ||
    search !== '';

  function clearAllFilters() {
    setFilters(EMPTY_FILTERS);
  }

  // Custom note-activity row. Interacting with any of its controls applies the
  // filter; the day input debounces like search so typing doesn't reload per keystroke.
  const noteActive = /^note_(lt|gt)_/.test(activityFilter);
  function activateNoteFilter() {
    const n = parseInt(noteDays, 10) || 30;
    setNoteDays(String(n));
    setFilterActivity(`note_${noteOp}_${n}`);
  }
  function onNoteOpChange(op) {
    setNoteOp(op);
    const n = parseInt(noteDays, 10) || 30;
    setNoteDays(String(n));
    setFilterActivity(`note_${op}_${n}`);
  }
  function onNoteDaysChange(val) {
    setNoteDays(val);
    const n = parseInt(val, 10);
    if (!n || n < 1) return;
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setFilterActivity(`note_${noteOp}_${n}`), 400);
  }

  // County options are gathered from loaded contacts but never removed once seen, so
  // selecting a county (which server-narrows `contacts` to just that county) doesn't make
  // the other options disappear. Reset when the client changes; the clientId guard keeps
  // a stale in-between render of the previous client's contacts from leaking in.
  useEffect(() => {
    setCountyPool(prev => {
      const reset = countyPoolClient.current !== currentClientId;
      countyPoolClient.current = currentClientId;
      const set = new Set(reset ? [] : prev);
      for (const c of contacts) if (c.county && c.clientId === currentClientId) set.add(c.county);
      const next = [...set];
      return (!reset && next.length === prev.length) ? prev : next;
    });
  }, [currentClientId, contacts]);

  // Always include the currently-selected counties so a fresh pick is never hidden.
  const counties = useMemo(() => {
    const set = new Set(countyPool);
    selectedCounties.forEach(c => set.add(c));
    return [...set].sort();
  }, [countyPool, selectedCounties]);

  function toggleStatus(s) {
    const next = new Set(selectedStatuses);
    next.has(s) ? next.delete(s) : next.add(s);
    setFilterStatuses([...next]);
  }
  function toggleCounty(c) {
    const next = new Set(selectedCounties);
    next.has(c) ? next.delete(c) : next.add(c);
    setFilterCounties([...next]);
  }
  const toggleSelect = useCallback((id) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  function toggleSelectAll() {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(c => c.id)));
  }
  async function deleteSelected() {
    const count = selected.size;
    if (!count || !await confirmBulkDelete(`Delete ${count} contact${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    await Promise.all([...selected].map(id => deleteContact(id)));
    setSelected(new Set());
    showToast(`${count} contacts deleted`);
  }

  // Triggers show a stable noun label + a count badge when a non-default selection is
  // active, so the bar never reflows as the selection changes.
  const statusActive = selectedStatuses.size < ALL_STATUSES.length;
  const countyActive = selectedCounties.size > 0;
  const moreActiveCount = (phoneFilter ? 1 : 0) + (emailFilter ? 1 : 0) + (activityFilter ? 1 : 0);

  // Current filter snapshot — used for load-more to continue with same query params
  const serverFilters = {
    statuses: filterStatuses ?? null,
    counties: filterCounties?.length ? filterCounties : null,
    phone:    phoneFilter || null,
    email:    emailFilter || null,
    search:   search || null,
    activity: activityFilter || null,
  };

  const filterBtnClass = (active) => `filter-btn${active ? ' active' : ''}`;

  if (!currentClientId) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><Building2 size={40} /></div>
        <p>Select a client above to get started</p>
      </div>
    );
  }

  return (
    <>
      {ConfirmUI}
      <StatsBar onFilterStatus={handleStatPillFilter} />

      {/* Filter bar */}
      <div className="filter-row">

        {/* Search — grows to a comfortable cap, then a spacer (below) takes the slack so
            the trigger buttons keep fixed positions. */}
        <div style={{ flex: '1 1 240px', maxWidth: '460px', minWidth: '200px', position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.875rem', color: 'rgba(99,160,255,0.6)', pointerEvents: 'none', zIndex: 1 }} />
          <input type="text" className="search"
            placeholder="Search by name, phone, address, tax map ID…"
            value={search} onChange={e => setFilterSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '2.25rem', paddingRight: search ? '2rem' : '1rem' }}
          />
          {search && <button onClick={() => setFilterSearch('')} style={{ position: 'absolute', right: '0.75rem', background: 'none', border: 'none', color: 'rgba(99,160,255,0.7)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0, zIndex: 1 }}><X size={14} /></button>}
        </div>

        {/* Status */}
        <div ref={statusRef} style={{ position: 'relative' }}>
          <button onClick={() => setStatusOpen(o => !o)} aria-expanded={statusOpen} aria-label="Filter by status" className={filterBtnClass(statusActive)}>
            <span className="filter-btn-label">Status</span>
            {statusActive && <span className="filter-count">{selectedStatuses.size}</span>}
            <ChevronDown size={12} className="filter-chevron" />
          </button>
          {statusOpen && (
            <div className="filter-dropdown">
              <div className="filter-dropdown-actions">
                <button className="btn-small" onClick={() => setFilterStatuses(null)}>All</button>
                <button className="btn-small" onClick={() => setFilterStatuses([])}>None</button>
              </div>
              {ALL_STATUSES.map(s => (
                <label key={s} className="filter-dropdown-item">
                  <input type="checkbox" checked={selectedStatuses.has(s)} onChange={() => toggleStatus(s)} style={{ width: '14px', height: '14px' }} />
                  {s}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* County */}
        {counties.length > 0 && (
          <div ref={countyRef} style={{ position: 'relative' }}>
            <button onClick={() => setCountyOpen(o => !o)} aria-expanded={countyOpen} aria-label="Filter by county" className={filterBtnClass(countyActive)}>
              <span className="filter-btn-label">County</span>
              {countyActive && <span className="filter-count">{selectedCounties.size}</span>}
              <ChevronDown size={12} className="filter-chevron" />
            </button>
            {countyOpen && (
              <div className="filter-dropdown">
                <div className="filter-dropdown-actions">
                  <button className="btn-small" onClick={() => setFilterCounties([])}>All</button>
                </div>
                {counties.map(c => (
                  <label key={c} className="filter-dropdown-item">
                    <input type="checkbox" checked={selectedCounties.has(c)} onChange={() => toggleCounty(c)} style={{ width: '14px', height: '14px' }} />
                    {c}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* More filters */}
        <div ref={moreRef} style={{ position: 'relative' }}>
          <button onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen} aria-label="More filters" className={filterBtnClass(moreActiveCount > 0)}>
            <span className="filter-btn-label">Filters</span>
            {moreActiveCount > 0 && <span className="filter-count">{moreActiveCount}</span>}
            <ChevronDown size={12} className="filter-chevron" />
          </button>
          {moreOpen && (
            <div className="filter-dropdown filter-dropdown--right">
              <div className="filter-dropdown-section">Phone</div>
              {PHONE_OPTIONS.map(o => (
                <label key={o.value} className="filter-dropdown-item">
                  <input type="radio" name="phone_filter" checked={phoneFilter === o.value} onChange={() => setFilterPhone(o.value)} style={{ width: '14px', height: '14px' }} />
                  {o.label}
                </label>
              ))}
              <div className="filter-dropdown-section">Email</div>
              {EMAIL_OPTIONS.map(o => (
                <label key={o.value} className="filter-dropdown-item">
                  <input type="radio" name="email_filter" checked={emailFilter === o.value} onChange={() => setFilterEmail(o.value)} style={{ width: '14px', height: '14px' }} />
                  {o.label}
                </label>
              ))}
              <div className="filter-dropdown-section">Activity</div>
              <label className="filter-dropdown-item">
                <input type="radio" name="activity_filter" checked={activityFilter === ''} onChange={() => setFilterActivity('')} style={{ width: '14px', height: '14px' }} />
                Any activity
              </label>
              <label className="filter-dropdown-item">
                <input type="radio" name="activity_filter" checked={noteActive} onChange={activateNoteFilter} style={{ width: '14px', height: '14px' }} />
                Note activity…
              </label>
              {noteActive && (
                <div className="filter-note-controls">
                  <div className="seg-toggle" role="group" aria-label="Note activity direction">
                    <button type="button" className={`seg-btn${noteOp === 'lt' ? ' active' : ''}`} onClick={() => onNoteOpChange('lt')}>Within</button>
                    <button type="button" className={`seg-btn${noteOp === 'gt' ? ' active' : ''}`} onClick={() => onNoteOpChange('gt')}>Older than</button>
                  </div>
                  <input
                    type="number" min="1" value={noteDays}
                    onChange={e => onNoteDaysChange(e.target.value)}
                    aria-label="Note activity days"
                    className="filter-note-days"
                  />
                  days
                </div>
              )}
              <label className="filter-dropdown-item">
                <input type="radio" name="activity_filter" checked={activityFilter === 'note_never'} onChange={() => setFilterActivity('note_never')} style={{ width: '14px', height: '14px' }} />
                No notes ever
              </label>
            </div>
          )}
        </div>

        {/* Spacer absorbs the width of the clear button appearing so the triggers don't move. */}
        <div style={{ flex: '1 1 0', minWidth: '0.5rem' }} />

        <div className="filter-meta">
          {hasActiveFilters && (
            <button className="filter-clear" onClick={clearAllFilters}>
              <X size={12} /> Clear filters
            </button>
          )}
          <span className="filter-count-text">
            {loadingContacts ? 'Loading…' : `${filtered.length} of ${totalCount}`}
          </span>
        </div>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span style={{ fontSize: '0.875rem', color: '#60a5fa', fontWeight: 500 }}>{selected.size} selected</span>
          <button className="btn-small" onClick={() => { onExport(filtered.filter(c => selected.has(c.id))); }}>Export Selected</button>
          <button className="btn-small btn-danger" onClick={deleteSelected}>Delete</button>
          <button className="btn-small" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {/* Select all */}
      <div className="select-all-row">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input ref={selectAllRef} type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
          Select all {filtered.length}
        </label>
      </div>

      {/* List */}
      <div className="list-wrap">
        {loadingContacts && contacts.length === 0 ? (
          <div className="contact-skeleton-list">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="contact-skeleton">
                <div className="skeleton-bar" />
                <div />
                <div className="skeleton-bar" style={{ width: '70%' }} />
                <div className="skeleton-bar" style={{ width: '55%' }} />
                <div className="skeleton-bar" style={{ width: '45%' }} />
                <div className="skeleton-bar" style={{ width: '80%' }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Inbox size={40} /></div>
            <p>{totalCount === 0 ? 'Add your first contact or import a CSV' : 'No contacts match your filters'}</p>
          </div>
        ) : (
          <>
            <VirtualList
              items={filtered}
              renderItem={(c) => (
                <ContactCard key={c.id} contact={c} selected={selected.has(c.id)} onSelect={toggleSelect} onClick={onView} />
              )}
            />
            {/* Load more */}
            {contacts.length < totalCount && (
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <button
                  onClick={() => loadMoreContacts(currentClientId, serverFilters)}
                  disabled={loadingContacts}
                  style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem 1.25rem', cursor: 'pointer' }}
                >
                  {loadingContacts ? 'Loading…' : `Load more (${totalCount - contacts.length} remaining)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}