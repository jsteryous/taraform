import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, User, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../shared/ConfirmDialog';
import { fetchConnections, addConnection, removeConnection, searchByKind } from '../../lib/links';
import { classifyError } from '../../lib/errors';
import { resolveConfig } from '../../lib/clientConfig';

// Who this contact is connected to: a company's people, or a person's companies.
// Loads and edits the links itself; `onLoaded` tells the parent who is connected so a
// company's Notes tab can pull in the notes written on its people.
export default function ConnectionsPanel({ contact, onLoaded }) {
  const { currentClientId, currentClient, loadFullContact, setCurrentContact, saveContact, showToast } = useApp();
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
  const [creating, setCreating] = useState(false);
  // The query the current `results` answer. Until it matches what is typed, "no company by
  // that name" is not yet known, and offering to create one would invite a duplicate.
  const [searched, setSearched] = useState('');
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
        .then(rows => { if (seq === searchSeq.current) { setResults(rows); setSearched(query); } })
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

  // Typing a company that does not exist yet offers to create it. It is a deliberate,
  // confirmed step rather than something that happens on blur: a typo here would
  // otherwise become a permanent second company in a book other people share.
  async function createAndLink() {
    const name = query.trim().replace(/\s+/g, ' ');
    if (!name || creating) return;
    if (!await confirmRemove(`Create “${name}” as a new company and link it to this contact?`, { danger: false })) return;
    setCreating(true);
    let company;
    try {
      const now = new Date().toISOString();
      company = await saveContact({
        kind: 'company', firstName: name, lastName: '', phones: [], county: '', ownerAddress: '',
        propertyAddresses: [], taxMapIds: [], status: resolveConfig(currentClient).statuses[0].value,
        notes: '', customFields: {}, createdAt: now, updatedAt: now,
      });
      if (!company) throw new Error('The company could not be created.');
    } catch (e) {
      setCreating(false);
      showToast(e.message || classifyError(e), 'error');
      return;
    }
    try {
      const linkId = await addConnection({ companyId: company.id, personId: contact.id, title });
      apply([...links, { linkId, title: title.trim(), contact: { id: company.id, name, phone: '', status: company.status, kind: 'company' } }]);
      setQuery(''); setTitle(''); setResults([]);
    } catch (e) {
      console.error('link after create failed:', e);
      showToast(`“${name}” was created but not linked — search for it and link it.`, 'warning');
    } finally {
      setCreating(false);
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
  const typed = query.trim().replace(/\s+/g, ' ');
  const exactExists = [...results, ...links.map(l => l.contact)]
    .some(r => r.name.trim().toLowerCase() === typed.toLowerCase());
  const canCreate = !isCompany && typed.length >= 2 && searched === query && !exactExists;

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
              {choices.map(r => (
                <button key={r.id} type="button" className="conn-result" onClick={() => link(r)}>
                  <OtherIcon size={12} /> {r.name}
                </button>
              ))}
              {canCreate ? (
                <button type="button" className="conn-result conn-create" onClick={createAndLink} disabled={creating}>
                  <Plus size={12} /> {creating ? 'Creating…' : `Create company “${typed}”`}
                </button>
              ) : isCompany && choices.length === 0 && (
                <div className="conn-empty">No person by that name. Add them with “Add Contact” first, then link.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
