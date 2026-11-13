import { useState, useEffect, useRef } from 'react';
import { StickyNote, Trash2, Pencil } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../shared/ConfirmDialog';
import { fetchNotes, addNote, updateNote, deleteNote, fetchAuthorNames } from '../../lib/notes';
import { classifyError } from '../../lib/errors';

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
export default function NotesTab({ contact, onNotesChanged, quickNotes = [], related = [] }) {
  const { user, currentClientId, showToast } = useApp();
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
        <textarea
          id="newNoteText"
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              saveNewNote();
            }
          }}
          placeholder="Add a note... (Ctrl+Enter to save)"
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
                  <span className="note-about">with {relatedNames.get(note.contactId)}</span>
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
                <div className="note-text">{note.body}</div>
              )}
            </div>
          );
        })}
      </div>
      {ConfirmUI}
    </div>
  );
}
