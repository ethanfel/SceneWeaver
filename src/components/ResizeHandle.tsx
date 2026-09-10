import { useRef } from 'react';

export function ResizeHandle({ label, value, min, max, change, reset, horizontal = false, reverse = false, scale = 1 }: { label: string; value: number; min: number; max: number; change: (value: number) => void; reset: () => void; horizontal?: boolean; reverse?: boolean; scale?: number }) {
  const drag = useRef<{ id: number; position: number; value: number } | null>(null);
  const apply = (next: number) => change(Math.max(min, Math.min(max, next)));
  return <div role="separator" tabIndex={0} aria-label={label} aria-orientation={horizontal ? 'horizontal' : 'vertical'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} className={`resize-handle ${horizontal ? 'horizontal' : 'vertical'}`}
    onDoubleClick={reset} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, position: horizontal ? event.clientY : event.clientX, value }; }}
    onPointerMove={event => { if (drag.current?.id !== event.pointerId) return; apply(drag.current.value + ((horizontal ? event.clientY : event.clientX) - drag.current.position) * (reverse ? -1 : 1) * scale); }}
    onPointerUp={event => { if (drag.current?.id === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => { const keys = horizontal ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight']; if (!keys.includes(event.key)) return; event.preventDefault(); apply(value + (event.key === keys[0] ? -1 : 1) * (reverse ? -1 : 1) * (event.shiftKey ? 30 : 10) * scale); }}/>;
}
