import { useEffect, useRef, useState } from 'react';
import Modal from '../shared/Modal';
import Select from '../shared/Select';
import { useApp } from '../../context/AppContext';
import { normalizeCounty } from '../../lib/utils';
import { resolveConfig } from '../../lib/clientConfig';
import { fetchDuplicateCandidates } from '../../lib/contacts';
import { addNote } from '../../lib/notes';
import { addConnection, searchByKind } from '../../lib/links';
import { AlertTriangle, Building2, Plus, User, X } from 'lucide-react';

const cleanName = s => s.trim().replace(/\s+/g, ' ');

const COUNTIES = ['Greenville','Spartanburg','Anderson','Pickens','Cherokee','Laurens','Union','York','Chester','Oconee'];
const FORM_ID = 'add-contact-form';

function findDuplicates(contact, existing) {
  return existing.filter(c => {
    if (c.id === contact.id) return false;
    const personMatch = contact.firstName && contact.lastName &&
      c.firstName?.toLowerCase() === contact.firstName.toLowerCase() &&
      c.lastName?.toLowerCase() === contact.lastName.toLowerCase();
    // A company has one name. Only another company can be its duplicate — a person who
    // happens to share the first name is not.
    const companyMatch = contact.kind === 'company' && c.kind === 'company' && contact.firstName &&
      c.firstName?.trim().toLowerCase() === contact.firstName.trim().toLowerCase();
    const nameMatch = personMatch || companyMatch;
    const emailMatch = !!contact.email && c.email?.trim().toLowerCase() === contact.email.toLowerCase();
    const addressMatch = contact.propertyAddresses?.length && c.propertyAddresses?.length &&
      contact.propertyAddresses.some(a1 => c.propertyAddresses.some(a2 => a1.toLowerCase() === a2.toLowerCase()));
    // Tax map IDs are only unique within a county — same parcel ID in different counties is fine.
    const taxMatch = contact.taxMapIds?.length && c.taxMapIds?.length &&
      contact.county && c.county &&
      contact.county.toLowerCase() === c.county.toLowerCase() &&
      contact.taxMapIds.some(t1 => c.taxMapIds.some(t2 => t1.toLowerCase() === t2.toLowerCase()));
    return nameMatch || emailMatch || addressMatch || taxMatch;
  });
}

function defaultForm(statuses) {
  return { kind: 'person', firstName:'', lastName:'', phones:[''], email:'', county:'', ownerAddress:'', propertyAddresses:[''], taxMapIds:[''], status: statuses?.[0] || 'New Lead', notes:'',
    // The company a new person works at: { id, name } for an existing one, { id: null, name }
    // for one to create on save. Null when none.
    company: null, companyTitle: '' };
}

// A field that holds a list (phones, addresses, parcel ids): one input per value, a remove
// button once there is more than one, and a quiet "add another" underneath.
function MultiField({ label, values, onChange, onAdd, onRemove, addLabel, ...inputProps }) {
  return (
    <div className="add-field">
      <label className="add-label">{label}</label>
      {values.map((v, i) => (
        <div className="multi-row" key={i}>
          <input className="add-input" value={v} onChange={e => onChange(i, e.target.value)}
            aria-label={`${label} ${i + 1}`} autoFocus={i > 0} {...inputProps} />
          {values.length > 1 && (
            <button type="button" className="multi-remove" onClick={() => onRemove(i)} aria-label={`Remove ${label} ${i + 1}`}>
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      <button type="button" className="add-more" onClick={onAdd}><Plus size={13} /> {addLabel}</button>
    </div>
  );
}

// "Works at": search the workspace's companies as you type, pick one, or keep the typed name
// as a new company that is created when the person is saved. Same search as the contact
// page's Companies panel, so the two can't disagree about what already exists.
function CompanyField({ clientId, value, onChange, title, onTitle }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    if (query.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => {
      searchByKind(clientId, 'company', query)
        .then(rows => { if (n === seq.current) { setResults(rows); setSearched(query); } })
        .catch(e => console.error('company search failed:', e));
    }, 200);
    return () => clearTimeout(t);
  }, [query, clientId]);

  const typed = cleanName(query);
  const exact = results.find(r => r.name.trim().toLowerCase() === typed.toLowerCase());
  // "New company" only once the search for exactly this text has answered — before that,
  // "there's no company by that name" isn't known yet and would invite a duplicate.
  const canCreate = typed.length >= 2 && searched === query && !exact;

  function pick(c) {
    onChange(c);
    setQuery(''); setResults([]);
  }

  return (
    <div className="add-field">
      <label className="add-label" htmlFor="add-company-link">Company <span className="add-optional">optional</span></label>
      {value ? (
        <div className="add-company-chosen">
          <Building2 size={14} />
          <span className="add-company-name">{value.name}</span>
          {!value.id && <span className="add-optional">new</span>}
          <button type="button" className="multi-remove" onClick={() => onChange(null)} aria-label="Remove company"><X size={14} /></button>
        </div>
      ) : (
        <>
          <input id="add-company-link" className="add-input" value={query} autoComplete="off"
            onChange={e => setQuery(e.target.value)} placeholder="Where they work — type a company name"
            onKeyDown={e => {
              // Enter picks the exact match or the new company, rather than submitting the form.
              if (e.key !== 'Enter' || typed.length < 2) return;
              e.preventDefault();
              if (exact) pick(exact);
              else if (canCreate) pick({ id: null, name: typed });
            }} />
          {typed.length >= 2 && (
            <div className="conn-results">
              {results.map(r => (
                <button key={r.id} type="button" className="conn-result" onClick={() => pick(r)}>
                  <Building2 size={12} /> {r.name}
                </button>
              ))}
              {canCreate && (
                <button type="button" className="conn-result conn-create" onClick={() => pick({ id: null, name: typed })}>
                  <Plus size={12} /> New company “{typed}”
                </button>
              )}
            </div>
          )}
        </>
      )}
      {value && (
        <input className="add-input add-company-title" value={title} onChange={e => onTitle(e.target.value)}
          placeholder="Their title there (optional)" autoComplete="off" aria-label="Title at the company" />
      )}
    </div>
  );
}

export default function AddContactModal({ open, onClose }) {
  const { saveContact, setContacts, currentClientId, currentClient, showToast } = useApp();
  const cfg = resolveConfig(currentClient);
  const visibleFields = cfg.visibleFields;
  const statuses = cfg.statuses.map(s => s.value);
  const term = cfg.terminology?.contact || 'Contact';

  const [form, setForm] = useState(() => defaultForm(statuses));
  const [dupes, setDupes] = useState(null);
  const [nameError, setNameError] = useState('');
  const [saving, setSaving] = useState(false);
  const dupeRef = useRef(null);

  // A different workspace has different statuses; a status carried over from the last one
  // would save a value that workspace has no pill for.
  useEffect(() => {
    setForm(f => (statuses.includes(f.status) ? f : { ...f, status: statuses[0] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClientId]);

  useEffect(() => {
    if (dupes) dupeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [dupes]);

  const isCompany = !!cfg.companies && form.kind === 'company';
  const has = f => visibleFields.includes(f);
  const hasProperty = has('ownerAddress') || has('propertyAddresses') || has('taxMapIds');

  // Any edit invalidates the duplicate warning: it described the form as it was.
  function edit(fn) {
    setForm(fn);
    setDupes(null);
    setNameError('');
  }
  const update = (field, val) => edit(f => ({ ...f, [field]: val }));
  const updateArr = (field, i, val) => edit(f => { const a = [...f[field]]; a[i] = val; return { ...f, [field]: a }; });
  const addArr = field => setForm(f => ({ ...f, [field]: [...f[field], ''] }));
  const removeArr = (field, i) => edit(f => ({ ...f, [field]: f[field].filter((_, j) => j !== i) }));

  function buildContact() {
    return {
      kind: isCompany ? 'company' : 'person',
      // No id — the DB assigns it via property_crm_contacts_id_seq. saveContact
      // inserts new (id-less) contacts and reads the generated id back.
      firstName: form.firstName.trim(),
      lastName: isCompany ? '' : form.lastName.trim(),
      phones: form.phones.map(p => p.trim()).filter(Boolean),
      email: form.email.trim(),
      county: normalizeCounty(form.county),
      ownerAddress: form.ownerAddress.trim(),
      propertyAddresses: form.propertyAddresses.map(a => a.trim()).filter(Boolean),
      taxMapIds: form.taxMapIds.map(t => t.trim()).filter(Boolean),
      status: form.status,
      notes: form.notes.trim(),
      customFields: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async function submit(e) {
    e?.preventDefault();
    if (saving) return;
    if (!form.firstName.trim() && (isCompany || !form.lastName.trim())) {
      setNameError(isCompany ? 'Enter the company name.' : 'Enter a first or last name.');
      return;
    }
    const contact = buildContact();
    setSaving(true);
    try {
      // `dupes` already set means the warning is on screen and this is "save anyway".
      if (!dupes) {
        // Ask the DB for rows that could collide, then apply the precise rules above.
        // AppContext's `contacts` is one page of the list, not the corpus. A failed
        // lookup must not block the save.
        let found = [];
        try {
          found = findDuplicates(contact, await fetchDuplicateCandidates(currentClientId, contact));
        } catch (err) {
          console.error('Duplicate check failed:', err);
        }
        if (found.length > 0) { setDupes(found); return; }
      }
      // A failed save keeps the modal open with everything still typed in.
      if (!(await createWithNote(contact))) return;
      setForm(defaultForm(statuses));
      setDupes(null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // The note typed on the form becomes the contact's first note. It has to follow the
  // insert — a note needs the contact's id — so a failure here leaves a saved contact with
  // no note, and says so rather than pretending the whole thing failed.
  async function createWithNote(contact) {
    const saved = await saveContact(contact);
    if (saved && !isCompany && form.company) await linkCompany(saved, form.company, form.companyTitle);
    const text = (contact.notes || '').trim();
    if (!saved || !text) return saved;
    try {
      const note = await addNote(saved.id, text);
      setContacts(prev => prev.map(c => (c.id === saved.id ? { ...c, noteCount: 1, lastNoteAt: note.createdAt } : c)));
    } catch (err) {
      console.error('First note failed:', err);
      showToast('Contact saved, but the note was not — add it from the contact.', 'warning');
    }
    return saved;
  }

  // The person is already saved by now, so a failure here leaves them in the book without
  // the company link — said plainly, with how to finish it, rather than as a failed save.
  async function linkCompany(person, company, title) {
    try {
      let companyId = company.id;
      if (!companyId) {
        const now = new Date().toISOString();
        const made = await saveContact({
          kind: 'company', firstName: company.name, lastName: '', phones: [], email: '', county: '',
          ownerAddress: '', propertyAddresses: [], taxMapIds: [], status: statuses[0],
          notes: '', customFields: {}, createdAt: now, updatedAt: now,
        });
        if (!made) throw new Error('company not created');
        companyId = made.id;
      }
      await addConnection({ companyId, personId: person.id, title });
    } catch (err) {
      console.error('Company link failed:', err);
      showToast(`Contact saved, but not linked to ${company.name} — link it from their page.`, 'warning');
    }
  }

  function close() {
    setDupes(null);
    setNameError('');
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title={`Add ${term}`} width="520px"
      footer={
        <>
          <button type="button" onClick={close}>Cancel</button>
          <button type="submit" form={FORM_ID} className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : dupes ? 'Save Anyway' : `Save ${term}`}
          </button>
        </>
      }>
      <form id={FORM_ID} className="add-form" onSubmit={submit} noValidate>
        {dupes && (
          <div className="dupe-banner" ref={dupeRef} role="alert">
            <div className="dupe-title"><AlertTriangle size={14} /> This may already exist</div>
            {dupes.map(d => (
              <div key={d.id} className="dupe-item">
                <strong>{d.firstName} {d.lastName}</strong>
                {d.email && <span className="dupe-meta">{d.email}</span>}
                {d.county && <span className="dupe-meta">{d.county}</span>}
                {d.taxMapIds?.[0] && <span className="dupe-meta dupe-mono">{d.taxMapIds[0]}</span>}
              </div>
            ))}
            <div className="dupe-sub">Edit the details below, or save anyway to keep both.</div>
          </div>
        )}

        {cfg.companies && (
          <div className="kind-toggle" role="tablist" aria-label="Contact type">
            <button type="button" role="tab" aria-selected={!isCompany} className={`kind-btn${!isCompany ? ' active' : ''}`} onClick={() => update('kind', 'person')}>
              <User size={14} /> Person
            </button>
            <button type="button" role="tab" aria-selected={isCompany} className={`kind-btn${isCompany ? ' active' : ''}`} onClick={() => update('kind', 'company')}>
              <Building2 size={14} /> Company
            </button>
          </div>
        )}

        {isCompany ? (
          <div className="add-field">
            <label className="add-label" htmlFor="add-company">Company name</label>
            <input id="add-company" data-autofocus className={`add-input${nameError ? ' invalid' : ''}`} value={form.firstName}
              onChange={e => update('firstName', e.target.value)} placeholder="Acme Holdings LLC" autoComplete="off" />
          </div>
        ) : (
          <div className="add-field-row">
            <div className="add-field">
              <label className="add-label" htmlFor="add-first">First name</label>
              <input id="add-first" data-autofocus className={`add-input${nameError ? ' invalid' : ''}`} value={form.firstName}
                onChange={e => update('firstName', e.target.value)} autoComplete="off" />
            </div>
            <div className="add-field">
              <label className="add-label" htmlFor="add-last">Last name</label>
              <input id="add-last" className={`add-input${nameError ? ' invalid' : ''}`} value={form.lastName}
                onChange={e => update('lastName', e.target.value)} autoComplete="off" />
            </div>
          </div>
        )}
        {nameError && <div className="add-error" role="alert">{nameError}</div>}

        {cfg.companies && !isCompany && (
          <CompanyField clientId={currentClientId} value={form.company} onChange={c => setForm(f => ({ ...f, company: c }))}
            title={form.companyTitle} onTitle={t => setForm(f => ({ ...f, companyTitle: t }))} />
        )}

        <MultiField label="Phone" values={form.phones} addLabel="Add phone"
          type="tel" inputMode="tel" placeholder="(864) 555-1234" autoComplete="off"
          onChange={(i, v) => updateArr('phones', i, v)} onAdd={() => addArr('phones')} onRemove={i => removeArr('phones', i)} />

        <div className="add-field">
          <label className="add-label" htmlFor="add-email">Email</label>
          <input id="add-email" className="add-input" type="email" inputMode="email" value={form.email}
            onChange={e => update('email', e.target.value)} placeholder="name@example.com" autoComplete="off" />
        </div>

        <div className="add-field-row">
          <div className="add-field">
            <label className="add-label">Status</label>
            <Select value={form.status} onChange={v => update('status', v)} options={statuses} emptyLabel={null} />
          </div>
          {has('county') && (
            <div className="add-field">
              <label className="add-label">County</label>
              <Select value={form.county} onChange={v => update('county', v)} options={COUNTIES} emptyLabel="Select county" />
            </div>
          )}
        </div>

        {hasProperty && <div className="add-section">Property</div>}
        {has('ownerAddress') && (
          <div className="add-field">
            <label className="add-label" htmlFor="add-owner-address">Owner address</label>
            <input id="add-owner-address" className="add-input" value={form.ownerAddress}
              onChange={e => update('ownerAddress', e.target.value)} placeholder="Mailing address" autoComplete="off" />
          </div>
        )}
        {has('propertyAddresses') && (
          <MultiField label="Property address" values={form.propertyAddresses} addLabel="Add address" autoComplete="off"
            onChange={(i, v) => updateArr('propertyAddresses', i, v)} onAdd={() => addArr('propertyAddresses')} onRemove={i => removeArr('propertyAddresses', i)} />
        )}
        {has('taxMapIds') && (
          <MultiField label="Tax map ID" values={form.taxMapIds} addLabel="Add tax map ID" autoComplete="off"
            onChange={(i, v) => updateArr('taxMapIds', i, v)} onAdd={() => addArr('taxMapIds')} onRemove={i => removeArr('taxMapIds', i)} />
        )}

        <div className="add-field">
          <label className="add-label" htmlFor="add-notes">Note <span className="add-optional">optional</span></label>
          <textarea id="add-notes" className="add-input" value={form.notes} onChange={e => update('notes', e.target.value)}
            rows={3} placeholder="Saved as the first note" />
        </div>
      </form>
    </Modal>
  );
}
