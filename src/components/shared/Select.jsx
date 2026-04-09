import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Custom select replacing native <select> for consistent cross-platform styling.
 * options: string[] | { value: string, label: string }[]
 * emptyLabel: text shown for empty/placeholder option (pass null to omit)
 */
export default function Select({ value, onChange, options, emptyLabel = '—', style }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const normalized = options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  const selected = normalized.find(o => o.value === value);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="custom-select" style={style}>
      <button
        type="button"
        className={`custom-select-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        <span>{selected?.label ?? emptyLabel}</span>
        <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
      </button>
      {open && (
        <div className="custom-select-dropdown">
          {emptyLabel !== null && (
            <div
              className={`custom-select-option${!value ? ' selected' : ''}`}
              onClick={() => { onChange(''); setOpen(false); }}
            >
              {emptyLabel}
            </div>
          )}
          {normalized.map(o => (
            <div
              key={o.value}
              className={`custom-select-option${o.value === value ? ' selected' : ''}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
