import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Link2, Quote, Pencil, X, Plus, Building2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fetchWaysIn, setFamiliarity, describeWaysIn, whoLabel, knowsPhrase, disconnectPeople, howTheyKnow, colleagueLine, LEVELS, WARMTH } from '../../lib/waysIn';
import { removeContactFromGroup, kindLabel } from '../../lib/groups';
import { displayName } from '../../lib/links';
import { useConfirm } from '../shared/ConfirmDialog';
import ConnectionForm from './ConnectionForm';
import GroupPicker from './GroupPicker';
import YourGroupsModal from '../modals/YourGroupsModal';
import { fetchAuthorNames } from '../../lib/notes';
import { classifyError } from '../../lib/errors';

// The contact page's third column in a workspace with `connections` on (PLAN.md,
// "Connections & Ways In"). Everything here is entered by hand for now: your own "How well
// do you know them?", connections (ConnectionForm) and groups (GroupPicker). Notes fill
// it too: the note finder (NotesTab) links names it recognises and bumps `refreshKey`.
// Colleagues (people at the same company) are derived from company links, not stored.
// A company's page uses CompanyWaysInColumn instead.
export default function WaysInColumn({ contact, refreshKey = 0 }) {
  const { user, currentClientId, loadFullContact, setCurrentContact, showToast } = useApp();
  const navigate = useNavigate();
  const me = user?.id;
  const [data, setData] = useState(null);
  const [names, setNames] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // Which inline form is open: 'connect', 'group', or { edit: connection }.
  const [form, setForm] = useState(null);
  const [confirm, ConfirmUI] = useConfirm();
  // "Your groups" (rename, other names, delete) opened from here, so a group can be fixed
  // or deleted from the page where it looks wrong, not only from the header.
  const [manageGroups, setManageGroups] = useState(false);
  const seq = useRef(0);

  async function load() {
    const n = ++seq.current;
    try {
      const w = await fetchWaysIn(contact.id);
      if (n === seq.current) { setData(w); setFailed(false); }
    } catch (e) {
      console.error('ways in failed:', e);
      if (n === seq.current) setFailed(true);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true); setData(null); setForm(null);
    load();
  }, [contact.id]); // eslint-disable-line

  // A note just linked someone: reload in place, without the loading flash.
  useEffect(() => { if (refreshKey) load(); }, [refreshKey]); // eslint-disable-line

  useEffect(() => {
    fetchAuthorNames(currentClientId).then(setNames).catch(() => setNames(new Map()));
  }, [currentClientId]);

  const ctx = { me, names };
  const mine = data?.familiarity.find(f => f.userId === me)?.level ?? null;
  const others = (data?.familiarity || []).filter(f => f.userId !== me);

  async function choose(level) {
    if (saving || level === mine) return;
    const before = data;
    // Optimistic: show the choice at once; the warmth is recomputed by the reload.
    setData(d => ({
      ...d,
      familiarity: [...d.familiarity.filter(f => f.userId !== me), ...(level ? [{ userId: me, level }] : [])],
    }));
    setSaving(true);
    try {
      await setFamiliarity(contact.id, level);
      await load();
    } catch (e) {
      setData(before);
      showToast(classifyError(e), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function formDone() {
    setForm(null);
    await load();
  }

  async function disconnect(c) {
    if (!await confirm(`Remove the connection between ${displayName(contact)} and ${c.name}? Neither contact is deleted.`)) return;
    try {
      await disconnectPeople(c.id);
      await load();
    } catch (e) {
      showToast(classifyError(e), 'error');
    }
  }

  async function leaveGroup(g) {
    if (!await confirm(`Take ${displayName(contact)} out of ${g.name}? The group itself stays.`)) return;
    try {
      await removeContactFromGroup(g.id, contact.id);
      await load();
    } catch (e) {
      showToast(classifyError(e), 'error');
    }
  }

  async function open(id) {
    navigate('/contact/' + id);
    const full = await loadFullContact(id);
    if (full) setCurrentContact(full);
  }

  const knownByLine = (list, object) => list.map(k => knowsPhrase(whoLabel(k.userId, ctx), k.level, object)).join(' · ');

  const warmIdx = WARMTH.findIndex(s => s.value === (data?.warmth || 'cold'));
  const sentence = describeWaysIn(data, ctx);

  return (
    <div className="ways-column">
      {ConfirmUI}
      {manageGroups && <YourGroupsModal open onClose={() => { setManageGroups(false); load(); }} />}
      <div className="offers-column-header"><span className="field-label">Connections &amp; Ways In</span></div>

      {loading ? (
        <div className="conn-empty">Loading…</div>
      ) : failed || !data ? (
        <div className="conn-empty">Couldn’t load connections. <button type="button" className="ways-retry" onClick={() => { setLoading(true); load(); }}>Try again</button></div>
      ) : (
        <>
          {/* 1. How warm */}
          <section className="ways-section" aria-label="How warm is this contact">
            <div className={`ways-meter warmth-${data.warmth}`} role="meter" aria-valuemin={0} aria-valuemax={3}
              aria-valuenow={warmIdx} aria-valuetext={WARMTH[warmIdx].label}>
              {WARMTH.map((s, i) => (
                <div key={s.value} className={`ways-step${i <= warmIdx ? ' on' : ''}`} />
              ))}
            </div>
            <div className="ways-warmth-label">{WARMTH[warmIdx].label}</div>
            <div className="ways-headline">{sentence.headline}</div>
            {sentence.detail && <div className="ways-detail">{sentence.detail}</div>}
          </section>

          {/* 2. How well do you know them */}
          <section className="ways-section">
            <div className="field-label">How well do you know them?</div>
            <div className="ways-levels" role="radiogroup" aria-label="How well do you know them?">
              {LEVELS.map(l => (
                <button key={l.label} type="button" role="radio" aria-checked={mine === l.value}
                  className={`ways-level${mine === l.value ? ' active' : ''}`}
                  title={l.hint || undefined} disabled={saving}
                  onClick={() => choose(l.value)}>
                  {l.label}
                </button>
              ))}
            </div>
            <div className="ways-hint">{LEVELS.find(l => l.value === mine)?.hint}</div>
            {others.length > 0 && (
              <ul className="ways-team">
                {others.map(f => (
                  <li key={f.userId}>{knowsPhrase(whoLabel(f.userId, ctx), f.level, 'them')}.</li>
                ))}
              </ul>
            )}
          </section>

          {/* 3. Who they know */}
          <section className="ways-section">
            <div className="field-label">Who they know</div>
            {data.connections.length === 0 && data.colleagues.length === 0 ? (
              <div className="conn-empty">No connections yet. Name someone in a note, or add one below.</div>
            ) : data.connections.map(c => (
              <div key={c.id} className="ways-item">
                <div className="ways-item-top">
                  <Link2 size={14} className="conn-icon" />
                  <button type="button" className="conn-name" onClick={() => open(c.contactId)}>{c.name}</button>
                  {c.unsure && <span className="ways-badge">Not confirmed</span>}
                  <span className="ways-actions">
                    <button type="button" className="note-delete-btn" title="Edit" onClick={() => setForm({ edit: c })}><Pencil size={12} /></button>
                    <button type="button" className="note-delete-btn" title="Remove connection" onClick={() => disconnect(c)}><X size={12} /></button>
                  </span>
                </div>
                {form?.edit?.id === c.id && (
                  <ConnectionForm contact={contact} connection={c} onDone={formDone} onCancel={() => setForm(null)} />
                )}
                {howTheyKnow(c) && <div className="ways-item-line">{howTheyKnow(c)}</div>}
                {c.knownBy.length > 0 && <div className="ways-item-line ways-known">{knownByLine(c.knownBy, c.name)}</div>}
                {c.noteBody && (
                  <blockquote className="ways-quote"><Quote size={12} /> {c.noteBody}</blockquote>
                )}
              </div>
            ))}
            {data.colleagues.map(c => (
              <div key={`co-${c.contactId}`} className="ways-item">
                <div className="ways-item-top">
                  <Building2 size={14} className="conn-icon" />
                  <button type="button" className="conn-name" onClick={() => open(c.contactId)}>{c.name}</button>
                </div>
                <div className="ways-item-line">{colleagueLine(c)}</div>
                {c.knownBy.length > 0 && <div className="ways-item-line ways-known">{knownByLine(c.knownBy, c.name)}</div>}
              </div>
            ))}
            {form === 'connect' ? (
              <ConnectionForm contact={contact} excludeIds={data.connections.map(c => c.contactId)}
                onDone={formDone} onCancel={() => setForm(null)} />
            ) : (
              <button type="button" className="add-field-btn" onClick={() => setForm('connect')}><Plus size={12} /> Add connection</button>
            )}
          </section>

          {/* 4. Common ground */}
          <section className="ways-section">
            <div className="field-label ways-label-row">
              Common ground
              <button type="button" className="ways-manage" onClick={() => setManageGroups(true)}>Edit or delete groups</button>
            </div>
            {data.groups.length === 0 ? (
              <div className="conn-empty">No groups yet.</div>
            ) : data.groups.map(g => (
              <div key={g.id} className="ways-item">
                <div className="ways-item-top">
                  <Users size={14} className="conn-icon" />
                  <span className="ways-group-name">{g.name}</span>
                  {g.kind !== 'other' && <span className="ways-kind">{kindLabel(g.kind)}</span>}
                  <span className="ways-actions">
                    <button type="button" className="note-delete-btn" title="Rename or delete this group" onClick={() => setManageGroups(true)}><Pencil size={12} /></button>
                    <button type="button" className="note-delete-btn" title="Take them out of this group (the group stays)" onClick={() => leaveGroup(g)}><X size={12} /></button>
                  </span>
                </div>
                {g.teammates.length > 0 && (
                  <div className="ways-item-line">
                    {g.teammates.map(id => whoLabel(id, ctx)).join(', ')} {g.teammates.length === 1 && g.teammates[0] !== me ? 'is' : 'are'} in it too.
                  </div>
                )}
                {g.knownContacts.map(k => (
                  <div key={k.contactId} className="ways-item-line ways-known">
                    <button type="button" className="conn-name" onClick={() => open(k.contactId)}>{k.name}</button>
                    {' '}is in it. {knowsPhrase(whoLabel(k.knownBy[0]?.userId, ctx), k.knownBy[0]?.level, 'them')}.
                  </div>
                ))}
              </div>
            ))}
            {form === 'group' ? (
              <GroupPicker contact={contact} inGroupIds={data.groups.map(g => g.id)}
                onDone={formDone} onCancel={() => setForm(null)} />
            ) : (
              <button type="button" className="add-field-btn" onClick={() => setForm('group')}><Plus size={12} /> Add to a group</button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
