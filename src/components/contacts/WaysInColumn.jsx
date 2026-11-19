import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Link2, Quote } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fetchWaysIn, setFamiliarity, describeWaysIn, whoLabel, knowsPhrase, LEVELS, WARMTH } from '../../lib/waysIn';
import { fetchAuthorNames } from '../../lib/notes';
import { classifyError } from '../../lib/errors';

// The contact page's third column in a workspace with `connections` on (PLAN.md,
// "Connections & Ways In"). Read-only apart from the signed-in user's own "How well do
// you know them?" — adding connections and groups comes with the next step.
export default function WaysInColumn({ contact }) {
  const { user, currentClientId, loadFullContact, setCurrentContact, showToast } = useApp();
  const navigate = useNavigate();
  const me = user?.id;
  const [data, setData] = useState(null);
  const [names, setNames] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
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
    setLoading(true); setData(null);
    load();
  }, [contact.id]); // eslint-disable-line

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

  async function open(id) {
    navigate('/contact/' + id);
    const full = await loadFullContact(id);
    if (full) setCurrentContact(full);
  }

  const knownByLine = (list, object) => list.map(k => knowsPhrase(whoLabel(k.userId, ctx), k.level, object)).join(' · ');

  if (contact.kind === 'company') {
    return (
      <div className="ways-column">
        <div className="offers-column-header"><span className="field-label">Connections &amp; Ways In</span></div>
        <div className="conn-empty">Ways in are worked out for people. Open someone at this company.</div>
      </div>
    );
  }

  const warmIdx = WARMTH.findIndex(s => s.value === (data?.warmth || 'cold'));
  const sentence = describeWaysIn(data, ctx);

  return (
    <div className="ways-column">
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
            {data.connections.length === 0 ? (
              <div className="conn-empty">No connections yet.</div>
            ) : data.connections.map(c => (
              <div key={c.id} className="ways-item">
                <div className="ways-item-top">
                  <Link2 size={14} className="conn-icon" />
                  <button type="button" className="conn-name" onClick={() => open(c.contactId)}>{c.name}</button>
                  {c.unsure && <span className="ways-badge">Not confirmed</span>}
                </div>
                {(c.description || c.referredBy) && (
                  <div className="ways-item-line">
                    {c.description}
                    {c.referredBy && <>{c.description ? ' · ' : ''}{c.referredBy === c.contactId ? `${c.name} referred them` : `They referred ${c.name}`}</>}
                  </div>
                )}
                {c.knownBy.length > 0 && <div className="ways-item-line ways-known">{knownByLine(c.knownBy, c.name)}</div>}
                {c.noteBody && (
                  <blockquote className="ways-quote"><Quote size={12} /> {c.noteBody}</blockquote>
                )}
              </div>
            ))}
          </section>

          {/* 4. Common ground */}
          <section className="ways-section">
            <div className="field-label">Common ground</div>
            {data.groups.length === 0 ? (
              <div className="conn-empty">No groups yet.</div>
            ) : data.groups.map(g => (
              <div key={g.id} className="ways-item">
                <div className="ways-item-top">
                  <Users size={14} className="conn-icon" />
                  <span className="ways-group-name">{g.name}</span>
                  {g.kind !== 'other' && <span className="ways-kind">{g.kind}</span>}
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
          </section>
        </>
      )}
    </div>
  );
}
