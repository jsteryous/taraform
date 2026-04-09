import { useState, useRef, useEffect, useCallback } from 'react';

// Approximate vertical space consumed by nav + filter bar + bulk-action row.
// Passed as viewportOffset prop so callers can override if the layout changes.
const DEFAULT_OFFSET = 320;
const BUFFER = 8;

export default function VirtualList({ items, renderItem, rowHeight = 57, viewportOffset = DEFAULT_OFFSET }) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(window.innerHeight - viewportOffset);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      setHeight(window.innerHeight - viewportOffset);
    });
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [viewportOffset]);

  const onScroll = useCallback(e => setScrollTop(e.currentTarget.scrollTop), []);

  const totalHeight  = items.length * rowHeight;
  const startIdx     = Math.max(0, Math.floor(scrollTop / rowHeight) - BUFFER);
  const visibleCount = Math.ceil(height / rowHeight) + BUFFER * 2;
  const endIdx       = Math.min(items.length, startIdx + visibleCount);
  const visibleItems = items.slice(startIdx, endIdx);
  const offsetY      = startIdx * rowHeight;

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{ height, overflowY: 'auto', overflowX: 'hidden' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetY, width: '100%' }}>
          {visibleItems.map((item, i) => renderItem(item, startIdx + i))}
        </div>
      </div>
    </div>
  );
}
