import { useMemo, useRef, useState } from 'react';
import Modal from '../shared/Modal';
import Select from '../shared/Select';
import { useApp } from '../../context/AppContext';
import { resolveConfig } from '../../lib/clientConfig';
import { parseCSVRaw } from '../../lib/utils';
import { fetchDedupIndex } from '../../lib/contacts';
import { BANKING_FIELDS, autoMapBanking, planBankingImport, runBankingImport, planFirstCalls } from '../../lib/bankingImport';
import { AlertTriangle, FileText } from 'lucide-react';

// CSV import for workspaces with companies. The rules live in lib/bankingImport.js; this
// is the four steps around them: pick a file, check the columns, preview, import.

const SHOWN = 8; // rows of detail per list before "+N more"

function More({ n }) {
  return n > SHOWN ? <div className="bi-more">+{n - SHOWN} more</div> : null;
}

export default function BankingImportModal({ open, onClose }) {
  const { currentClient, currentClientId, user, showToast, loadContacts, filters } = useApp();
  const statuses = useMemo(() => resolveConfig(currentClient).statuses.map(s => s.value), [currentClient]);

  const [step, setStep] = useState('upload'); // upload | map | preview | importing | done
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [existing, setExisting] = useState(null);
  const [aliases, setAliases] = useState({});
  // First calls per weekday for contacts that arrive with no notes (a purchased list).
  // 0 leaves them unscheduled.
  const [perDay, setPerDay] = useState(5);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState([0, 0]);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const plan = useMemo(() => (existing
    ? planBankingImport({ rows, mapping, existing, statuses, statusAliases: aliases })
    : null), [rows, mapping, existing, statuses, aliases]);
  const cadenceStatuses = useMemo(() => resolveConfig(currentClient).followUp?.cadence?.statuses || [], [currentClient]);
  const firstCalls = useMemo(() => planFirstCalls(plan, { perDay, statuses: cadenceStatuses }), [plan, perDay, cadenceStatuses]);
  const unscheduled = useMemo(() => planFirstCalls(plan, { perDay: 1e9, statuses: cadenceStatuses }).size, [plan, cadenceStatuses]);
  const lastCall = [...firstCalls.values()].pop();

  function reset() {
    setStep('upload'); setHeaders([]); setRows([]); setMapping({});
    setExisting(null); setAliases({}); setResult(null); setProgress([0, 0]); setPerDay(5);
  }

  function handleClose() {
    if (step === 'importing') return;
    if (result) loadContacts(currentClientId, filters);
    reset();
    onClose();
  }

  function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseCSVRaw(ev.target.result);
      if (!parsed.headers.length) { showToast('That file looks empty.', 'error'); return; }
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(autoMapBanking(parsed.headers));
      setStep('map');
    };
    reader.readAsText(file);
  }

  const columnOptions = headers
    .map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }));
  const hasName = ['name', 'firstName', 'lastName', 'company'].some(f => mapping[f] !== undefined);

  function setField(field, v) {
    setMapping(m => {
      const next = { ...m };
      if (v === '' || v == null) delete next[field];
      else next[field] = parseInt(v, 10);
      // Full name and first/last are alternatives.
      if (field === 'name' && v) { delete next.firstName; delete next.lastName; }
      if ((field === 'firstName' || field === 'lastName') && v) delete next.name;
      return next;
    });
  }

  async function toPreview() {
    setLoading(true);
    try {
      // The whole workspace, not the loaded page: see "contacts from context is ONE PAGE"
      // in src/components/CLAUDE.md.
      setExisting(await fetchDedupIndex(currentClientId));
      setStep('preview');
    } catch (e) {
      console.error('Banking import dedup index error:', e);
      showToast('Could not load existing contacts to check for duplicates — try again.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function doImport() {
    setStep('importing');
    try {
      const r = await runBankingImport(plan, {
        userId: user.id, clientId: currentClientId,
        followUp: currentClient?.autoFollowUp !== false ? resolveConfig(currentClient).followUp : null,
        onProgress: (done, total) => setProgress([done, total]),
        firstCalls,
      });
      setResult(r);
      setStep('done');
      if (!r.failures.length) showToast('Import finished', 'success');
    } catch (e) {
      // runBankingImport collects per-row failures itself; this is the unexpected case.
      console.error('Banking import failed:', e);
      showToast(`Import failed: ${e.message || e}`, 'error');
      setStep('preview');
    }
  }

  const newCompanies = plan?.companies.filter(c => !c.existingId) ?? [];
  const newPeople = plan?.people.filter(p => !p.existingId) ?? [];
  const reused = plan ? plan.companies.length + plan.people.length - newCompanies.length - newPeople.length : 0;
  const nothingToDo = plan && !newCompanies.length && !newPeople.length && !plan.links.length && !plan.notes.length;

  const title = { upload: 'Import CSV', map: 'Match Columns', preview: 'Import Preview', importing: 'Importing…', done: 'Import Finished' }[step];

  const footer =
    step === 'map' ? (
      <><button onClick={reset}>← Back</button>
        <button className="btn-primary" onClick={toPreview} disabled={!hasName || loading}>
          {loading ? 'Checking duplicates…' : 'Preview →'}
        </button></>
    ) : step === 'preview' ? (
      <><button onClick={() => setStep('map')}>← Back</button>
        <button className="btn-primary" onClick={doImport} disabled={nothingToDo}>Import</button></>
    ) : step === 'done' ? (
      <button className="btn-primary" onClick={handleClose}>Done</button>
    ) : null;

  return (
    <Modal open={open} onClose={handleClose} title={title} width="640px" footer={footer}>
      {step === 'upload' && (
        <div className="bi-upload">
          <FileText size={44} strokeWidth={1.5} className="bi-upload-icon" />
          <p>
            In Excel, open the tab you want and choose <b>File → Save a Copy → CSV UTF-8</b>.
            Each row becomes a person, their company and a note, linked together. People and
            companies already in this workspace are reused, not duplicated.
          </p>
          <p className="bi-hint">
            Cell colors don’t survive a CSV. To bring in statuses, add a <b>Status</b> column
            first; you can match its values to statuses on the next screens.
          </p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} hidden />
          <button className="btn-primary" onClick={() => fileRef.current.click()}>Choose CSV file</button>
        </div>
      )}

      {step === 'map' && (
        <div className="add-form">
          <p className="bi-hint">{rows.length} rows. Check each field points at the right column; leave a field blank to skip it.</p>
          <div className="bi-map">
            {BANKING_FIELDS.map(f => (
              <div key={f.key} className="add-field">
                <span className="add-label">{f.label}</span>
                <Select
                  value={mapping[f.key] !== undefined ? String(mapping[f.key]) : ''}
                  onChange={v => setField(f.key, v)}
                  options={[{ value: '', label: '— Skip —' }, ...columnOptions]}
                  emptyLabel="— Skip —"
                />
              </div>
            ))}
          </div>
          {!hasName && <div className="add-error">Pick a name or company column.</div>}
          {rows[0] && hasName && (
            <div className="bi-sample">
              <div className="add-section">First row</div>
              {BANKING_FIELDS.filter(f => mapping[f.key] !== undefined).map(f => (
                <div key={f.key} className="bi-sample-row">
                  <span>{f.label}</span><span>{rows[0][mapping[f.key]] || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'preview' && plan && (
        <div className="add-form">
          <div className="bi-stats">
            {[
              ['New companies', newCompanies.length],
              ['New people', newPeople.length],
              ['Links', plan.links.length],
              ['Notes', plan.notes.length],
            ].map(([label, n]) => (
              <div key={label} className="bi-stat"><b>{n}</b><span>{label}</span></div>
            ))}
          </div>
          {reused > 0 && <p className="bi-hint">{reused} already in this workspace and will be reused, not changed.</p>}

          {plan.unknownStatuses.length > 0 && (
            <div className="dupe-banner">
              <div className="dupe-title"><AlertTriangle size={14} /> Status values to match</div>
              <div className="dupe-sub">These aren’t statuses in this workspace. Pick what each one becomes.</div>
              {plan.unknownStatuses.map(u => (
                <div key={u.value} className="bi-alias">
                  <span>“{u.value}” <span className="dupe-meta">{u.count} row{u.count === 1 ? '' : 's'}</span></span>
                  <Select
                    value={aliases[u.value.toLowerCase()] || statuses[0]}
                    onChange={v => setAliases(a => ({ ...a, [u.value.toLowerCase()]: v }))}
                    options={statuses}
                    emptyLabel={null}
                  />
                </div>
              ))}
            </div>
          )}

          {plan.notesNotAdded.length > 0 && (
            <div className="dupe-banner">
              <div className="dupe-title"><AlertTriangle size={14} /> Notes that won’t be added</div>
              <div className="dupe-sub">
                These are on contacts already in this workspace. Importing doesn’t touch existing
                contacts, so a second import can’t double their notes. Add any you still need by hand.
              </div>
              {plan.notesNotAdded.slice(0, SHOWN).map(n => (
                <div key={n.row} className="dupe-item">{n.name}<span className="dupe-meta">{n.body}</span></div>
              ))}
              <More n={plan.notesNotAdded.length} />
            </div>
          )}

          {newCompanies.length + newPeople.length > 0 && (
            <div>
              <div className="add-section">Will be created</div>
              <ul className="bi-list">
                {newCompanies.slice(0, SHOWN).map(c => <li key={c.key}>{c.name}<span className="dupe-meta">company · {c.status}</span></li>)}
                {newPeople.slice(0, SHOWN).map(p => <li key={p.key}>{`${p.firstName} ${p.lastName}`.trim()}<span className="dupe-meta">{p.status}</span></li>)}
              </ul>
              <More n={Math.max(newCompanies.length, newPeople.length)} />
            </div>
          )}

          {unscheduled > 0 && (
            <div className="dupe-banner">
              <div className="dupe-title">First calls</div>
              <div className="dupe-sub">
                {unscheduled} new {unscheduled === 1 ? 'contact has' : 'contacts have'} no notes, so nothing would bring
                {unscheduled === 1 ? ' it' : ' them'} into your follow-up queue. Spread the first calls out, in sheet
                order: one person per company (the first listed), so each business gets one call.
              </div>
              <label className="bi-alias">
                <span>Calls per weekday <span className="dupe-meta">0 = don’t schedule</span></span>
                <input type="number" min="0" max="100" value={perDay} className="bi-perday"
                  onChange={e => setPerDay(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))} />
              </label>
              {lastCall && (
                <div className="dupe-meta">
                  First due {new Date([...firstCalls.values()][0] + 'T00:00:00').toLocaleDateString()}, last {new Date(lastCall + 'T00:00:00').toLocaleDateString()}.
                </div>
              )}
            </div>
          )}

          {plan.notes.length > 0 && (
            <p className="bi-hint">
              Notes are dated today with your name. The sheet’s date and method go at the start
              of each note’s text, like “10/26/26 · phone call: …”.
            </p>
          )}

          {plan.skipped.length > 0 && (
            <p className="bi-hint">Skipping {plan.skipped.length} row{plan.skipped.length === 1 ? '' : 's'} with no name or company (line {plan.skipped.slice(0, 5).map(s => s.row).join(', ')}{plan.skipped.length > 5 ? '…' : ''}).</p>
          )}
          {nothingToDo && <p className="bi-hint">Nothing new to import.</p>}
        </div>
      )}

      {step === 'importing' && (
        <div className="bi-upload">
          <p>Importing… {progress[0]} of {progress[1]}</p>
          <progress max={progress[1] || 1} value={progress[0]} className="bi-progress" />
          <p className="bi-hint">Keep this window open until it finishes.</p>
        </div>
      )}

      {step === 'done' && result && (
        <div className="add-form">
          <div className="bi-stats">
            {[
              ['Companies added', result.companiesAdded],
              ['People added', result.peopleAdded],
              ['Links', result.linksAdded],
              ['Notes', result.notesAdded],
            ].map(([label, n]) => (
              <div key={label} className="bi-stat"><b>{n}</b><span>{label}</span></div>
            ))}
          </div>
          {result.failures.length > 0 && (
            <div className="dupe-banner">
              <div className="dupe-title"><AlertTriangle size={14} /> {result.failures.length} didn’t import</div>
              {result.failures.slice(0, SHOWN).map((f, i) => (
                <div key={i} className="dupe-item">{f.what}<span className="dupe-meta">{f.error}</span></div>
              ))}
              <More n={result.failures.length} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
