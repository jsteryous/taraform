import { useState } from 'react';
import { RefreshCw, CircleDollarSign, StickyNote, Trash2 } from 'lucide-react';
import { useConfirm } from '../shared/ConfirmDialog';

export default function NotesTab({ contact, onChange, quickNotes = [] }) {
  const [newNote, setNewNote] = useState('');
  const [confirmDelete, ConfirmUI] = useConfirm();

  // Append a note entry to the activity log (shared by the textarea + quick-note chips).
  function addNote(text) {
    const now = new Date().toISOString();
    const entry = { id: crypto.randomUUID(), text, timestamp: now, createdAt: now, type: 'note' };
    onChange('activityLog', [entry, ...(contact.activityLog || [])]);
  }

  function saveNote() {
    if (!newNote.trim()) return;
    addNote(newNote.trim());
    setNewNote('');
  }

  async function deleteNote(entry) {
    if (!await confirmDelete('Delete this note?')) return;
    onChange('activityLog', (contact.activityLog || []).filter(e => e.id !== entry.id));
  }

  const log = contact.activityLog || [];
  // Only user-written notes are deletable; Status/Offer entries are an audit trail.
  const isDeletable = entry => !entry.type || entry.type === 'note';

  return (
    <div id="detailTabNotes">
      <div className="note-add-form">
        {quickNotes.length > 0 && (
          <div className="quick-notes">
            {quickNotes.map(q => (
              <button key={q} type="button" className="quick-note-chip" onClick={() => addNote(q)}>
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
              saveNote();
            }
          }}
          placeholder="Add a note... (Ctrl+Enter to save)"
        />
        <div className="note-add-actions">
          <button className="btn-small" onClick={() => setNewNote('')}>Clear</button>
          <button className="btn-small btn-primary" onClick={saveNote}>Save Note</button>
        </div>
      </div>
      <div id="pageNotesList">
        {log.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', padding: '1rem 0' }}>No notes yet.</div>
        ) : log.map(entry => (
          <div key={entry.id} className="note-item">
            <div className="note-header">
              <span className={`note-type-badge ${entry.type === 'status_change' ? 'badge-status' : entry.type === 'offer' ? 'badge-offer' : 'badge-note'}`}>
                {entry.type === 'status_change' ? <><RefreshCw size={10} /> Status</>
                  : entry.type === 'offer' ? <><CircleDollarSign size={10} /> Offer</>
                  : <><StickyNote size={10} /> Note</>}
              </span>
              <div className="note-header-right">
                <span className="note-timestamp">{new Date(entry.timestamp).toLocaleString()}</span>
                {isDeletable(entry) && (
                  <button className="note-delete-btn" title="Delete note" onClick={() => deleteNote(entry)}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
            <div className="note-text">{entry.text}</div>
          </div>
        ))}
      </div>
      {ConfirmUI}
    </div>
  );
}