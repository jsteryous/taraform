import { useState } from 'react';

export default function NotesTab({ contact, onChange }) {
  const [newNote, setNewNote] = useState('');

  function saveNote() {
    if (!newNote.trim()) return;
    const entry = {
      id: crypto.randomUUID(),
      text: newNote.trim(),
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      type: 'note',
    };
    const log = [entry, ...(contact.activityLog || [])];
    onChange('activityLog', log);
    setNewNote('');
  }

  const log = contact.activityLog || [];

  return (
    <div id="detailTabNotes">
      <div className="note-add-form">
        <textarea
          id="newNoteText"
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="Add a note... (e.g., 'Called - no answer' or 'Wants $200K')"
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
                {entry.type === 'status_change' ? '⟳ Status' : entry.type === 'offer' ? '$ Offer' : '📝 Note'}
              </span>
              <span className="note-timestamp">{new Date(entry.timestamp).toLocaleString()}</span>
            </div>
            <div className="note-text">{entry.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}