import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Link2, User } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fetchCompanyWaysIn, describeCompanyWaysIn, whoLabel, knowsPhrase, WARMTH } from '../../lib/waysIn';
import { kindLabel } from '../../lib/groups';
import { fetchAuthorNames } from '../../lib/notes';

// Connections & Ways In on a company's page. A company is known through its people, so
// this is a read of theirs (lib/waysIn.js, companyWaysIn): the warmest person sets the
// meter, then who's here and who knows them, connections outside the company, and the
// groups its people are in. Read-only — familiarity, connections and groups are set on
// each person's page, one click away. `refreshKey` reloads after a link changes.
export default function CompanyWaysInColumn({ contact, refreshKey = 0 }) {
  const { user, currentClientId, loadFullContact, setCurrentContact } = useApp();
  const navigate = useNavigate();
  const me = user?.id;
  const [data, setData] = useState(null);
  const [names, setNames] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  async function load() {
    const n = ++seq.current;
    try {
      const cw = await fetchCompanyWaysIn(contact, me);
      if (n === seq.current) { setData(cw); setFailed(false); }
    } catch (e) {
      console.error('company ways in failed:', e);
      if (n === seq.current) setFailed(true);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }

  useEffect(() => { setLoading(true); setData(null); load(); }, [contact.id]); // eslint-disable-line
  useEffect(() => { if (refreshKey) load(); }, [refreshKey]); // eslint-disable-line
  useEffect(() => {
    fetchAuthorNames(currentClientId).then(setNames).catch(() => setNames(new Map()));
  }, [currentClientId]);

  async function open(id) {
    navigate('/contact/' + id);
    const full = await loadFullContact(id);
    if (full) setCurrentContact(full);
  }

  const ctx = { me, names };
  const knownByLine = (list, object) => list.map(k => knowsPhrase(whoLabel(k.userId, ctx), k.level, object)).filter(Boolean).join(' · ');

  if (loading) return <Shell><div className="conn-empty">Loading…</div></Shell>;
  if (failed || !data) {
    return (
      <Shell>
        <div className="conn-empty">Couldn’t load connections. <button type="button" className="ways-retry" onClick={() => { setLoading(true); load(); }}>Try again</button></div>
      </Shell>
    );
  }

  const warmIdx = WARMTH.findIndex(s => s.value === data.warmth);
  const sentence = describeCompanyWaysIn(data, ctx);

  return (
    <Shell>
      <section className="ways-section" aria-label="How warm is this company">
        <div className={`ways-meter warmth-${data.warmth}`} role="meter" aria-valuemin={0} aria-valuemax={3}
          aria-valuenow={warmIdx} aria-valuetext={WARMTH[warmIdx].label}>
          {WARMTH.map((s, i) => <div key={s.value} className={`ways-step${i <= warmIdx ? ' on' : ''}`} />)}
        </div>
        <div className="ways-warmth-label">{WARMTH[warmIdx].label}</div>
        <div className="ways-headline">{sentence.headline}</div>
        {sentence.detail && <div className="ways-detail">{sentence.detail}</div>}
      </section>

      {data.people.length > 0 && (
        <section className="ways-section">
          <div className="field-label">Who you know here</div>
          {data.people.map(p => (
            <div key={p.id} className="ways-item">
              <div className="ways-item-top">
                <User size={14} className="conn-icon" />
                <button type="button" className="conn-name" onClick={() => open(p.id)}>{p.name}</button>
                <span className={`ways-kind warmth-text-${p.warmth}`}>{WARMTH.find(s => s.value === p.warmth)?.label}</span>
              </div>
              {p.title && <div className="ways-item-line">{p.title}</div>}
              <div className="ways-item-line ways-known">
                {p.familiarity.length ? knownByLine(p.familiarity, 'them') + '.' : 'Nobody on the team has met them.'}
              </div>
            </div>
          ))}
        </section>
      )}

      {data.outside.length > 0 && (
        <section className="ways-section">
          <div className="field-label">Who they know</div>
          {data.outside.map(c => (
            <div key={`${c.id}:${c.via.id}`} className="ways-item">
              <div className="ways-item-top">
                <Link2 size={14} className="conn-icon" />
                <button type="button" className="conn-name" onClick={() => open(c.contactId)}>{c.name}</button>
              </div>
              <div className="ways-item-line">Knows {c.via.name}{c.description ? ` · ${c.description.replace(/[.\s]+$/, '')}` : ''}</div>
              {c.knownBy.length > 0 && <div className="ways-item-line ways-known">{knownByLine(c.knownBy, c.name)}</div>}
            </div>
          ))}
        </section>
      )}

      {data.groups.length > 0 && (
        <section className="ways-section">
          <div className="field-label">Common ground</div>
          {data.groups.map(g => (
            <div key={g.id} className="ways-item">
              <div className="ways-item-top">
                <Users size={14} className="conn-icon" />
                <span className="ways-group-name">{g.name}</span>
                {g.kind !== 'other' && <span className="ways-kind">{kindLabel(g.kind)}</span>}
              </div>
              <div className="ways-item-line">{g.people.map(p => p.name).join(', ')}</div>
              {g.teammates.length > 0 && (
                <div className="ways-item-line">
                  {g.teammates.map(id => whoLabel(id, ctx)).join(', ')} {g.teammates.length === 1 && g.teammates[0] !== me ? 'is' : 'are'} in it too.
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {data.people.length > 0 && (
        <div className="conn-empty">Set how well you know someone, or add their connections, on their own page.</div>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="ways-column">
      <div className="offers-column-header"><span className="field-label">Connections &amp; Ways In</span></div>
      {children}
    </div>
  );
}
