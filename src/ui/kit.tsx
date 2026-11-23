import { useEffect, type ReactNode } from 'react';
import { IconX, IconCheck } from './Icons';
import type { Category, Priority } from '../data/types';

// Verrou de défilement partagé : avec des fenêtres superposées, chacune restaurait l'état « bloqué »
// de la précédente et la page pouvait rester figée. On compte les fenêtres ouvertes à la place.
let scrollLocks = 0;
function lockScroll() {
  scrollLocks++;
  document.body.style.overflow = 'hidden';
  return () => {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.body.style.overflow = '';
  };
}
export function useScrollLock() {
  useEffect(() => lockScroll(), []);
}

export function Sheet({ title, onClose, children, footer, wide }: { title?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useScrollLock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true">
      <div className={`sheet ${wide ? 'wide' : ''}`}>
        <div className="sheet-head">
          <h2 style={{ fontSize: 17 }}>{title}</h2>
          <button className="icon-btn ghost" onClick={onClose} aria-label="Fermer"><IconX /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Bar = ({ pct, color, thin }: { pct: number; color?: string; thin?: boolean }) => (
  <div className={`bar ${thin ? 'thin' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
    <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
  </div>
);

export function Ring({ pct, size = 52, stroke = 5, label, color = 'var(--ink)' }: { pct: number; size?: number; stroke?: number; label?: ReactNode; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--surface-3)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .4s' }} />
      </svg>
      <span className="ring-label">{label ?? `${pct}%`}</span>
    </div>
  );
}

export const CatDot = ({ cat, size = 9 }: { cat?: Category; size?: number }) => (
  <span className="cat-dot" style={{ background: cat?.color ?? 'var(--ink-3)', width: size, height: size }} />
);

export const PRIORITY_LABEL: Record<Priority, string> = { must: 'Obligatoire', important: 'Important', optional: 'Facultatif' };
export const PRIORITY_SHORT: Record<Priority, string> = { must: 'Prioritaire', important: 'Important', optional: 'Facultatif' };
export const Prio = ({ p, showImportant }: { p: Priority; showImportant?: boolean }) =>
  p === 'important' && !showImportant ? null : <span className={`prio ${p}`}>{PRIORITY_SHORT[p]}</span>;

export const STATUS_LABEL = { todo: 'À faire', in_progress: 'En cours', done: 'Terminé', blocked: 'Bloqué', postponed: 'Reporté' } as const;
export const STATUS_TAG = { todo: '', in_progress: 'warn', done: 'ok', blocked: 'danger', postponed: '' } as const;

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} role="tab" aria-selected={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const CheckBtn = ({ on, onClick, label }: { on: boolean; onClick: (e: React.MouseEvent) => void; label?: string }) => (
  <button type="button" className={`checkbox ${on ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onClick(e); }} aria-pressed={on} aria-label={label ?? (on ? 'Annuler la validation' : 'Valider')}>
    <IconCheck size={14} />
  </button>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
