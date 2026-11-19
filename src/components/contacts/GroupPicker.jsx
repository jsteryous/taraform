import { useState, useEffect } from 'react';
import { Users, Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fetchGroups, createGroup, addContactToGroup, findGroupByName, guessKind, kindOptions, kindLabel } from '../../lib/groups';
import { resolveConfig } from '../../lib/clientConfig';
import { classifyError } from '../../lib/errors';
import Select from '../shared/Select';

// Put this contact in a group: pick one the workspace already has (by name or any other
// name it goes by), or create it. Creating is a deliberate step with its own button, as
// with companies: a typo here would become a second group everyone shares.
export default function GroupPicker({ contact, inGroupIds = [], onDone, onCancel }) {
  const { user, currentClientId, currentClient, showToast } = useApp();
  const cfg = resolveConfig(currentClient);
  const [groups, setGroups] = useState(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('other');
  const [kindTouched, setKindTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchGroups(currentClientId, user?.id)
      .then(setGroups)
      .catch(e => { console.error('groups failed:', e); setGroups([]); });
  }, [currentClientId, user?.id]);

  // Follow the name with a guessed kind until the person chooses one themselves.
  useEffect(() => {
    if (!kindTouched) setKind(guessKind(query, cfg));
  }, [query]); // eslint-disable-line

  const typed = query.trim().replace(/\s+/g, ' ');
  const t = typed.toLowerCase();
  const already = new Set(inGroupIds);
  const list = (groups || []).filter(g => !already.has(g.id) &&
    (!t || g.name.toLowerCase().includes(t) || g.aliases.some(a => a.toLowerCase().includes(t))));
  const exact = groups ? findGroupByName(groups, typed) : null;
  const canCreate = typed.length >= 2 && groups && !exact;

  async function add(group) {
    if (saving) return;
    setSaving(true);
    try {
      await addContactToGroup(group.id, contact.id);
      onDone();
    } catch (e) {
      showToast(classifyError(e), 'error');
      setSaving(false);
    }
  }

  async function createAndAdd() {
    if (saving || !canCreate) return;
    setSaving(true);
    let group;
    try {
      group = await createGroup(currentClientId, { name: typed, kind, aliases: [] });
    } catch (e) {
      showToast(e.message || classifyError(e), 'error');
      setSaving(false);
      return;
    }
    try {
      await addContactToGroup(group.id, contact.id);
    } catch (e) {
      showToast(`“${typed}” was created, but they weren't added to it — try again.`, 'warning');
    }
    onDone();
  }

  return (
    <div className="ways-form">
      <input className="inline-input" value={query} autoFocus
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
        placeholder="Club, school, board… type a name" />
      <div className="conn-results">
        {groups === null ? (
          <div className="conn-empty">Loading…</div>
        ) : (
          <>
            {list.slice(0, 8).map(g => (
              <button key={g.id} type="button" className="conn-result" disabled={saving} onClick={() => add(g)}>
                <Users size={12} /> {g.name}
                {g.aliases.length > 0 && <span className="ways-optional"> · {g.aliases.join(', ')}</span>}
                {g.kind !== 'other' && <span className="ways-optional"> · {kindLabel(g.kind)}</span>}
              </button>
            ))}
            {exact && already.has(exact.id) && <div className="conn-empty">Already in {exact.name}.</div>}
            {!typed && list.length === 0 && <div className="conn-empty">No groups yet. Type a name to create one.</div>}
          </>
        )}
      </div>
      {canCreate && (
        <div className="ways-create">
          <Select value={kind} onChange={v => { setKind(v); setKindTouched(true); }} options={kindOptions(cfg)} emptyLabel={null} />
          <button type="button" className="conn-result conn-create" disabled={saving} onClick={createAndAdd}>
            <Plus size={12} /> {saving ? 'Creating…' : `Create “${typed}” and add them`}
          </button>
        </div>
      )}
      <div className="ways-form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}
