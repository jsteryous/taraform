import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useDraftSave } from '../../hooks/useDraftSave';
import { formatPhone, normalizePhone, parseCustomFieldDefs } from '../../lib/utils';
import { isFollowUpDue, todayStr, autoFollowUpDate, followUpWindow } from '../../lib/contactFilters';
import { scheduleAfterNote, clearOnStatusChange, attemptGap, attemptLabel, schedulesFor, cadenceFor } from '../../lib/followUpCadence';
import { resolveConfig } from '../../lib/clientConfig';
import StatusBadge from './StatusBadge';
import { setAutoFollowUp } from '../../lib/api';
import NotesTab from './NotesTab';
import ConnectionsPanel from './ConnectionsPanel';
import OffersTab from './OffersTab';
import WaysInColumn from './WaysInColumn';
import Select from '../shared/Select';
import { useConfirm } from '../shared/ConfirmDialog';
import CallSetupModal from '../modals/CallSetupModal';
import { ArrowLeft, Copy, Check, Trash2, Phone, PhoneOff, Pencil, HelpCircle } from 'lucide-react';


export default function ContactDetail({ onClose }) {
  const { currentContact, setCurrentContact, saveContact, deleteContact, currentClient, setClientsList, showToast } = useApp();
  const cfg = resolveConfig(currentClient);
  const STATUSES = cfg.statuses.map(s => s.value);
  const [tab, setTab] = useState('notes');
  const [draft, setDraft] = useState(null);
  const [editingPhone, setEditingPhone] = useState(null); // index of phone row in edit mode
  const [showCallHelp, setShowCallHelp] = useState(false);
  // Who this contact is linked to, as reported by ConnectionsPanel. A company's Notes
  // tab uses it to pull in the notes written on its people.
  const [connections, setConnections] = useState([]);
  const [confirmDelete, ConfirmUI] = useConfirm();

  // Browsers can't tell us whether a tel: click reached a handler, so after
  // the very first desktop call attempt we offer setup help once. The help
  // icon next to the Phones label reopens it anytime.
  function handleTelClick() {
    if (/iPhone|iPad|Android/i.test(navigator.userAgent)) return; // phones just work
    if (localStorage.getItem('taraform_call_help_seen')) return;
    localStorage.setItem('taraform_call_help_seen', '1');
    setTimeout(() => setShowCallHelp(true), 1200); // let the OS handoff happen first
  }
  const [sidebarW, setSidebarW] = useState(() => {
    const v = parseInt(localStorage.getItem('taraform_sidebar_w'), 10);
    return Number.isFinite(v) ? Math.min(700, Math.max(220, v)) : 300;
  });
  const [sidebarDragging, setSidebarDragging] = useState(false);

  function startSidebarDrag(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarW;
    setSidebarDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    let w = startW;
    function onMove(ev) {
      w = Math.min(700, Math.max(220, startW + ev.clientX - startX));
      setSidebarW(w);
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarDragging(false);
      localStorage.setItem('taraform_sidebar_w', String(w));
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const fieldDefs = parseCustomFieldDefs(currentClient?.custom_field_definitions);
  const visibleFields = cfg.visibleFields;

  useEffect(() => {
    if (currentContact) setDraft({ ...currentContact });
    setEditingPhone(null);
  }, [currentContact?.id, currentContact?.offers]);

  const { saveStatus, update, updateMultiple, updateCustomField } =
    useDraftSave(draft, setDraft, setCurrentContact, saveContact, showToast);

  // Esc closes the overlay — but inner layers win: a focused field just
  // blurs (which also triggers blur-to-save), and an open confirm dialog
  // or dropdown swallows the press so a second Esc is needed to close.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) { el.blur(); return; }
      if (document.querySelector('.confirm-overlay, .custom-select-dropdown, .filter-dropdown, .modal.active')) return;
      onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!currentContact || !draft) return null;

  async function handleDelete() {
    if (!await confirmDelete('Delete this contact? This cannot be undone.')) return;
    await deleteContact(currentContact.id);
    onClose();
  }

  function updatePhone(idx, val) {
    const phones = [...(draft.phones || [])];
    phones[idx] = val;
    // Drop empty/whitespace entries so abandoned "+ Add Phone" slots never persist.
    update('phones', phones.filter(p => p && p.trim()));
  }
  // Local-only: just add an empty slot + focus it. The number is saved once, on blur.
  // Do NOT save here — saving the empty slot used to race the blur-save and clobber it.
  function addPhone() {
    setEditingPhone(draft.phones?.length || 0);
    setDraft(d => ({ ...d, phones: [...(d.phones || []), ''] }));
  }
  async function removePhone(idx) {
    const val = (draft.phones || [])[idx];
    if (val && !await confirmDelete(`Remove phone ${val}?`)) return;
    update('phones', (draft.phones || []).filter((_, i) => i !== idx));
    setEditingPhone(null);
  }
  // Mark a number "no good" (wrong/disconnected) without deleting it. We store the
  // normalized digits so the flag survives a reformat; the number still shows, struck.
  // Marking a number bad clears "verified" for it — the two states are mutually exclusive.
  function toggleBadPhone(p) {
    const digits = normalizePhone(p);
    if (!digits) return;
    const bad = draft.badPhones || [];
    const nowBad = !bad.includes(digits);
    updateMultiple({
      badPhones: nowBad ? [...bad, digits] : bad.filter(d => d !== digits),
      ...(nowBad ? { verifiedPhones: (draft.verifiedPhones || []).filter(d => d !== digits) } : {}),
    });
  }
  // Mark a number "verified" (confirmed working) — the opposite of toggleBadPhone.
  // Marking a number verified clears "no good" for it.
  function toggleVerifiedPhone(p) {
    const digits = normalizePhone(p);
    if (!digits) return;
    const verified = draft.verifiedPhones || [];
    const nowVerified = !verified.includes(digits);
    updateMultiple({
      verifiedPhones: nowVerified ? [...verified, digits] : verified.filter(d => d !== digits),
      ...(nowVerified ? { badPhones: (draft.badPhones || []).filter(d => d !== digits) } : {}),
    });
  }

  function updateMultiField(field, idx, val) {
    const arr = [...(draft[field] || [])];
    arr[idx] = val;
    update(field, arr);
  }
  function addToMultiField(field) { update(field, [...(draft[field] || []), '']); }
  async function removeFromMultiField(field, idx, label) {
    const val = (draft[field] || [])[idx];
    if (val && !await confirmDelete(`Remove ${label} "${val}"?`)) return;
    update(field, (draft[field] || []).filter((_, i) => i !== idx));
  }

  // Due via the manual date or the auto rule (eligible status + stale notes) — same
  // predicate the queue filter uses, so the badge agrees with the list.
  const followUpDue = isFollowUpDue(draft, cfg.followUp);

  function followUpPreset(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return todayStr(d);
  }

  // Attempts made, and the wait the NEXT one will earn (attempts+1, since logging it is
  // what schedules). Null off-cadence — an Offer Made contact isn't on a call clock.
  const attempts   = draft.noteCount || 0;
  const cadence    = cadenceFor(draft.status, cfg.followUp?.cadence);
  const onCadence  = schedulesFor(draft.status, cadence);
  const nextGap    = onCadence ? attemptGap(attempts + 1, cadence) : null;

  // The next call as a sentence, so the schedule is visible without decoding an empty date
  // field. Three cases: a stored date; no date but the stale-note rule will resurface it
  // (In Network, Contacted); and no date on a status only a date can queue — which means
  // nothing will ever bring it back, so say so rather than leave a blank field.
  const autoDate = autoFollowUpDate(draft, cfg.followUp);
  const nextCall = draft.followUpOn
    ? { text: `Next call ${longDate(draft.followUpOn)}`, sub: relativeDays(draft.followUpOn) }
    : autoDate
      ? { text: `Comes due ${longDate(autoDate)}`, sub: `${followUpWindow(draft.status, cfg.followUp)} days after the last note` }
      : attempts > 0 && onCadence
        ? { text: 'No call scheduled', sub: 'pick a date, or it won’t come back up', warn: true }
        : null;

  // Marking a contact dead/closed/NFS retires its scheduled call, in the SAME save as the
  // status — two sequential saves would race through draftRef (see components/CLAUDE.md).
  function handleStatusChange(next) {
    const cleared = clearOnStatusChange(next, draft.followUpOn, cfg.followUp);
    if (cleared === undefined) update('status', next);
    else updateMultiple({ status: next, followUpOn: cleared });
  }

  // The Notes tab writes notes itself (they are rows in contact_notes, not a field on the
  // contact) and reports the new totals here. Logging a note is logging a call, so it
  // schedules the next one: scheduleAfterNote owns that decision (lib/followUpCadence.js)
  // and returns a date, null to clear, or undefined to leave the field alone. Deleting a
  // note is not a call and never reschedules.
  //
  // Either way the contact is saved. That is deliberate, not incidental: the save bumps
  // updated_at, which is what keeps a just-worked contact at the top of the list and what
  // runs the drift re-check against the active filter. noteCount / lastNoteAt ride along
  // for the local copy only — mapContactToDb does not send them; the DB trigger owns them.
  // Each person's own switch, per workspace, on by default (client_users.auto_follow_up).
  // It changes what THIS person's notes do; it does not touch teammates or existing dates.
  const autoFollowUp = currentClient?.autoFollowUp !== false;
  async function toggleAutoFollowUp() {
    const next = !autoFollowUp;
    const id = currentClient.id;
    setClientsList(list => list.map(c => (c.id === id ? { ...c, autoFollowUp: next } : c)));
    try {
      await setAutoFollowUp(id, next);
    } catch (e) {
      setClientsList(list => list.map(c => (c.id === id ? { ...c, autoFollowUp: !next } : c)));
      showToast('Could not change that setting — try again', 'error');
    }
  }

  function handleNotesChanged({ count, lastNoteAt, added }) {
    const fields = { noteCount: count, lastNoteAt };
    // With this person's switch off, a note is just a note: the date is theirs to set.
    if (added && autoFollowUp) {
      const next = scheduleAfterNote(count, draft.status, draft.followUpOn, cfg.followUp);
      if (next !== undefined) fields.followUpOn = next;
    }
    updateMultiple(fields);
  }


  return (
    <div id="contactDetailPage" className="active">
      {ConfirmUI}
      <CallSetupModal open={showCallHelp} onClose={() => setShowCallHelp(false)} />
      {/* Header */}
      <div className="detail-page-header">
        <button className="back-button" onClick={onClose}><ArrowLeft size={15} /> Back <kbd className="kbd-hint">esc</kbd></button>
        <StatusBadge cfg={cfg} status={draft.status} />
        {saveStatus === 'saving' && <span className="save-indicator">Saving…</span>}
        {saveStatus === 'saved' && <span className="save-indicator saved"><Check size={12} /> Saved</span>}
        <button className="btn-danger-ghost" onClick={handleDelete}><Trash2 size={13} /> Delete</button>
      </div>

      <div className="detail-page-content" style={{ '--sidebar-w': `${sidebarW}px` }}>
        {/* ── Sidebar ── */}
        <div className="contact-info-sidebar">

          {/* Name */}
          <div style={{ marginBottom: '1rem' }}>
            {draft.kind === 'company' ? (
              <input
                value={draft.firstName || ''}
                onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))}
                onBlur={e => update('firstName', e.target.value)}
                placeholder="Company name"
                className="inline-input name-input"
              />
            ) : (
              <>
            <input
              value={draft.firstName || ''}
              onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))}
              onBlur={e => update('firstName', e.target.value)}
              placeholder="First name"
              className="inline-input name-input"
              style={{ marginBottom: '0.25rem' }}
            />
            <input
              value={draft.lastName || ''}
              onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))}
              onBlur={e => update('lastName', e.target.value)}
              placeholder="Last name"
              className="inline-input name-input"
            />
              </>
            )}
          </div>

          {/* Status */}
          <div style={{ marginBottom: '1rem' }}>
            <div className="field-label">Status</div>
            <Select value={draft.status || 'New Lead'} onChange={handleStatusChange} options={STATUSES} emptyLabel={null} />
          </div>

          {/* Follow-up — the date the next call is due. Normally written by the cadence when a
              note is logged; editable here, and a future date entered by hand outranks the
              cadence. The auto rule (Contacted + stale notes) can still mark Due without a
              date. Presets save immediately, like quick notes. */}
          <div style={{ marginBottom: '1rem' }}>
            <div className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              Follow-up
              {followUpDue && <span className="followup-due-badge">Due</span>}
            </div>
            <input type="date" className="inline-input" value={draft.followUpOn || ''}
              onChange={e => setDraft(d => ({ ...d, followUpOn: e.target.value || null }))}
              onBlur={e => update('followUpOn', e.target.value || null)}
            />
            <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
              {[['1w', 7], ['2w', 14], ['1m', 30], ['3m', 90]].map(([label, days]) => (
                <button key={label} type="button" className="btn-small"
                  onClick={() => update('followUpOn', followUpPreset(days))}>{label}</button>
              ))}
              {draft.followUpOn && (
                <button type="button" className="btn-small" onClick={() => update('followUpOn', null)}>Clear</button>
              )}
            </div>
            {nextCall && (
              <div className={`followup-next${nextCall.warn ? ' warn' : ''}`}>
                {nextCall.text}{nextCall.sub && <span className="followup-next-sub"> · {nextCall.sub}</span>}
              </div>
            )}
            {cfg.followUp?.cadence && (
              <label className="followup-auto" title="When on, logging a note schedules your next call automatically. This is your own setting; teammates have theirs.">
                <input type="checkbox" checked={autoFollowUp} onChange={toggleAutoFollowUp} />
                Schedule my next call automatically
              </label>
            )}
            {attempts > 0 && autoFollowUp && (
              <div className="followup-cadence" title={onCadence
                ? `Each note counts as a call attempt. Logging the next one schedules the following call ${nextGap} days out.`
                : `Calls on "${draft.status}" don't auto-schedule — set a date by hand.`}>
                {attemptLabel(attempts, cadence)}
                {nextGap != null && ` · next +${nextGap}d`}
              </div>
            )}
          </div>

          {/* Lead Source */}
          {cfg.leadSourceOptions?.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="field-label">Lead Source</div>
              <Select value={draft.leadSource || ''} onChange={v => update('leadSource', v)} options={cfg.leadSourceOptions} />
            </div>
          )}

          {/* Phones — blue panel so it's findable at a glance when keying
              in numbers from another screen (e.g. Forewarn) */}
          <div className="phone-section">
            <div className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              Phones
              <button className="copy-btn" onClick={() => setShowCallHelp(true)} title="Set up click-to-call"><HelpCircle size={12} /></button>
            </div>
            {(draft.phones?.length ? draft.phones : ['']).map((p, i) => {
              const isBad = (draft.badPhones || []).includes(normalizePhone(p));
              const isVerified = (draft.verifiedPhones || []).includes(normalizePhone(p));
              return (
              <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                {(editingPhone === i || !p) ? (
                  <>
                    <input type="tel" value={p} placeholder="(864) 555-1234"
                      autoFocus={editingPhone === i}
                      className="inline-input" style={{ flex: 1 }}
                      onChange={e => {
                        const phones = [...(draft.phones || [])];
                        phones[i] = e.target.value;
                        setDraft(d => ({ ...d, phones }));
                      }}
                      onBlur={e => { updatePhone(i, formatPhone(e.target.value)); setEditingPhone(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                    />
                    {/* preventDefault keeps the input focused so blur-save doesn't race the remove click */}
                    <button className="remove-field-btn" onMouseDown={e => e.preventDefault()} onClick={() => removePhone(i)}>×</button>
                  </>
                ) : (
                  <>
                    <a className={`phone-link${isBad ? ' phone-bad' : ''}${isVerified ? ' phone-verified' : ''}`} href={`tel:+1${normalizePhone(p)}`} title="Call" onClick={handleTelClick}>
                      <Phone size={13} /> {p}
                    </a>
                    <button className={`copy-btn${isVerified ? ' phone-verified-toggle' : ''}`} onClick={() => toggleVerifiedPhone(p)}
                            title={isVerified ? 'Unmark — no longer verified' : 'Mark as verified'}>
                      <Check size={13} />
                    </button>
                    <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(p); showToast('Copied!'); }} title="Copy"><Copy size={13} /></button>
                    <button className="copy-btn" onClick={() => setEditingPhone(i)} title="Edit"><Pencil size={13} /></button>
                    <button className={`copy-btn${isBad ? ' phone-bad-toggle' : ''}`} onClick={() => toggleBadPhone(p)}
                            title={isBad ? 'Unmark — number is OK' : 'Mark as no good'}>
                      <PhoneOff size={13} />
                    </button>
                  </>
                )}
              </div>
              );
            })}
            <button className="add-field-btn" onClick={addPhone}>+ Add Phone</button>
          </div>

          {/* Email */}
          <div style={{ marginBottom: '1rem' }}>
            <div className="field-label">Email</div>
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="email" value={draft.email || ''} placeholder="—"
                className="inline-input" style={{ flex: 1 }}
                onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                onBlur={e => update('email', e.target.value)}
              />
              {draft.email && (
                <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(draft.email); showToast('Copied!'); }} title="Copy"><Copy size={13} /></button>
              )}
            </div>
          </div>

          {/* County */}
          {visibleFields.includes('county') && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="field-label">County</div>
              <input value={draft.county || ''} className="inline-input"
                onChange={e => setDraft(d => ({ ...d, county: e.target.value }))}
                onBlur={e => update('county', e.target.value)}
                placeholder="—"
              />
            </div>
          )}

          {/* Tax Map IDs */}
          {visibleFields.includes('taxMapIds') && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="field-label">Tax Map IDs</div>
              {/* No filter(Boolean) here: the row "Add Tax ID" appends is empty,
                  and filtering would both hide it and shift row indices */}
              {(draft.taxMapIds || []).map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <input value={t} className="inline-input" style={{ flex: 1 }}
                    onChange={e => {
                      const arr = [...(draft.taxMapIds || [])];
                      arr[i] = e.target.value;
                      setDraft(d => ({ ...d, taxMapIds: arr }));
                    }}
                    onBlur={e => updateMultiField('taxMapIds', i, e.target.value)}
                    placeholder="—"
                  />
                  {t && <button className="copy-btn" onClick={() => { navigator.clipboard.writeText(t); showToast('Copied!'); }} title="Copy"><Copy size={14} /></button>}
                  <button className="remove-field-btn" onClick={() => removeFromMultiField('taxMapIds', i, 'tax map ID')}>×</button>
                </div>
              ))}
              <button className="add-field-btn" onClick={() => addToMultiField('taxMapIds')}>+ Add Tax ID</button>
            </div>
          )}

          {/* Acreage */}
          {visibleFields.includes('acreage') && (
            <div style={{ marginBottom: '1rem' }}>
              <div className="field-label">Acreage</div>
              <input value={draft.acreage || ''} className="inline-input"
                onChange={e => setDraft(d => ({ ...d, acreage: e.target.value }))}
                onBlur={e => update('acreage', e.target.value)}
                placeholder="—"
              />
            </div>
          )}

          {/* People at a company / companies a person belongs to */}
          {cfg.companies && (
            <ConnectionsPanel key={draft.id} contact={draft} onLoaded={setConnections} />
          )}

          {/* Addresses section */}
          {(visibleFields.includes('ownerAddress') || visibleFields.includes('propertyAddresses')) && (
            <div className="sidebar-section">

              {visibleFields.includes('ownerAddress') && (
                <div style={{ marginBottom: '1rem' }}>
                  <div className="field-label">Owner Address</div>
                  <input value={draft.ownerAddress || ''} className="inline-input"
                    onChange={e => setDraft(d => ({ ...d, ownerAddress: e.target.value }))}
                    onBlur={e => update('ownerAddress', e.target.value)}
                    placeholder="—"
                  />
                </div>
              )}

              {visibleFields.includes('propertyAddresses') && (
                <div style={{ marginBottom: '1rem' }}>
                  <div className="field-label">Property Addresses</div>
                  {(draft.propertyAddresses || []).map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <input value={a} className="inline-input" style={{ flex: 1 }}
                        onChange={e => {
                          const arr = [...(draft.propertyAddresses || [])];
                          arr[i] = e.target.value;
                          setDraft(d => ({ ...d, propertyAddresses: arr }));
                        }}
                        onBlur={e => updateMultiField('propertyAddresses', i, e.target.value)}
                        placeholder="—"
                      />
                      <button className="remove-field-btn" onClick={() => removeFromMultiField('propertyAddresses', i, 'property address')}>×</button>
                    </div>
                  ))}
                  <button className="add-field-btn" onClick={() => addToMultiField('propertyAddresses')}>+ Add Property</button>
                </div>
              )}
            </div>
          )}

          {/* Custom fields */}
          {(() => {
            const knownKeys = new Set(fieldDefs.map(d => d.key));
            const adHocKeys = Object.keys(draft.customFields || {}).filter(k => !knownKeys.has(k) && draft.customFields[k]);
            if (fieldDefs.length === 0 && adHocKeys.length === 0) return null;
            return (
              <div className="sidebar-section">
                {fieldDefs.map(def => (
                  <div key={def.key} style={{ marginBottom: '1rem' }}>
                    <div className="field-label">{def.label}</div>
                    <input value={draft.customFields?.[def.key] || ''} placeholder="—"
                      className="inline-input"
                      onChange={e => setDraft(d => ({ ...d, customFields: { ...d.customFields, [def.key]: e.target.value } }))}
                      onBlur={e => updateCustomField(def.key, e.target.value)}
                    />
                  </div>
                ))}
                {adHocKeys.map(key => (
                  <div key={key} style={{ marginBottom: '1rem' }}>
                    <div className="field-label">{key.replace(/_/g, ' ')}</div>
                    <input value={draft.customFields?.[key] || ''} placeholder="—"
                      className="inline-input"
                      onChange={e => setDraft(d => ({ ...d, customFields: { ...d.customFields, [key]: e.target.value } }))}
                      onBlur={e => updateCustomField(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Resize handle — absolutely positioned in the grid gap right of the sidebar */}
        <div
          className={`sidebar-resize-handle${sidebarDragging ? ' dragging' : ''}`}
          onMouseDown={startSidebarDrag}
          title="Drag to resize"
        />

        {/* ── Main area ── */}
        <div className="notes-main-area">
          <div className="detail-tabs" role="tablist" aria-label="Contact sections">
            <button
              role="tab"
              id="tab-notes"
              aria-selected={tab === 'notes'}
              aria-controls="tabpanel-notes"
              tabIndex={0}
              className={`detail-tab${tab === 'notes' ? ' active' : ''}`}
              onClick={() => setTab('notes')}
            >
              Notes &amp; Activity
            </button>
          </div>
          <div role="tabpanel" id="tabpanel-notes" aria-labelledby="tab-notes" hidden={tab !== 'notes'}>
            {tab === 'notes' && <NotesTab key={draft.id} contact={draft} onNotesChanged={handleNotesChanged} quickNotes={cfg.quickNotes}
              related={cfg.companies && draft.kind === 'company' ? connections.map(l => ({ id: l.contact.id, name: l.contact.name })) : []} />}
          </div>
        </div>

        {/* ── Offers — equal split right column ── */}
        {cfg.tabs.includes('offers') && (
          <div className="offers-column">
            <div className="offers-column-header">
              <span className="field-label">Offers</span>
              {(draft.offers || []).length > 0 && (
                <span className="offers-count">
                  {(draft.offers || []).length} offer{(draft.offers || []).length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <OffersTab contact={draft} onChangeMultiple={updateMultiple}
              onOffersChange={offers => setDraft(prev => ({ ...prev, offers }))} />
          </div>
        )}

        {/* ── Connections & Ways In — the same right column, in workspaces without offers ── */}
        {cfg.connections && !cfg.tabs.includes('offers') && (
          <WaysInColumn key={draft.id} contact={draft} />
        )}

      </div>
    </div>
  );
}

// "Mon, Feb 15, 2027" from a YYYY-MM-DD date column, read in the local calendar.
function longDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeDays(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const n = Math.round((new Date(y, m - 1, d) - t) / 86400000);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 0) return `in ${n} days`;
  return n === -1 ? '1 day overdue' : `${-n} days overdue`;
}
