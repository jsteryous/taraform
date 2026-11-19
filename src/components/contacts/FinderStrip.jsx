import { useState } from 'react';
import { Sparkles, X, Link2, Users, Building2, UserPlus, Undo2 } from 'lucide-react';
import { connectPeople, disconnectPeople } from '../../lib/waysIn';
import { createGroup, addContactToGroup, removeContactFromGroup, guessKind, isFaithName } from '../../lib/groups';
import { addConnection, removeConnection } from '../../lib/links';
import { ignoreTerm, invalidateFinderIndex } from '../../lib/finderIndex';
import { classifyError } from '../../lib/errors';

// "Taraform found", under a note that was just saved (PLAN.md, the note finder).
// Things it was sure of are already done and say so, with Undo; everything else is one
// tap. `items` comes from runFinder (lib/noteActions.js).
//
//   onChanged()            something was linked or unlinked: reload the column
//   createContact(fields)  makes a contact the same way Add Contact does; returns it
export default function FinderStrip({ items: initial, contact, noteId, clientId, cfg, createContact, onChanged, onDismiss, showToast }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(null);

  const set = (i, patch) => setItems(prev => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function run(i, fn) {
    if (busy != null) return;
    setBusy(i);
    try {
      await fn();
      onChanged?.();
    } catch (e) {
      showToast?.(classifyError(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  const connect = (otherId) => connectPeople({ contactId: contact.id, otherId, sourceNoteId: noteId });

  const actions = {
    undo: (i, it) => run(i, async () => {
      if (it.connectionId) await disconnectPeople(it.connectionId);
      if (it.groupId) await removeContactFromGroup(it.groupId, contact.id);
      if (it.linkId) await removeConnection(it.linkId);
      set(i, { state: 'undone' });
    }),
    pick: (i, it, person) => run(i, async () => {
      const connectionId = await connect(person.id);
      set(i, { type: 'person', name: person.name, state: 'linked', connectionId });
    }),
    worksThere: (i, it) => run(i, async () => {
      const linkId = await addConnection({ companyId: it.id, personId: contact.id });
      set(i, { state: 'linked', linkId });
    }),
    addPerson: (i, it) => run(i, async () => {
      const made = await createContact({ kind: 'person', name: it.phrase });
      invalidateFinderIndex(clientId);
      const connectionId = await connect(made.id);
      set(i, { type: 'person', name: it.phrase, state: 'linked', connectionId, created: true });
    }),
    addCompany: (i, it) => run(i, async () => {
      const made = await createContact({ kind: 'company', name: it.phrase });
      invalidateFinderIndex(clientId);
      const linkId = await addConnection({ companyId: made.id, personId: contact.id });
      set(i, { type: 'company', name: it.phrase, state: 'linked', linkId, created: true });
    }),
    makeGroup: (i, it) => run(i, async () => {
      const g = await createGroup(clientId, { name: it.phrase, kind: guessKind(it.phrase, cfg) });
      invalidateFinderIndex(clientId);
      await addContactToGroup(g.id, contact.id, noteId);
      set(i, { type: 'group', name: g.name, state: 'linked', groupId: g.id, created: true });
    }),
    ignore: (i, it) => run(i, async () => {
      await ignoreTerm(clientId, it.phrase);
      set(i, { state: 'ignored' });
    }),
  };

  // Faith groups stay off in Bank until compliance answers (PLAN.md), under any kind.
  const noGroup = (it) => cfg?.type === 'banking' && isFaithName(it.phrase);

  const shown = items.map((it, i) => [it, i]).filter(([it]) => it.state !== 'ignored');
  if (!shown.length) return null;

  return (
    <div className="finder-strip" aria-label="Taraform found">
      <div className="finder-head">
        <Sparkles size={12} /> Taraform found
        <button type="button" className="note-delete-btn finder-close" title="Hide" onClick={onDismiss}><X size={12} /></button>
      </div>
      {shown.map(([it, i]) => (
        <div key={i} className={`finder-item${busy === i ? ' busy' : ''}`}>
          {it.state === 'linked' && (
            <>
              {it.type === 'group' ? <Users size={13} /> : it.type === 'company' ? <Building2 size={13} /> : <Link2 size={13} />}
              <span className="finder-text">
                {it.type === 'group' ? <>Added to <b>{it.name}</b></>
                  : it.type === 'company' ? <>Works at <b>{it.name}</b></>
                  : <>Connected to <b>{it.name}</b></>}
                {it.created && <span className="finder-meta"> · new</span>}
              </span>
              <button type="button" className="finder-btn" onClick={() => actions.undo(i, it)}><Undo2 size={11} /> Undo</button>
            </>
          )}
          {it.state === 'undone' && <span className="finder-text finder-muted">Undone: {it.name}</span>}

          {it.state === 'offer' && it.type === 'company' && (
            <>
              <Building2 size={13} />
              <span className="finder-text"><b>{it.name}</b></span>
              <button type="button" className="finder-btn primary" onClick={() => actions.worksThere(i, it)}>Works there</button>
              <button type="button" className="finder-btn" onClick={() => set(i, { state: 'ignored' })}>No</button>
            </>
          )}

          {it.state === 'offer' && it.type === 'ambiguous' && (
            <>
              <Link2 size={13} />
              <span className="finder-text">Which <b>{it.name}</b>?</span>
              {it.candidates.map(c => (
                <button key={c.id} type="button" className="finder-btn" onClick={() => actions.pick(i, it, c)}>
                  {c.name}{c.status ? ` · ${c.status}` : ''}
                </button>
              ))}
            </>
          )}

          {it.state === 'offer' && it.type === 'unknown' && (
            <>
              <UserPlus size={13} />
              <span className="finder-text"><b>{it.phrase}</b></span>
              {orderFor(it.guess, noGroup(it)).map((kind, k) => (
                <button key={kind} type="button" className={`finder-btn${k === 0 ? ' primary' : ''}`}
                  onClick={() => (kind === 'person' ? actions.addPerson : kind === 'company' ? actions.addCompany : actions.makeGroup)(i, it)}>
                  {kind === 'person' ? 'Add person & connect' : kind === 'company' ? 'Add company' : 'Make group'}
                </button>
              ))}
              <button type="button" className="finder-btn" title="Stop offering this for the whole workspace" onClick={() => actions.ignore(i, it)}>Ignore</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function orderFor(guess, withoutGroup) {
  const all = ['person', 'company', 'group'].filter(k => !(withoutGroup && k === 'group'));
  return all.includes(guess) ? [guess, ...all.filter(k => k !== guess)] : all;
}
