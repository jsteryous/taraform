import { useState, useEffect, useCallback } from 'react';
import { Handshake, Sparkles } from 'lucide-react';
import { fetchOutreachData, planOutreach, introLine, reasonLine, OUTREACH_DEFAULTS } from '../lib/outreach';
import { fetchAuthorNames } from '../lib/notes';

const SHOWN = 8;

// Two dashboard cards for Connections workspaces: introductions to ask for, and reasons
// to reach out. The rules are lib/outreach.js; this only loads and lists.
export default function OutreachCards({ clientId, userId, outreach, onViewContact }) {
  const [plan, setPlan]       = useState(null);
  const [data, setData]       = useState(null);
  const [names, setNames]     = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    if (!clientId || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const [d, n] = await Promise.all([fetchOutreachData(clientId), fetchAuthorNames(clientId).catch(() => new Map())]);
      setData(d);
      setNames(n);
      setPlan(planOutreach(d, { me: userId, ...OUTREACH_DEFAULTS, ...(outreach || {}) }));
    } catch (e) {
      console.error('outreach load error:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId, userId, outreach]);

  useEffect(() => { load(); }, [load]);

  const ctx = { me: userId, names };
  const open = id => onViewContact?.({ id });

  return (
    <>
      <OutreachCard
        icon={<Handshake size={13} />} title="Introductions to Ask For"
        blurb="People on your target list who you have a known mutual connection with."
        empty="Nothing yet. This fills in as you mark people you Know or Know well and add who they know, or link them to their companies."
        loading={loading} error={error} items={plan?.intros}
        render={p => (
          <Row key={`i${p.targetId}`} target={data.contacts.get(p.targetId)} onOpen={open}
            line={introLine(p, data.contacts, ctx)}
            via={{ id: p.helperId, name: data.contacts.get(p.helperId).name }} />
        )}
      />
      <OutreachCard
        icon={<Sparkles size={13} />} title="Reasons to Reach Out"
        blurb="Found & probable excuses to contact"
        empty="Nothing yet. Add your clubs and boards under Your groups, put contacts in groups, and mark who you've met."
        loading={loading} error={error} items={plan?.reasons}
        render={r => {
          const via = r.kind === 'group' && r.with.type === 'contact'
            ? { id: r.with.contactId, name: data.contacts.get(r.with.contactId).name } : null;
          return (
            <Row key={`r${r.targetId}`} target={data.contacts.get(r.targetId)} onOpen={open}
              line={reasonLine(r, data.contacts, ctx)} via={via} />
          );
        }}
      />
    </>
  );
}

function OutreachCard({ icon, title, blurb, empty, loading, error, items, render }) {
  const [all, setAll] = useState(false);
  const list = items || [];
  return (
    <div className="dash-card">
      <div className="dash-section-title">{icon} {title}{!loading && list.length > 0 && <span className="outreach-count">{list.length}</span>}</div>
      <div className="outreach-blurb">{blurb}</div>
      {loading && <div className="outreach-muted">Loading…</div>}
      {error && <div className="outreach-error">Failed to load: {error}</div>}
      {!loading && !error && (list.length === 0
        ? <div className="outreach-muted">{empty}</div>
        : <>
            {(all ? list : list.slice(0, SHOWN)).map(render)}
            {list.length > SHOWN && (
              <button className="outreach-more" onClick={() => setAll(a => !a)}>
                {all ? 'Show fewer' : `Show all ${list.length}`}
              </button>
            )}
          </>)}
    </div>
  );
}

function Row({ target, line, via, onOpen }) {
  return (
    <div className="outreach-row">
      <div className="outreach-row-head">
        <button className="outreach-name" onClick={() => onOpen(target.id)}>{target.name}</button>
        <span className="outreach-status">{target.kind === 'company' ? 'Company · ' : ''}{target.status}</span>
      </div>
      <div className="outreach-line">
        {line}
        {via && <> <button className="outreach-via" onClick={() => onOpen(via.id)}>Open {via.name}</button></>}
      </div>
    </div>
  );
}
