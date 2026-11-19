import { useState, useEffect } from 'react';
import { Pencil, Trash2, Users } from 'lucide-react';
import Modal from '../shared/Modal';
import Select from '../shared/Select';
import { useConfirm } from '../shared/ConfirmDialog';
import { useApp } from '../../context/AppContext';
import { resolveConfig } from '../../lib/clientConfig';
import {
  fetchGroups, createGroup, updateGroup, deleteGroup, joinGroup, leaveGroup,
  kindOptions, kindLabel, parseAliases, guessKind, findGroupByName,
} from '../../lib/groups';
import { fetchAuthorNames } from '../../lib/notes';
import { whoLabel } from '../../lib/waysIn';
import { classifyError } from '../../lib/errors';

// "Your groups" (PLAN.md): the clubs, schools, teams and boards you belong to. Ticking
// one is what turns "they're in Riverside Rotary" into "you're both in Riverside Rotary".
// Every group in the workspace is listed, because any member may tick, create, rename or
// delete one; the tick itself is yours alone (the database refuses anyone else's).
export default function YourGroupsModal({ open, onClose }) {
  const { user, currentClientId, currentClient, showToast } = useApp();
  const cfg = resolveConfig(currentClient);
  const me = user?.id;
  const [confirm, ConfirmUI] = useConfirm();
  const [groups, setGroups] = useState(null);
  const [names, setNames] = useState(new Map());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // group id, or 'new'
  const [draft, setDraft] = useState({ name: '', kind: 'other', aliases: '' });
  const [kindTouched, setKindTouched] = useState(false);

  async function load() {
    try {
      setGroups(await fetchGroups(currentClientId, me));
    } catch (e) {
      console.error('groups failed:', e);
      setGroups([]);
      showToast(classifyError(e), 'error');
    }
  }

  // Keyed on what decides the list, not on `load`: a callback's identity changing (a
  // context function re-created on render) must not reload, or it loops.
  useEffect(() => {
    if (!open) return;
    setGroups(null); setEditing(null);
    load();
    fetchAuthorNames(currentClientId).then(setNames).catch(() => {});
  }, [open, currentClientId, me]); // eslint-disable-line

  function startNew() {
    setDraft({ name: '', kind: 'other', aliases: '' });
    setKindTouched(false);
    setEditing('new');
  }

  function startEdit(g) {
    setDraft({ name: g.name, kind: g.kind, aliases: g.aliases.join(', ') });
    setKindTouched(true);
    setEditing(g.id);
  }

  function setName(name) {
    setDraft(d => ({ ...d, name, kind: kindTouched ? d.kind : guessKind(name, cfg) }));
  }

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      showToast(e.message || classifyError(e), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(e) {
    e.preventDefault();
    const name = draft.name.trim().replace(/\s+/g, ' ');
    if (!name) return;
    const fields = { name, kind: draft.kind, aliases: parseAliases(draft.aliases, name) };
    if (editing === 'new') {
      const clash = findGroupByName(groups || [], name);
      if (clash) { showToast(`“${clash.name}” already exists — tick it instead.`, 'warning'); return; }
      // A group you create here is one you're in; that's why you're adding it.
      const ok = await run(async () => {
        const g = await createGroup(currentClientId, fields);
        await joinGroup(g.id, me);
      });
      if (ok) setEditing(null);
    } else {
      const ok = await run(() => updateGroup(editing, fields));
      if (ok) setEditing(null);
    }
  }

  async function toggle(g) {
    await run(() => (g.mine ? leaveGroup(g.id, me) : joinGroup(g.id, me)));
  }

  async function remove(g) {
    const who = [
      g.contactCount ? `${g.contactCount} contact${g.contactCount === 1 ? '' : 's'}` : '',
      g.teammates.length ? `${g.teammates.length} teammate${g.teammates.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ');
    const msg = `Delete “${g.name}” for everyone in this workspace?${who ? ` It takes ${who} out of it.` : ''} Nobody is deleted.`;
    if (!await confirm(msg)) return;
    await run(() => deleteGroup(g.id));
  }

  const form = (
    <form className="ways-form" onSubmit={saveDraft}>
      <input className="inline-input" value={draft.name} autoFocus maxLength={120}
        onChange={e => setName(e.target.value)} placeholder="Name, e.g. Riverside Rotary" />
      <input className="inline-input" value={draft.aliases}
        onChange={e => setDraft(d => ({ ...d, aliases: e.target.value }))}
        placeholder="Other names it goes by, separated by commas (optional)" />
      <div className="ways-create">
        <Select value={draft.kind} onChange={v => { setDraft(d => ({ ...d, kind: v })); setKindTouched(true); }}
          options={kindOptions(cfg)} emptyLabel={null} />
      </div>
      <div className="ways-form-actions">
        <button type="button" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy || !draft.name.trim()}>
          {editing === 'new' ? 'Add group' : 'Save'}
        </button>
      </div>
    </form>
  );

  return (
    <Modal open={open} onClose={onClose} title="Your groups" width="560px">
      {ConfirmUI}
      <p className="groups-intro">
        Tick the clubs, schools, teams and boards you belong to. When a contact is in one too,
        their page says you have common ground. Teammates see which groups you’ve ticked.
      </p>

      {groups === null ? (
        <div className="conn-empty">Loading…</div>
      ) : (
        <>
          {groups.length === 0 && editing !== 'new' && <div className="conn-empty">No groups yet.</div>}
          <ul className="groups-list">
            {groups.map(g => (
              <li key={g.id} className="groups-row">
                {editing === g.id ? form : (
                  <>
                    <label className="ways-check groups-tick">
                      <input type="checkbox" checked={g.mine} disabled={busy} onChange={() => toggle(g)} />
                      <span className="ways-group-name">{g.name}</span>
                    </label>
                    {g.kind !== 'other' && <span className="ways-kind">{kindLabel(g.kind)}</span>}
                    <span className="ways-actions">
                      <button type="button" className="note-delete-btn" title="Edit" onClick={() => startEdit(g)}><Pencil size={12} /></button>
                      <button type="button" className="note-delete-btn" title="Delete group" onClick={() => remove(g)}><Trash2 size={12} /></button>
                    </span>
                    <div className="groups-meta">
                      {g.aliases.length > 0 && <>Also: {g.aliases.join(', ')} · </>}
                      <Users size={11} /> {g.contactCount} contact{g.contactCount === 1 ? '' : 's'}
                      {g.teammates.filter(id => id !== me).length > 0 &&
                        <> · {g.teammates.filter(id => id !== me).map(id => whoLabel(id, { me, names })).join(', ')}</>}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          {editing === 'new' ? form : (
            <button type="button" className="add-field-btn" onClick={startNew} disabled={busy}>+ Add a group you’re in</button>
          )}
        </>
      )}
    </Modal>
  );
}
