import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import ContactCard from './ContactCard';
import StatsBar from '../layout/StatsBar';
import VirtualList from './VirtualList';
import { resolveConfig } from '../../lib/clientConfig';
import SendEmailModal from '../modals/SendEmailModal';

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

export default function ContactList({ onView, onExport,
  filterSearch, setFilterSearch,
  filterStatuses, setFilterStatuses,
  filterCounties, setFilterCounties,
  filterPhone, setFilterPhone,
  filterActivity, setFilterActivity,
  filterEmail, setFilterEmail,
}) {
  const {
    contacts, totalCount, loadingContacts,
    currentClientId, currentClient,
    deleteContact, showToast,
    loadContacts, loadMoreContacts,
  } = useApp();

  const cfg          = resolveConfig(currentClient);
  const ALL_STATUSES = cfg.statuses.map(s => s.value);

  // Local UI state
  const [selected,      setSelected]      = useState(new Set());
  const [statusOpen,    setStatusOpen]    = useState(false);
  const [countyOpen,    setCountyOpen]    = useState(false);
  const [moreOpen,      setMoreOpen]      = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);

  const statusRef = useRef(null);
  const countyRef = useRef(null);
  const moreRef   = useRef(null);
  const searchTimer = useRef(null);

  // Derive working values from props
  const search           = filterSearch   ?? '';
  const phoneFilter      = filterPhone    ?? '';
  const activityFilter   = filterActivity ?? '';
  const emailFilter      = filterEmail    ?? '';

  // Memoize Sets — avoids new object identity on every render
  const selectedStatuses = useMemo(() => new Set(filterStatuses ?? ALL_STATUSES), [filterStatuses, ALL_STATUSES.join(',')]); // eslint-disable-line
  const selectedCounties = useMemo(() => new Set(filterCounties ?? []), [filterCounties]);

  // Build filters object for server query
  const serverFilters = {
    statuses:  filterStatuses ?? null, // null = all
    counties:  filterCounties?.length ? filterCounties : null,
    phone:     phoneFilter || null,
    email:     emailFilter || null,
    search:    search || null,
    activity:  activityFilter || null,
  };

  // Reload when filters change
  useEffect(() => {
    if (!currentClientId) return;
    clearTimeout(searchTimer.current);
    if (search) {
      // Debounce search
      searchTimer.current = setTimeout(() => {
        loadContacts(currentClientId, serverFilters);
      }, 300);
    } else {
      loadContacts(currentClientId, serverFilters);
    }
  }, [currentClientId, filterSearch, filterStatuses, filterCounties, filterPhone, filterEmail, filterActivity]); // eslint-disable-line

  // Reset on client change
  useEffect(() => {
    setFilterStatuses(null);
    setFilterCounties([]);
    setFilterSearch('');
    setFilterPhone('');
    setFilterEmail('');
    setFilterActivity('');
    setSelected(new Set());
  }, [currentClientId]); // eslint-disable-line

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
    setFilterSearch('');
    setFilterStatuses(null);
    setFilterCounties([]);
    setFilterPhone('');
    setFilterEmail('');
    setFilterActivity('');
  }

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

  // Get unique counties from loaded contacts for the dropdown
  const counties = [...new Set(contacts.map(c => c.county).filter(Boolean))].sort();

  function setSelectedStatuses(val) {
    if (typeof val === 'function') setFilterStatuses(prev => [...val(new Set(prev ?? ALL_STATUSES))]);
    else setFilterStatuses(val === null ? null : [...val]);
  }
  function setSelectedCounties(val) {
    if (typeof val === 'function') setFilterCounties(prev => [...val(new Set(prev ?? []))]);
    else setFilterCounties([...val]);
  }
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
    if (!count || !confirm(`Delete ${count} contacts?`)) return;
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

  const filterBtn = (active) => ({
    display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '140px',
    justifyContent: 'space-between',
    background: active ? 'rgba(59,130,246,0.12)' : 'var(--surface)',
    borderColor:  active ? 'rgba(59,130,246,0.5)' : 'var(--border)',
    color:        active ? '#60a5fa' : 'var(--text)',
  });

  const dropStyle = {
    position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: '210px',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px',
    zIndex: 500, padding: '0.5rem', maxHeight: '300px', overflowY: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  };

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
          <button onClick={() => setStatusOpen(o => !o)} style={filterBtn(selectedStatuses.size < ALL_STATUSES.length)}>
            <span style={{ fontSize: '0.875rem' }}>{statusLabel}</span>
            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>▾</span>
          </button>
          {statusOpen && (
            <div style={dropStyle}>
              <div style={{ display: 'flex', gap: '0.5rem', padding: '0.25rem 0.5rem 0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                <button className="btn-small" onClick={() => setFilterStatuses(null)}>All</button>
                <button className="btn-small" onClick={() => setFilterStatuses([])}>None</button>
              </div>
              {ALL_STATUSES.map(s => (
                <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.4rem 0.5rem', cursor: 'pointer', fontSize: '0.875rem', borderRadius: '4px' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
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
            <button onClick={() => setCountyOpen(o => !o)} style={filterBtn(selectedCounties.size > 0)}>
              <span style={{ fontSize: '0.875rem' }}>{countyLabel}</span>
              <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>▾</span>
            </button>
            {countyOpen && (
              <div style={dropStyle}>
                <div style={{ display: 'flex', gap: '0.5rem', padding: '0.25rem 0.5rem 0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                  <button className="btn-small" onClick={() => setFilterCounties([])}>All</button>
                </div>
                {counties.map(c => (
                  <label key={c} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.4rem 0.5rem', cursor: 'pointer', fontSize: '0.875rem', borderRadius: '4px' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
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
          <button onClick={() => setMoreOpen(o => !o)} style={{ ...filterBtn(moreActiveCount > 0), minWidth: 'auto', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.875rem' }}>Filters{moreActiveCount > 0 ? ` (${moreActiveCount})` : ''}</span>
            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>▾</span>
          </button>
          {moreOpen && (
            <div style={{ ...dropStyle, minWidth: '240px' }}>
              <div style={{ padding: '0.25rem 0.5rem 0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.5rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>Phone</div>
              {PHONE_OPTIONS.map(o => (
                <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.4rem 0.5rem', cursor: 'pointer', fontSize: '0.875rem', borderRadius: '4px' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <input type="radio" name="phone_filter" checked={phoneFilter === o.value} onChange={() => setFilterPhone(o.value)} style={{ width: '14px', height: '14px' }} />
                  {o.label}
                </label>
              ))}
              <div style={{ padding: '0.5rem 0.5rem 0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.5rem', marginTop: '0.5rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>Email</div>
              {EMAIL_OPTIONS.map(o => (
                <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.4rem 0.5rem', cursor: 'pointer', fontSize: '0.875rem', borderRadius: '4px' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <input type="radio" name="email_filter" checked={emailFilter === o.value} onChange={() => setFilterEmail(o.value)} style={{ width: '14px', height: '14px' }} />
                  {o.label}
                </label>
              ))}
              <div style={{ padding: '0.5rem 0.5rem 0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.5rem', marginTop: '0.5rem', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>Activity</div>
              {ACTIVITY_OPTIONS.map(o => (
                <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.4rem 0.5rem', cursor: 'pointer', fontSize: '0.875rem', borderRadius: '4px' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
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
          <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
          Select all {filtered.length}
        </label>
      </div>

      {/* List */}
      <div style={{ padding: '0 2rem' }}>
        {loadingContacts && contacts.length === 0 ? (
          <div className="empty-state"><div className="empty-icon">⏳</div><p>Loading contacts…</p></div>
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