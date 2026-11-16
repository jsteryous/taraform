import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';

const BUFFER = 8;

// Windowed list that scrolls with the page, not inside a box of its own: one
// scrollbar for the whole screen. Only the rows near the viewport are mounted;
// the rest is a spacer of the right height. Rows must be a fixed `rowHeight`.
//
// `onEndReached` fires when the last BUFFER rows come into range, which is how
// the contact list pages in more rows as you scroll. It can fire repeatedly;
// the caller guards against overlapping loads.
export default function VirtualList({ items, renderItem, rowHeight = 57, onEndReached }) {
  const containerRef = useRef(null);
  const [view, setView] = useState({ scrolled: 0, height: window.innerHeight });

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // How far the top of the list has scrolled above the viewport.
    const scrolled = Math.max(0, -el.getBoundingClientRect().top);
    const height = window.innerHeight;
    setView(v => (v.scrolled === scrolled && v.height === height ? v : { scrolled, height }));
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  // Content above the list (bulk bar, filters) can change height without a scroll.
  useLayoutEffect(measure, [measure, items.length]);

  const totalHeight  = items.length * rowHeight;
  const startIdx     = Math.max(0, Math.floor(view.scrolled / rowHeight) - BUFFER);
  const visibleCount = Math.ceil(view.height / rowHeight) + BUFFER * 2;
  const endIdx       = Math.min(items.length, startIdx + visibleCount);
  const visibleItems = items.slice(startIdx, endIdx);
  const offsetY      = startIdx * rowHeight;

  const nearEnd = items.length > 0 && endIdx >= items.length - BUFFER;
  useEffect(() => {
    if (nearEnd && onEndReached) onEndReached();
  }, [nearEnd, items.length, onEndReached]);

  return (
    <div ref={containerRef} style={{ height: totalHeight, position: 'relative' }}>
      <div style={{ position: 'absolute', top: offsetY, width: '100%' }}>
        {visibleItems.map((item, i) => renderItem(item, startIdx + i))}
      </div>
    </div>
  );
}
