import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, User, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../shared/ConfirmDialog';
import { fetchConnections, addConnection, removeConnection, searchByKind } from '../../lib/links';
import { classifyError } from '../../lib/errors';

// Who this contact is connected to: a company's people, or a person's companies.
// Loads and edits the links itself; `onLoaded` tells the parent who is connected so a
// company's Notes tab can pull in the notes written on its people.
export default function ConnectionsPanel({ contact, onLoaded }) {
  const { currentClientId, loadFullContact, setCurrentContact, showToast } = useApp();
  const navigate = useNavigate();
  const [confirmRemove, ConfirmUI] = useConfirm();
  const isCompany = contact.kind === 'company';
  const otherKind = isCompany ? 'person' : 'company';
  const OtherIcon = isCompany ? User : Building2;

  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [results, setResults] = useState([]);
  const searchSeq = useRef(0);

  function apply(next) {
    setLinks(next);
    onLoaded?.(next);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setQuery(''); setTitle(''); setResults([]);
    fetchConnections(contact)
      .then(rows => { if (!cancelled) apply(rows); })
      .catch(e => { if (!cancelled) { apply([]); console.error('connections failed:', e); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [contact.id, contact.kind]); // eslint-disable-line

  // Search as you type. The sequence number drops a slow response for an earlier
  // keystroke that lands after a later one.
  useEffect(() => {
    const seq = ++searchSeq.current;
    if (query.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      searchByKind(currentClientId, otherKind, query)
        .then(rows => { if (seq === searchSeq.current) setResults(rows); })
        .catch(e => console.error('link search failed:', e));
    }, 200);
    return () => clearTimeout(t);
  }, [query, otherKind, currentClientId]);

  async function link(other) {
    try {
      const linkId = await addConnection({
        companyId: isCompany ? contact.id : other.id,
        personId:  isCompany ? other.id : contact.id,
        title,
      });
      apply([...links, { linkId, title: title.trim(), contact: other }]);
      setQuery(''); setTitle(''); setResults([]);
    } catch (e) {
      showToast(e.message || classifyError(e), 'error');
    }
  }

  async function unlink(l) {
    if (!await confirmRemove(`Remove the link to ${l.contact.name}? Neither contact is deleted.`)) return;
    try {
      await removeConnection(l.linkId);
      apply(links.filter(x => x.linkId !== l.linkId));
    } catch (e) {
      showToast(classifyError(e), 'error');
    }
  }

  async function open(id) {
    navigate('/contact/' + id);
    const full = await loadFullContact(id);
    if (full) setCurrentContact(full);
  }

  const linkedIds = new Set(links.map(l => l.contact.id));
  const choices = results.filter(r => !linkedIds.has(r.id));

  return (
    <div className="sidebar-section">
      {ConfirmUI}
      <div className="field-label">{isCompany ? 'People' : 'Companies'}</div>
      {loading ? (
        <div className="conn-empty">Loading…</div>
      ) : links.length === 0 ? (
        <div className="conn-empty">{isCompany ? 'Nobody linked yet.' : 'Not linked to a company.'}</div>
      ) : links.map(l => (
        <div key={l.linkId} className="conn-row">
          <OtherIcon size={13} className="conn-icon" />
          <button type="button" className="conn-name" onClick={() => open(l.contact.id)}>{l.contact.name}</button>
          {l.title && <span className="conn-title">{l.title}</span>}
          <button type="button" className="note-delete-btn" title="Remove link" onClick={() => unlink(l)}><X size={12} /></button>
        </div>
      ))}

      <div className="conn-add">
        <input
          className="inline-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={isCompany ? 'Link a person — type a name' : 'Link a company — type a name'}
        />
        {query.trim().length >= 2 && (
          <>
            <input
              className="inline-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={isCompany ? 'Their title here (optional)' : 'Title there (optional)'}
            />
            <div className="conn-results">
              {choices.length === 0 ? (
                <div className="conn-empty">
                  No {isCompany ? 'person' : 'company'} by that name. Add them with “Add Contact” first, then link.
                </div>
              ) : choices.map(r => (
                <button key={r.id} type="button" className="conn-result" onClick={() => link(r)}>
                  <OtherIcon size={12} /> {r.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
