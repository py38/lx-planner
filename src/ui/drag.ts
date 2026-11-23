// Glisser-déposer universel (souris + tactile).
// Souris : le glissement démarre après quelques pixels. Tactile : appui long (~350 ms) pour ne pas gêner le défilement.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DragState<T> {
  payload: T;
  x: number;
  y: number;
  startX: number;
  startY: number;
  mode: string;
}

export function useDrag<T>(onDrop: (d: DragState<T>) => void) {
  const [drag, setDrag] = useState<DragState<T> | null>(null);
  const dragRef = useRef<DragState<T> | null>(null);
  const pending = useRef<{ timer?: number; x: number; y: number; payload: T; mode: string; pointerType: string; cleanup: () => void } | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const set = (d: DragState<T> | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => set({ ...dragRef.current!, x: e.clientX, y: e.clientY });
    const up = (e: PointerEvent) => {
      const d = { ...dragRef.current!, x: e.clientX, y: e.clientY };
      set(null);
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 50);
      dropRef.current(d);
    };
    const cancel = () => set(null);
    const noScroll = (e: TouchEvent) => e.preventDefault();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    document.addEventListener('touchmove', noScroll, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', noScroll);
    };
  }, [!!drag]); // eslint-disable-line react-hooks/exhaustive-deps

  /** À brancher sur onPointerDown de l'élément déplaçable. `immediate` = poignée (démarre sans appui long). */
  const start = useCallback((e: React.PointerEvent, payload: T, mode = 'move', immediate = false) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const x0 = e.clientX, y0 = e.clientY;
    const begin = (x: number, y: number) => {
      pending.current?.cleanup();
      pending.current = null;
      if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* ignore */ }
      set({ payload, x, y, startX: x0, startY: y0, mode });
    };
    if (immediate) {
      e.stopPropagation();
      e.preventDefault();
      begin(x0, y0);
      return;
    }
    const touch = e.pointerType !== 'mouse';
    const onMove = (ev: PointerEvent) => {
      const dist = Math.hypot(ev.clientX - x0, ev.clientY - y0);
      if (touch) {
        if (dist > 8) cleanup(); // l'utilisateur fait défiler
      } else if (dist > 5) begin(ev.clientX, ev.clientY);
    };
    const cleanup = () => {
      if (pending.current?.timer) clearTimeout(pending.current.timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      pending.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    pending.current = { x: x0, y: y0, payload, mode, pointerType: e.pointerType, cleanup };
    if (touch) pending.current.timer = window.setTimeout(() => begin(x0, y0), 350);
  }, []);

  /** À appeler en tête des onClick pour ignorer le clic qui suit un dépôt. */
  const clickGuard = () => suppressClick.current;

  return { drag, start, clickGuard };
}

export const pointIn = (el: Element | null | undefined, x: number, y: number) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};
