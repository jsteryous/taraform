import { useState, useRef, useEffect, useCallback } from 'react';

const ROW_HEIGHT = 57; // matches contact-item actual height
const BUFFER = 8;

export default function VirtualList({ items, renderItem }) {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(window.innerHeight - 320);

  useEffect(() => {
    function updateHeight() {
      setHeight(window.innerHeight - 320);
    }
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
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
      style={{
        height,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: offsetY, width: '100%' }}>
          {visibleItems.map((item, i) => renderItem(item, startIdx + i))}
        </div>
      </div>
    </div>
  );
}