import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { StickyNote, Trash2, Pencil } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../shared/ConfirmDialog';
import { fetchNotes, addNote, updateNote, deleteNote, fetchAuthorNames } from '../../lib/notes';
import { classifyError } from '../../lib/errors';
import { fetchFinderIndex, invalidateFinderIndex } from '../../lib/finderIndex';
import { findInNote, segmentNote, splitName } from '../../lib/noteFinder';
import { runFinder } from '../../lib/noteActions';
import MentionTextarea from './MentionTextarea';
import FinderStrip from './FinderStrip';

// Notes are rows in contact_notes, not a field on the contact: each one is written,
// edited and deleted on its own, so two people noting the same contact can't overwrite
// each other. This tab owns loading them; the contact only carries the rolled-up
// noteCount / lastNoteAt, which the parent is told about through onNotesChanged.
//
//   onNotesChanged({ count, lastNoteAt, added })
//     added: true when a note was just logged — a note is a call, so the parent schedules
//     the next follow-up off it. Deleting or editing is not a call.
//
//   related: [{ id, name }] — other contacts whose notes belong on this timeline (a
//   company's people). Their notes are shown tagged with the name and are read-only
//   here in one respect: a new note always goes on `contact` itself.
//
//   cfg + onLinksChanged — when cfg.connections is on, the note finder runs: names in a
//   note become links, "@" picks a contact while typing, and after a save the names it
//   recognises are connected (lib/noteActions.js) and reported in a "Taraform found"
//   strip under the note. onLinksChanged tells the page to reload what those touched.
export default function NotesTab({ contact, onNotesChanged, quickNotes = [], related = [], cfg = null, onLinksChanged }) {
  const { user, currentClientId, showToast, loadFullContact, setCurrentContact, saveContact } = useApp();
  const finderOn = !!cfg?.connections;
  const [finder, setFinder] = useState(null);   // { index, ignored } once loaded
  const [found, setFound] = useState({});       // note id -> strip items
  const picked = useRef(new Map());             // @-mention choices for the note being written
  const navigate = useNavigate();
  const [notes, setNotes] = useState([]);
  const [authors, setAuthors] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // { id, text }
  const [confirmDelete, ConfirmUI] = useConfirm();
  // Guards against a slow load for contact A landing after the overlay moved to contact B.
  const contactIdRef = useRef(contact.id);
  contactIdRef.current = contact.id;

  // Reload when the set of related contacts changes, not on every new array identity.
  const relatedKey = related.map(r => r.id).join(',');
  const relatedNames = new Map(related.map(r => [r.id, r.name]));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setNotes([]);
    setEditing(null);
    fetchNotes([contact.id, ...related.map(r => r.id)])
      .then(rows => { if (!cancelled) setNotes(rows); })
      .catch(e => { if (!cancelled) setLoadError(classifyError(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contact.id, relatedKey]); // eslint-disable-line

  // The finder's name index. A failure only means names aren't recognised. Read fresh
  // each time a contact opens and before each note is checked, so someone added a minute
  // ago through Add Contact (or by a teammate) is recognised; between those it's cached.
  function reloadFinder({ fresh = false } = {}) {
    if (!finderOn) return;
    if (fresh) invalidateFinderIndex(currentClientId);
    fetchFinderIndex(currentClientId).then(setFinder).catch(e => console.error('name index failed:', e));
  }
  useEffect(() => { reloadFinder({ fresh: true }); }, [currentClientId, finderOn, contact.id]); // eslint-disable-line

  async function find(note) {
    if (!finderOn) return;
    try {
      invalidateFinderIndex(currentClientId);
      const items = await runFinder({ clientId: currentClientId, contact, note, picked: picked.current });
      reloadFinder();
      if (contactIdRef.current !== contact.id) return;
      if (items.length) setFound(prev => ({ ...prev, [note.id]: items }));
      if (items.some(i => i.state === 'linked')) onLinksChanged?.();
    } catch (e) {
      showToast('Note saved, but linking the names in it failed — ' + classifyError(e), 'error');
    }
  }

  // A contact made from a note or an @-mention: the same shape and default status as Add
  // Contact, through saveContact so it lands in the list too.
  async function createContact({ kind, name }) {
    const now = new Date().toISOString();
    const names = kind === 'company' ? { firstName: name.trim(), lastName: '' } : splitName(name);
    const saved = await saveContact({
      kind, ...names, phones: [], email: '', county: '', ownerAddress: '', propertyAddresses: [], taxMapIds: [],
      status: cfg?.statuses?.[0]?.value || '', notes: '', customFields: {}, createdAt: now, updatedAt: now,
    });
    invalidateFinderIndex(currentClientId);
    reloadFinder();
    return { id: saved.id, name: `${saved.firstName} ${saved.lastName}`.trim() };
  }

  async function mentionCreate(name) {
    try {
      const made = await createContact({ kind: 'person', name });
      showToast(`Added ${made.name}`);
      return made;
    } catch (e) {
      showToast('Contact not added — ' + classifyError(e), 'error');
      return null;
    }
  }

  // Recognised names in each note, for rendering them as links.
  const spansById = useMemo(() => {
    const m = new Map();
    if (!finder) return m;
    for (const n of notes) m.set(n.id, findInNote(n.body, finder.index, { selfId: n.contactId }).spans);
    return m;
  }, [notes, finder]);

  // Names are cosmetic: a failure leaves notes readable with no author shown.
  useEffect(() => {
    let cancelled = false;
    fetchAuthorNames(currentClientId)
      .then(names => { if (!cancelled) setAuthors(names); })
      .catch(e => console.error('author names failed:', e));
    return () => { cancelled = true; };
  }, [currentClientId]);

  // The parent mirrors note_count / last_note_at for THIS contact, so notes pulled in from
  // related contacts are left out of what it hears.
  function report(next, added) {
    const own = next.filter(n => n.contactId === contact.id);
    onNotesChanged?.({ count: own.length, lastNoteAt: own[0]?.createdAt || null, added });
  }

  async function submit(text) {
    const body = text.trim();
    if (!body || saving) return false;
    const forContact = contact.id;
    setSaving(true);
    try {
      const note = await addNote(forContact, body);
      if (contactIdRef.current !== forContact) return true;
      const next = [note, ...notes];
      setNotes(next);
      report(next, true);
      find(note).finally(() => { picked.current = new Map(); });
      return true;
    } catch (e) {
      showToast('Note not saved — ' + classifyError(e), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveNewNote() {
    if (await submit(newNote)) setNewNote('');
  }

  async function saveEdit() {
    const body = editing.text.trim();
    if (!body) return;
    try {
      const updated = await updateNote(editing.id, body);
      setNotes(prev => prev.map(n => (n.id === updated.id ? updated : n)));
      setEditing(null);
      if (updated.contactId === contact.id) find(updated);
    } catch (e) {
      showToast(e.message || 'Edit failed', 'error');
    }
  }

  async function remove(note) {
    if (!await confirmDelete('Delete this note?')) return;
    try {
      await deleteNote(note.id);
      const next = notes.filter(n => n.id !== note.id);
      setNotes(next);
      report(next, false);
    } catch (e) {
      showToast(e.message || 'Delete failed', 'error');
    }
  }

  // Same route ConnectionsPanel uses to jump to a linked contact.
  async function openRelated(id) {
    navigate('/contact/' + id);
    const full = await loadFullContact(id);
    if (full) setCurrentContact(full);
  }

  const authorOf = note => (note.authorId === user?.id ? 'You' : authors.get(note.authorId) || '');

  return (
    <div id="detailTabNotes">
      <div className="note-add-form">
        {quickNotes.length > 0 && (
          <div className="quick-notes">
            {quickNotes.map(q => (
              <button key={q} type="button" className="quick-note-chip" disabled={saving} onClick={() => submit(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <MentionTextarea
          id="newNoteText"
          value={newNote}
          onChange={setNewNote}
          index={finder?.index || null}
          selfId={contact.id}
          onPicked={(key, id) => picked.current.set(key, id)}
          onCreate={finderOn ? mentionCreate : undefined}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              saveNewNote();
            }
          }}
          placeholder={finderOn ? 'Add a note... (@ to mention someone, Ctrl+Enter to save)' : 'Add a note... (Ctrl+Enter to save)'}
        />
        <div className="note-add-actions">
          <button className="btn-small" onClick={() => setNewNote('')}>Clear</button>
          <button className="btn-small btn-primary" disabled={saving} onClick={saveNewNote}>Save Note</button>
        </div>
      </div>
      <div id="pageNotesList">
        {loading ? (
          <div className="note-empty">Loading notes…</div>
        ) : loadError ? (
          <div className="note-empty">Couldn’t load notes — {loadError}</div>
        ) : notes.length === 0 ? (
          <div className="note-empty">No notes yet.</div>
        ) : notes.map(note => {
          const mine = note.authorId === user?.id;
          const isEditing = editing?.id === note.id;
          return (
            <div key={note.id} className="note-item">
              <div className="note-header">
                <span className="note-type-badge badge-note">
                  <StickyNote size={10} /> {authorOf(note) || 'Note'}
                </span>
                {note.contactId !== contact.id && relatedNames.has(note.contactId) && (
                  <span className="note-about">
                    with{' '}
                    <button type="button" className="note-about-name" onClick={() => openRelated(note.contactId)}>
                      {relatedNames.get(note.contactId)}
                    </button>
                  </span>
                )}
                <div className="note-header-right">
                  <span className="note-timestamp">
                    {new Date(note.createdAt).toLocaleString()}{note.editedAt ? ' · edited' : ''}
                  </span>
                  {/* Only the author's own notes get controls. RLS enforces it; hiding the
                      buttons just avoids offering something that would be refused. */}
                  {mine && !isEditing && (
                    <>
                      <button className="note-delete-btn" title="Edit note" onClick={() => setEditing({ id: note.id, text: note.body })}>
                        <Pencil size={12} />
                      </button>
                      <button className="note-delete-btn" title="Delete note" onClick={() => remove(note)}>
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {isEditing ? (
                <div className="note-add-form note-edit-form">
                  <textarea
                    autoFocus
                    value={editing.text}
                    onChange={e => setEditing({ id: note.id, text: e.target.value })}
                    onKeyDown={e => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <div className="note-add-actions">
                    <button className="btn-small" onClick={() => setEditing(null)}>Cancel</button>
                    <button className="btn-small btn-primary" onClick={saveEdit}>Save</button>
                  </div>
                </div>
              ) : (
                <div className="note-text">
                  {spansById.get(note.id)?.length
                    ? segmentNote(note.body, spansById.get(note.id)).map((seg, i) =>
                        !seg.kind ? <span key={i}>{seg.text}</span>
                        : seg.kind === 'group' ? <span key={i} className="note-mention group" title="Group">{seg.text}</span>
                        : <button key={i} type="button" className="note-mention" onClick={() => openRelated(seg.id)}>{seg.text}</button>)
                    : note.body}
                </div>
              )}
              {found[note.id] && (
                <FinderStrip items={found[note.id]} contact={contact} noteId={note.id} clientId={currentClientId}
                  cfg={cfg} createContact={createContact} showToast={showToast}
                  onChanged={() => { onLinksChanged?.(); reloadFinder(); }}
                  onDismiss={() => setFound(({ [note.id]: _, ...rest }) => rest)} />
              )}
            </div>
          );
        })}
      </div>
      {ConfirmUI}
    </div>
  );
}
