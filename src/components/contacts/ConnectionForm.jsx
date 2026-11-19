import { useState, useEffect, useRef } from 'react';
import { User, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { searchByKind, displayName } from '../../lib/links';
import { connectPeople, updatePeopleConnection, setFamiliarity, HOW_PICKS, LEVELS } from '../../lib/waysIn';
import { classifyError } from '../../lib/errors';

// Add a connection by hand, or edit one (PLAN.md, "Add connection"). The fallback for
// links no note will ever mention; notes become the main input in step 4.
//
// Add:  who, how they know each other, "not sure yet", and optionally how well *you*
//       know that person (a connection only makes this contact warmer if someone on the
//       team knows the other end).
// Edit: only how, who referred whom and "not sure" — the database allows nothing else.
export default function ConnectionForm({ contact, connection = null, excludeIds = [], onDone, onCancel }) {
  const { currentClientId, showToast } = useApp();
  const editing = !!connection;
  const thisName = displayName(contact);

  const [other, setOther] = useState(editing ? { id: connection.contactId, name: connection.name } : null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState('');
  const [description, setDescription] = useState(connection?.description || '');
  const [referredBy, setReferredBy] = useState(connection?.referredBy ?? null);
  const [unsure, setUnsure] = useState(!!connection?.unsure);
  const [myLevel, setMyLevel] = useState(null);
  const [saving, setSaving] = useState(false);
  const searchSeq = useRef(0);

  // Search as you type; the sequence drops a slow response for an earlier keystroke.
  useEffect(() => {
    if (editing) return undefined;
    const seq = ++searchSeq.current;
    if (query.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      searchByKind(currentClientId, 'person', query)
        .then(rows => { if (seq === searchSeq.current) { setResults(rows); setSearched(query); } })
        .catch(e => console.error('person search failed:', e));
    }, 200);
    return () => clearTimeout(t);
  }, [query, currentClientId, editing]);

  const skip = new Set([contact.id, ...excludeIds]);
  const choices = results.filter(r => !skip.has(r.id));
  const isReferral = /\brefer/i.test(description) || referredBy != null;

  function pick(text) {
    setDescription(text);
    if (!/\brefer/i.test(text)) setReferredBy(null);
  }

  async function save(e) {
    e.preventDefault();
    if (!other || saving) return;
    setSaving(true);
    const fields = { description, referredBy: isReferral ? referredBy : null, unsure };
    try {
      if (editing) {
        await updatePeopleConnection(connection.id, fields);
      } else {
        await connectPeople({ contactId: contact.id, otherId: other.id, ...fields });
      }
    } catch (err) {
      setSaving(false);
      showToast(err.message || classifyError(err), 'error');
      return;
    }
    if (!editing && myLevel) {
      try {
        await setFamiliarity(other.id, myLevel);
      } catch (err) {
        showToast(`Connected, but how well you know ${other.name} wasn't saved — set it on their page.`, 'warning');
      }
    }
    setSaving(false);
    onDone();
  }

  return (
    <form className="ways-form" onSubmit={save}>
      {/* Who */}
      {other ? (
        <div className="ways-form-who">
          <User size={14} className="conn-icon" />
          <span className="ways-form-name">{other.name}</span>
          {!editing && (
            <button type="button" className="note-delete-btn" title="Choose someone else"
              onClick={() => { setOther(null); setQuery(''); }}><X size={12} /></button>
          )}
        </div>
      ) : (
        <div>
          <input className="inline-input" value={query} data-autofocus autoFocus
            onChange={e => setQuery(e.target.value)} placeholder="Who do they know? Type a name" />
          {query.trim().length >= 2 && (
            <div className="conn-results">
              {choices.map(r => (
                <button key={r.id} type="button" className="conn-result" onClick={() => setOther(r)}>
                  <User size={12} /> {r.name}
                </button>
              ))}
              {searched === query && choices.length === 0 && (
                <div className="conn-empty">No one by that name. Add them with “Add Contact” first.</div>
              )}
            </div>
          )}
        </div>
      )}

      {other && (
        <>
          {/* How */}
          <div className="ways-form-label">How do they know each other?</div>
          <div className="ways-chips">
            {HOW_PICKS.map(p => (
              <button key={p} type="button" className={`ways-chip${description === p ? ' active' : ''}`} onClick={() => pick(p)}>{p}</button>
            ))}
          </div>
          <input className="inline-input" value={description} maxLength={500}
            onChange={e => setDescription(e.target.value)} placeholder="Or in your own words (optional)" />

          {isReferral && (
            <div className="ways-chips" role="radiogroup" aria-label="Who referred whom?">
              <button type="button" role="radio" aria-checked={referredBy === other.id}
                className={`ways-chip${referredBy === other.id ? ' active' : ''}`}
                onClick={() => setReferredBy(other.id)}>{other.name} referred {thisName}</button>
              <button type="button" role="radio" aria-checked={referredBy === contact.id}
                className={`ways-chip${referredBy === contact.id ? ' active' : ''}`}
                onClick={() => setReferredBy(contact.id)}>{thisName} referred {other.name}</button>
            </div>
          )}

          <label className="ways-check">
            <input type="checkbox" checked={unsure} onChange={e => setUnsure(e.target.checked)} />
            I think so, but I’m not sure yet
          </label>

          {!editing && (
            <>
              <div className="ways-form-label">How well do you know {other.name}? <span className="ways-optional">optional</span></div>
              <div className="ways-chips">
                {LEVELS.filter(l => l.value).map(l => (
                  <button key={l.value} type="button" title={l.hint}
                    className={`ways-chip${myLevel === l.value ? ' active' : ''}`}
                    onClick={() => setMyLevel(v => v === l.value ? null : l.value)}>{l.label}</button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div className="ways-form-actions">
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={!other || saving}>
          {saving ? 'Saving…' : editing ? 'Save' : 'Add connection'}
        </button>
      </div>
    </form>
  );
}
