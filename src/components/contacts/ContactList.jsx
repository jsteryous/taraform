import { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import ContactCard from './ContactCard';
import StatsBar from '../layout/StatsBar';
import VirtualList from './VirtualList';

const ALL_STATUSES = ['New Lead','Contacted','Offer Made','Offer Rejected/NFS','UC','Closed','Dead/Pass'];

export default function ContactList({ onView }) {
  const { contacts, currentClientId, deleteContact, showToast } = useApp();
  const [search, setSearch]           = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState(new Set(ALL_STATUSES));
  const [selectedCounties, setSelectedCounties] = useState(new Set());
  const [selected, setSelected]       = useState(new Set());
  const [statusOpen, setStatusOpen]   = useState(false);
  const [countyOpen, setCountyOpen]   = useState(false);
  const statusRef = useRef(null);
  const countyRef = useRef(null);

  function handleStatPillFilter(status) {
    if (status === null) setSelectedStatuses(new Set(ALL_STATUSES));
    else setSelectedStatuses(new Set([status]));
  }

  useEffect(() => {
    function handler(e) {
      if (statusRef.current && !statusRef.current.contains(e.target)) setStatusOpen(false);
      if (countyRef.current && !countyRef.current.contains(e.target)) setCountyOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const counties = useMemo(() => [...new Set(contacts.map(c => c.county).filter(Boolean))].sort(), [contacts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return contacts.filter(c => {
      if (!selectedStatuses.has(c.status)) return false;
      if (selectedCounties.size > 0 && !selectedCounties.has(c.county)) return false;
      if (!q) return true;
      return (
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        (c.phones || []).some(p => p.includes(q)) ||
        (c.propertyAddresses || []).some(a => a.toLowerCase().includes(q)) ||
        (c.taxMapIds || []).some(t => t.toLowerCase().includes(q)) ||
        (c.county || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, search, selectedStatuses, selectedCounties]);

  function toggleStatus(s) {
    setSelectedStatuses(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }

  function toggleCounty(c) {
    setSelectedCounties(prev => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(c => c.id)));
  }

  async function deleteSelected() {
    if (!selected.size || !confirm(`Delete ${selected.size} contacts?`)) return;
    for (const id of selected) await deleteContact(id);
    setSelected(new Set());
    showToast(`${selected.size} contacts deleted`);
  }

  const statusLabel = selectedStatuses.size === ALL_STATUSES.length ? 'All Statuses'
    : selectedStatuses.size === 0 ? 'No Status'
    : selectedStatuses.size === 1 ? [...selectedStatuses][0]
    : `${selectedStatuses.size} statuses`;

  const countyLabel = selectedCounties.size === 0 ? 'All Counties'
    : selectedCounties.size === 1 ? [...selectedCounties][0]
    : `${selectedCounties.size} counties`;

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
      <StatsBar filtered={filtered} onFilterStatus={handleStatPillFilter} />

      {/* ── Search + Filter bar ── */}
      <div style={{ padding: '1rem 2rem 0.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ flex: 1, minWidth: '220px', position: 'relative', display: 'flex', alignItems: 'center' }}>
          <span style={{ position: 'absolute', left: '0.875rem', color: 'rgba(99,160,255,0.6)', fontSize: '1rem', pointerEvents: 'none', zIndex: 1 }}>⌕</span>
          <input
            type="text"
            className="search"
            placeholder="Search by name, phone, address, tax map ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: '2.25rem', paddingRight: search ? '2rem' : '1rem' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: '0.75rem', background: 'none', border: 'none', color: 'rgba(99,160,255,0.7)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: 0, zIndex: 1 }}>×</button>
          )}
        </div>

        {/* Status filter */}
        <div ref={statusRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setStatusOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '150px', justifyContent: 'space-between',
              background: selectedStatuses.size < ALL_STATUSES.length ? 'rgba(59,130,246,0.12)' : 'var(--surface)',
              borderColor: selectedStatuses.size < ALL_STATUSES.length ? 'rgba(59,130,246,0.5)' : 'var(--border)',
              color: selectedStatuses.size < ALL_STATUSES.length ? '#60a5fa' : 'var(--text)',
            }}
          >
            <span style={{ fontSize: '0.875rem' }}>{statusLabel}</span>
            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>▾</span>
          </button>
          {statusOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: '210px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 500, padding: '0.5rem', maxHeight: '280px', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
              <div style={{ display: 'flex', gap: '0.5rem', padding: '0.25rem 0.5rem 0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                <button className="btn-small" onClick={() => setSelectedStatuses(new Set(ALL_STATUSES))}>All</button>
                <button className="btn-small" onClick={() => setSelectedStatuses(new Set())}>None</button>
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

        {/* County filter */}
        {counties.length > 0 && (
          <div ref={countyRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setCountyOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '150px', justifyContent: 'space-between',
                background: selectedCounties.size > 0 ? 'rgba(59,130,246,0.12)' : 'var(--surface)',
                borderColor: selectedCounties.size > 0 ? 'rgba(59,130,246,0.5)' : 'var(--border)',
                color: selectedCounties.size > 0 ? '#60a5fa' : 'var(--text)',
              }}
            >
              <span style={{ fontSize: '0.875rem' }}>{countyLabel}</span>
              <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>▾</span>
            </button>
            {countyOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: '180px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 500, padding: '0.5rem', maxHeight: '280px', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
                <div style={{ display: 'flex', gap: '0.5rem', padding: '0.25rem 0.5rem 0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '0.25rem' }}>
                  <button className="btn-small" onClick={() => setSelectedCounties(new Set())}>All</button>
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

        {/* Result count */}
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          {filtered.length} of {contacts.length}
        </span>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div style={{ padding: '0.5rem 2rem', display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(59,130,246,0.08)', borderBottom: '1px solid rgba(59,130,246,0.2)' }}>
          <span style={{ fontSize: '0.875rem', color: '#60a5fa', fontWeight: 500 }}>{selected.size} selected</span>
          <button className="btn-small btn-danger" onClick={deleteSelected}>Delete</button>
          <button className="btn-small" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {/* Select all row */}
      <div style={{ padding: '0.5rem 2rem', borderBottom: '1px solid var(--border)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
          Select all {filtered.length}
        </label>
      </div>

      {/* Contact list - virtualized for performance */}
      <div style={{ padding: '0 2rem' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <p>{contacts.length === 0 ? 'Add your first contact or import a CSV' : 'No contacts match your filters'}</p>
          </div>
        ) : (
          <VirtualList
            items={filtered}
            renderItem={(c) => (
              <ContactCard
                key={c.id}
                contact={c}
                selected={selected.has(c.id)}
                onSelect={toggleSelect}
                onClick={onView}
              />
            )}
          />
        )}
      </div>
    </>
  );
}