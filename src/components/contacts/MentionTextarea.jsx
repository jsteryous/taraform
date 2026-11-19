import { useState, useRef } from 'react';
import { User, Building2, Users, UserPlus } from 'lucide-react';
import { mentionMatches, nameKey } from '../../lib/noteFinder';

// A note box that understands "@": type @dre and pick Drew Parker, and the full name goes
// into the note. The note finder links it when the note saves, the same as a typed name;
// the @ only saves typing and settles "which Drew Parker?" when there are two.
//
//   index     the finder's name index (null while it loads: @ then does nothing)
//   onPicked  (nameKey, id) for a person chosen from the list
//   onCreate  (name) => Promise<{ id, name }>: "Add as a new contact", or omit to hide it
const TRIGGER = /(?:^|[\s(])@([^\s@][^@\n]{0,40})?$/;

function titleCase(s) {
  return s.replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1));
}

export default function MentionTextarea({ value, onChange, onKeyDown, index, selfId, onPicked, onCreate, ...rest }) {
  const ref = useRef(null);
  const [menu, setMenu] = useState(null); // { at, query, active }
  const [busy, setBusy] = useState(false);

  function refresh(text, caret) {
    const before = text.slice(0, caret);
    const m = index && before.match(TRIGGER);
    // Three words is plenty for a name; past that the @ was just an @.
    if (!m || (m[1] || '').trim().split(/\s+/).length > 3) { setMenu(null); return; }
    setMenu(prev => ({ at: before.lastIndexOf('@'), query: m[1] || '', active: prev?.active || 0 }));
  }

  const query = menu?.query.trim() || '';
  const matches = menu && index ? mentionMatches(index, query, { selfId }) : [];
  const canCreate = !!onCreate && query.length >= 2 && !matches.some(x => x.name.toLowerCase() === query.toLowerCase());
  const options = [...matches, ...(canCreate ? [{ kind: 'create', name: titleCase(query) }] : [])];
  const open = !!menu && options.length > 0;
  const active = open ? Math.min(menu.active, options.length - 1) : 0;

  function insert(name) {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const next = value.slice(0, menu.at) + name + ' ' + value.slice(caret);
    const pos = menu.at + name.length + 1;
    onChange(next);
    setMenu(null);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos, pos); });
  }

  async function choose(opt) {
    if (opt.kind === 'create') {
      if (busy) return;
      setBusy(true);
      try {
        const made = await onCreate(opt.name);
        if (made) { onPicked?.(nameKey(made.name), made.id); insert(made.name); }
      } finally {
        setBusy(false);
      }
      return;
    }
    if (opt.kind === 'person') onPicked?.(nameKey(opt.name), opt.id);
    insert(opt.name);
  }

  function keyDown(e) {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu(m => ({ ...m, active: (active + 1) % options.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu(m => ({ ...m, active: (active - 1 + options.length) % options.length })); return; }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); choose(options[active]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null); return; }
    }
    onKeyDown?.(e);
  }

  const icon = { person: User, company: Building2, group: Users, create: UserPlus };

  return (
    <div className="mention-wrap">
      <textarea
        ref={ref}
        value={value}
        onChange={e => { onChange(e.target.value); refresh(e.target.value, e.target.selectionStart); }}
        onKeyDown={keyDown}
        onClick={e => refresh(e.target.value, e.target.selectionStart)}
        onBlur={() => setTimeout(() => setMenu(null), 150)}
        {...rest}
      />
      {open && (
        <ul className="mention-menu" role="listbox">
          {options.map((o, i) => {
            const Icon = icon[o.kind];
            return (
              <li key={`${o.kind}-${o.id ?? o.name}`} role="option" aria-selected={i === active}
                className={`mention-option${i === active ? ' active' : ''}${o.kind === 'create' ? ' create' : ''}`}
                onMouseDown={e => { e.preventDefault(); choose(o); }}
                onMouseEnter={() => setMenu(m => ({ ...m, active: i }))}>
                <Icon size={13} />
                <span className="mention-name">{o.kind === 'create' ? `Add “${o.name}” as a new contact` : o.name}</span>
                {o.kind === 'person' && o.status && <span className="mention-meta">{o.status}</span>}
                {o.kind === 'company' && <span className="mention-meta">Company</span>}
                {o.kind === 'group' && <span className="mention-meta">Group</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
