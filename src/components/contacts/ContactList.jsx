import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import ContactCard from './ContactCard';
import StatsBar from '../layout/StatsBar';

const ALL_STATUSES = ['New Lead','Contacted','Offer Made','Offer Rejected/NFS','UC','Closed','Dead/Pass'];

export default function ContactList({ onView }) {
  const { contacts, currentClientId, deleteContact, showToast } = useApp();
  const [search, setSearch]           = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState(new Set(ALL_STATUSES));
  const [selectedCounties, setSelectedCounties] = useState(new Set());
  const [selected, setSelected]       = useState(new Set());
  const [statusOpen, setStatusOpen]   = useState(false);
  const [countyOpen, setCountyOpen]   = useState(false);

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
      <StatsBar filtered={filtered} />
      <div className="controls">
        <div className="search-row">
          <div className="search-wrapper">
            <span className="search-icon">⌕</span>
            <input
              className="search"
              type="text"
              placeholder="Search by name, phone, address, or tax map ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button className="search-clear" onClick={() => setSearch('')}>×</button>}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              id="statusFilterBtn"
              onClick={() => setStatusOpen(o => !o)}
              style={{ minWidth: '140px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}
            >
              <span>
                {selectedStatuses.size === ALL_STATUSES.length ? 'All Statuses' :
                  selectedStatuses.size === 0 ? 'No Status' : `${selectedStatuses.size} selected`}
              </span>
              <span>▾</span>
            </button>
            {statusOpen && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: '200px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', zIndex: 500, padding: '0.5rem', maxHeight: '260px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                <div style={{ display: 'flex', gap: '0.5rem', padding: '0.25rem 0.5rem', marginBottom: '0.25rem' }}>
                  <button className="btn-small" onClick={() => setSelectedStatuses(new Set(ALL_STATUSES))}>All</button>
                  <button className="btn-small" onClick={() => setSelectedStatuses(new Set())}>None</button>
                </div>
                {ALL_STATUSES.map(s => (
                  <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input type="checkbox" checked={selectedStatuses.has(s)} onChange={() => toggleStatus(s)} />
                    {s}
                  </label>
                ))}
              </div>
            )}
          </div>
          {counties.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setCountyOpen(o => !o)}
                style={{ minWidth: '140px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}
              >
                <span>{selectedCounties.size === 0 ? 'All Counties' : `${selectedCounties.size} counties`}</span>
                <span>▾</span>
              </button>
              {countyOpen && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: '200px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '6px', zIndex: 500, padding: '0.5rem', maxHeight: '260px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', padding: '0.25rem 0.5rem', marginBottom: '0.25rem' }}>
                    <button className="btn-small" onClick={() => setSelectedCounties(new Set())}>All</button>
                    <button className="btn-small" onClick={() => setSelectedCounties(new Set(counties))}>Filter</button>
                  </div>
                  {counties.map(c => (
                    <label key={c} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                      <input type="checkbox" checked={selectedCounties.has(c)} onChange={() => toggleCounty(c)} />
                      {c}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {selected.size > 0 && (
          <div className="bulk-actions">
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>{selected.size} selected</span>
            <button className="btn-small btn-danger" onClick={deleteSelected}>Delete Selected</button>
            <button className="btn-small" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      <div className="contact-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <p>{contacts.length === 0 ? 'Add your first contact or import a CSV' : 'No contacts match your filters'}</p>
          </div>
        ) : (
          <>
            <div className="select-all-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
                Select all {filtered.length}
              </label>
            </div>
            {filtered.map(c => (
              <ContactCard
                key={c.id}
                contact={c}
                selected={selected.has(c.id)}
                onSelect={toggleSelect}
                onClick={onView}
              />
            ))}
          </>
        )}
      </div>
    </>
  );
}