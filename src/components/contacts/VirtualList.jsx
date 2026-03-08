import { useState, useRef, useEffect, useCallback } from 'react';

const ROW_HEIGHT = 80; // px per contact card
const BUFFER = 10;     // extra rows above/below viewport

export default function VirtualList({ items, renderItem }) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(e => setScrollTop(e.currentTarget.scrollTop), []);

  const totalHeight = items.length * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const visibleCount = Math.ceil(height / ROW_HEIGHT) + BUFFER * 2;
  const endIdx = Math.min(items.length, startIdx + visibleCount);
  const visibleItems = items.slice(startIdx, endIdx);
  const offsetY = startIdx * ROW_HEIGHT;

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{ height: 'calc(100vh - 280px)', overflowY: 'auto', position: 'relative' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetY, width: '100%' }}>
          {visibleItems.map((item, i) => renderItem(item, startIdx + i))}
        </div>
      </div>
    </div>
  );
}