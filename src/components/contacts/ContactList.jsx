import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApp, EMPTY_FILTERS } from '../../context/AppContext';
import ContactCard from './ContactCard';
import StatsBar from '../layout/StatsBar';
import VirtualList from './VirtualList';
import { resolveConfig } from '../../lib/clientConfig';
import SendEmailModal from '../modals/SendEmailModal';
import { useConfirm } from '../shared/ConfirmDialog';

const ACTIVITY_OPTIONS = [
  { value: '',           label: 'Any Activity' },
  { value: 'note_7',     label: 'Note in last 7 days' },
  { value: 'note_30',    label: 'Note in last 30 days' },
  { value: 'note_never', label: 'No notes ever' },
  { value: 'sms_7',      label: 'SMS in last 7 days' },
  { value: 'sms_30',     label: 'SMS in last 30 days' },
  { value: 'sms_never',  label: 'No SMS ever' },
];
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

function daysAgo(n) { return new Date(Date.now() - n * 24 * 60 * 60 * 1000); }

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
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [confirmBulkDelete, ConfirmUI]    = useConfirm();

  const statusRef    = useRef(null);
  const countyRef    = useRef(null);
  const moreRef      = useRef(null);
  const searchTimer  = useRef(null);
  const selectAllRef = useRef(null);

  // Derive working values from props
  const search           = filterSearch   ?? '';
  const phoneFilter      = filterPhone    ?? '';
  const activityFilter   = filterActivity ?? '';
  const emailFilter      = filterEmail    ?? '';

  // Memoize Sets — avoids new object identity on every render
  const selectedStatuses = useMemo(() => new Set(filterStatuses ?? ALL_STATUSES), [filterStatuses, ALL_STATUSES]);
  const selectedCounties = useMemo(() => new Set(filterCounties ?? []), [filterCounties]);

  // Note activity filter is client-side (activityLog JSONB not fetched in list query).
  // SMS activity filters are handled server-side via last_sms_at in buildQuery.
  const filtered = useMemo(() => {
    if (!activityFilter) return contacts;
    const [type, period] = activityFilter.split('_');
    if (type !== 'note') return contacts;
    return contacts.filter(c => {
      const notes = (c.activityLog || []).filter(e => e.type === 'note' || (!e.type && e.text));
      const lastNote = notes.map(e => new Date(e.timestamp || e.createdAt)).filter(d => !isNaN(d)).sort((a,b) => b-a)[0];
      if (period === 'never' && lastNote) return false;
      if (period === '7'  && (!lastNote || lastNote < daysAgo(7)))  return false;
      if (period === '30' && (!lastNote || lastNote < daysAgo(30))) return false;
      return true;
    });
  }, [contacts, activityFilter]);

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
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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

  const counties = useMemo(
    () => [...new Set(contacts.map(c => c.county).filter(Boolean))].sort(),
    [contacts]
  );

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

  const statusLabel = selectedStatuses.size === ALL_STATUSES.length ? 'All Statuses'
    : selectedStatuses.size === 0 ? 'No Status'
    : selectedStatuses.size === 1 ? [...selectedStatuses][0]
    : `${selectedStatuses.size} statuses`;

  const countyLabel = selectedCounties.size === 0 ? 'All Counties'
    : selectedCounties.size === 1 ? [...selectedCounties][0]
    : `${selectedCounties.size} counties`;

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
        <div className="empty-icon">🏢</div>
        <p>Select a client above to get started</p>
      </div>
    );
  }

  return (
    <>
      {ConfirmUI}
      <StatsBar onFilterStatus={handleStatPillFilter} />

      {/* Filter bar */}
      <div style={{ padding: '1rem 2rem 0.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>

        {/* Search */}
        <div style={{ flex: 1, minWidth: '220px', position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: '0.875rem', color: 'rgba(99,160,255,0.6)', fontSize: '1rem', pointerEvents: 'none', zIndex: 1 }}>⌕</span>
          <input type="text" className="search"
            placeholder="Search by name, phone, address, tax map ID…"
            value={search} onChange={e => setFilterSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '2.25rem', paddingRight: search ? '2rem' : '1rem' }}
          />
          {search && <button onClick={() => setFilterSearch('')} style={{ position: 'absolute', right: '0.75rem', background: 'none', border: 'none', color: 'rgba(99,160,255,0.7)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: 0, zIndex: 1 }}>×</button>}
        </div>

        {/* Status */}
        <div ref={statusRef} style={{ position: 'relative' }}>
          <button onClick={() => setStatusOpen(o => !o)} aria-expanded={statusOpen} aria-label="Filter by status" className={filterBtnClass(selectedStatuses.size < ALL_STATUSES.length)}>
            <span>{statusLabel}</span>
            <span style={{ fontSize: 'var(--text-xs)', opacity: 0.6 }}>▾</span>
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
            <button onClick={() => setCountyOpen(o => !o)} aria-expanded={countyOpen} aria-label="Filter by county" className={filterBtnClass(selectedCounties.size > 0)}>
              <span>{countyLabel}</span>
              <span style={{ fontSize: 'var(--text-xs)', opacity: 0.6 }}>▾</span>
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
          <button onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen} aria-label="More filters" className={filterBtnClass(moreActiveCount > 0)} style={{ minWidth: 'auto', gap: '0.4rem' }}>
            <span>Filters{moreActiveCount > 0 ? ` (${moreActiveCount})` : ''}</span>
            <span style={{ fontSize: 'var(--text-xs)', opacity: 0.6 }}>▾</span>
          </button>
          {moreOpen && (
            <div className="filter-dropdown" style={{ minWidth: '240px' }}>
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
              {ACTIVITY_OPTIONS.map(o => (
                <label key={o.value} className="filter-dropdown-item">
                  <input type="radio" name="activity_filter" checked={activityFilter === o.value} onChange={() => setFilterActivity(o.value)} style={{ width: '14px', height: '14px' }} />
                  {o.label}
                </label>
              ))}
            </div>
          )}
        </div>

        {hasActiveFilters && (
          <button onClick={clearAllFilters} style={{ fontSize: '0.8rem', color: '#f87171', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '6px', padding: '0.35rem 0.75rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            ✕ Clear filters
          </button>
        )}

        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {loadingContacts ? 'Loading…' : `${filtered.length} of ${totalCount}`}
        </span>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div style={{ padding: '0.5rem 2rem', display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(59,130,246,0.08)', borderBottom: '1px solid rgba(59,130,246,0.2)' }}>
          <span style={{ fontSize: '0.875rem', color: '#60a5fa', fontWeight: 500 }}>{selected.size} selected</span>
          <button className="btn-small" onClick={() => { onExport(filtered.filter(c => selected.has(c.id))); }}>Export Selected</button>
          <button className="btn-small" onClick={() => setShowSendEmail(true)}>✉ Send Emails</button>
          <button className="btn-small btn-danger" onClick={deleteSelected}>Delete</button>
          <button className="btn-small" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <SendEmailModal open={showSendEmail} onClose={() => setShowSendEmail(false)} selectedContacts={filtered.filter(c => selected.has(c.id))} />

      {/* Select all */}
      <div style={{ padding: '0.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input ref={selectAllRef} type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
          Select all {filtered.length}
        </label>
      </div>

      {/* List */}
      <div style={{ padding: '0 2rem' }}>
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
            <div className="empty-icon">📋</div>
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