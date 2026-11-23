// Grille horaire façon Calendrier Apple (0h → 24h), partagée par les vues Jour et Semaine.
// Elle défile dans son propre cadre (comme sur iPhone), s'ouvre sur l'heure actuelle,
// et permet de déplacer (glisser) ou d'allonger (tirer le bas) chaque bloc.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useData } from '../data/store';
import { useUI } from './UI';
import { useDrag, pointIn } from './drag';
import { moveItem, updateItem } from '../data/actions';
import { overlaps } from '../logic/planner';
import { itemUrgency, urgencyLabel, URGENT_RED } from '../logic/urgency';
import { diffDays, fmt, fmtDuration, fmtTime, minToTime, nowMin, timeToMin, today, isSunday } from '../lib/date';
import type { DateStr, ViewItem } from '../data/types';

export const HOUR = 52;
const SNAP = 15;
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

export interface TimeGridHandle {
  /** Convertit un point de l'écran en (jour, minute) si le point est sur la grille */
  locate: (x: number, y: number, offsetMin?: number) => { date: DateStr; min: number } | null;
}

interface Props {
  days: DateStr[];
  items: ViewItem[];
  height: string;
  /** colonne minimale (px) : en vue semaine sur iPhone, la grille défile horizontalement */
  minColWidth?: number;
  showHeader?: boolean;
  onHeaderClick?: (d: DateStr) => void;
  /** aperçu d'un élément glissé depuis l'extérieur (ex : « À planifier ») */
  externalDrag?: { x: number; y: number; title: string; duration: number } | null;
  showFree?: { start: number; end: number }[];
  mealBlock?: { start: string; duration: number } | null;
  /** couleur personnalisée d'un élément (sinon : couleur de sa catégorie) */
  colorOf?: (i: ViewItem) => string | undefined;
}

type Payload = { item: ViewItem; grabOffsetMin: number };

export const TimeGrid = forwardRef<TimeGridHandle, Props>(function TimeGrid(
  { days, items, height, minColWidth = 0, showHeader = true, onHeaderClick, externalDrag, showFree, mealBlock, colorOf }, ref,
) {
  const state = useData();
  const ui = useUI();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const t = today();

  const locate = (x: number, y: number, offsetMin = 0) => {
    const cols = colsRef.current, sc = scrollRef.current;
    if (!cols || !sc || !pointIn(sc, x, y)) return null;
    const r = cols.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top) return null;
    const idx = Math.min(days.length - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * days.length)));
    const raw = ((y - r.top) / HOUR) * 60 - offsetMin;
    const min = Math.max(0, Math.min(24 * 60 - SNAP, Math.round(raw / SNAP) * SNAP));
    return { date: days[idx], min };
  };
  useImperativeHandle(ref, () => ({ locate }), [days]); // eslint-disable-line react-hooks/exhaustive-deps

  /** jour de la ligne « journée » sous le pointeur (éléments sans heure) */
  const alldayAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('[data-allday]') as HTMLElement | null)?.dataset.allday;

  const { drag, start, clickGuard } = useDrag<Payload>(async (d) => {
    const { item } = d.payload;
    const dayRow = d.mode === 'move' ? alldayAt(d.x, d.y) : undefined;
    if (dayRow) {
      // déposé dans la ligne « journée » : on change le jour, sans heure
      if (dayRow === item.date && !item.start) return;
      if (dayRow !== item.date && item.contentRef?.kind !== 'publish' && !(await ui.checkSunday(dayRow, item.categoryId))) return;
      moveItem(item.id, dayRow, null);
      ui.toast(`Déplacé au ${fmt(dayRow, 'EEEE d')}`);
      return;
    }
    if (d.mode === 'resize') {
      const end = locate(d.x, d.y);
      const startMin = timeToMin(item.start!);
      const dur = Math.max(SNAP, (end ? end.min : startMin + (item.duration ?? 60)) - startMin);
      updateItem(item.id, { duration: dur }, 'one');
      ui.toast(`Durée : ${fmtDuration(dur)}`);
      return;
    }
    const loc = locate(d.x, d.y, d.payload.grabOffsetMin);
    if (!loc) return;
    if (loc.date === item.date && minToTime(loc.min) === item.start) return;
    // une publication programmée le dimanche n'est pas du travail : pas d'avertissement « dimanche protégé »
    if (loc.date !== item.date && item.contentRef?.kind !== 'publish' && !(await ui.checkSunday(loc.date, item.categoryId))) return;
    moveItem(item.id, loc.date, minToTime(loc.min));
    ui.toast(`Déplacé · ${loc.date !== item.date ? fmt(loc.date, 'EEE d') + ' ' : ''}${fmtTime(minToTime(loc.min))}`);
  });

  // défilement automatique quand on glisse près du bord
  useEffect(() => {
    const p = drag ?? externalDrag;
    const sc = scrollRef.current;
    if (!p || !sc) return;
    const r = sc.getBoundingClientRect();
    const id = setInterval(() => {
      if (p.y < r.top + 50) sc.scrollTop -= 12;
      else if (p.y > r.bottom - 50) sc.scrollTop += 12;
    }, 30);
    return () => clearInterval(id);
  }, [drag?.y, externalDrag?.y]); // eslint-disable-line react-hooks/exhaustive-deps

  // ouverture sur l'heure utile : maintenant (aujourd'hui), sinon le premier élément, sinon 8h
  const timed = items.filter((i) => i.start);
  const firstKey = days[0];
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const first = timed.length ? Math.min(...timed.map((i) => timeToMin(i.start!))) : 8 * 60;
    const target = days.includes(t) ? Math.max(0, nowMin() - 90) : Math.max(0, Math.min(first, 8 * 60) - 30);
    sc.scrollTop = (target / 60) * HOUR;
  }, [firstKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const overlapIds = useMemo(() => overlaps(timed), [timed]);
  const layoutFor = (d: DateStr) => {
    const blocks = timed.filter((i) => i.date === d).sort((a, b) => a.start!.localeCompare(b.start!))
      .map((i) => ({ i, s: timeToMin(i.start!), e: timeToMin(i.start!) + Math.max(i.duration ?? 30, 20), col: 0, cols: 1 }));
    let cluster: typeof blocks = [];
    let end = -1;
    const flush = () => {
      const cols: number[] = [];
      for (const b of cluster) {
        let c = cols.findIndex((x) => x <= b.s);
        if (c === -1) { c = cols.length; cols.push(0); }
        cols[c] = b.e;
        b.col = c;
      }
      for (const b of cluster) b.cols = cols.length;
      cluster = [];
    };
    for (const b of blocks) {
      if (b.s >= end && cluster.length) flush();
      cluster.push(b);
      end = Math.max(end, b.e);
    }
    flush();
    return blocks;
  };

  const allDay = (d: DateStr) => items.filter((i) => i.date === d && !i.start);
  // en vue semaine, la ligne « journée » reste visible pour pouvoir y déposer un élément
  const hasAllDay = days.length > 1 || days.some((d) => allDay(d).length);
  const overDay = drag ? alldayAt(drag.x, drag.y) : undefined;
  const isWeek = days.length > 1;

  // aperçu de dépôt
  const preview = (() => {
    if (drag?.mode === 'resize') {
      const it = drag.payload.item;
      const loc = locate(drag.x, drag.y);
      const s = timeToMin(it.start!);
      const dur = Math.max(SNAP, (loc ? loc.min : s) - s);
      return { date: it.date!, top: s, dur, label: `${fmtTime(it.start!)} · ${fmtDuration(dur)}` };
    }
    const src = drag ? { x: drag.x, y: drag.y, off: drag.payload.grabOffsetMin, title: drag.payload.item.title, dur: drag.payload.item.duration ?? 60 }
      : externalDrag ? { x: externalDrag.x, y: externalDrag.y, off: 0, title: externalDrag.title, dur: externalDrag.duration } : null;
    if (!src) return null;
    const loc = locate(src.x, src.y, src.off);
    return loc ? { date: loc.date, top: loc.min, dur: src.dur, label: `${fmtTime(minToTime(loc.min))} ${src.title}` } : null;
  })();

  const onColClick = (d: DateStr) => (e: React.MouseEvent) => {
    if (clickGuard() || e.target !== e.currentTarget) return;
    const loc = locate(e.clientX, e.clientY);
    if (!loc) return;
    ui.newItem({ date: d, start: minToTime(Math.floor(loc.min / 30) * 30), duration: 60 });
  };

  const urg = (i: ViewItem) => itemUrgency(state, i);
  const color = (i: ViewItem) => (urg(i) ? URGENT_RED : undefined) ?? colorOf?.(i) ?? (i.categoryId ? state.categories[i.categoryId]?.color : undefined) ?? '#9c9188';
  const urgDays = (i: ViewItem) => {
    const ref = i.contentRef?.kind === 'publish' ? i.date : i.contentRef?.kind === 'shoot' ? i.contentRef.date : i.deadline ?? i.date;
    return ref ? diffDays(ref, t) : undefined;
  };
  const gridCols = `52px repeat(${days.length}, minmax(${minColWidth}px, 1fr))`;

  return (
    <div className="cal-frame">
      <div className="cal-scroll" ref={scrollRef} style={{ height }}>
        <div style={{ minWidth: minColWidth ? 52 + minColWidth * days.length : undefined }}>
          {(showHeader || hasAllDay) && (
            <div className="cal-sticky">
              {showHeader && (
                <div className="cal-head" style={{ gridTemplateColumns: gridCols }}>
                  <div className="cal-corner" />
                  {days.map((d) => (
                    <button key={d} className={`cal-dayhead ${isSunday(d) ? 'sun' : ''}`} onClick={() => onHeaderClick?.(d)}>
                      <span className="wd">{fmt(d, 'EEE').replace('.', '')}</span>
                      <span className={`dn ${d === t ? 'today' : ''}`}>{fmt(d, 'd')}</span>
                    </button>
                  ))}
                </div>
              )}
              {hasAllDay && (
                <div className="cal-allday" style={{ gridTemplateColumns: gridCols }}>
                  <div className="cal-corner lbl">journée</div>
                  {days.map((d) => (
                    <div key={d} className={`cal-allday-col ${drag && overDay === d ? 'over' : ''}`} data-allday={d}>
                      {allDay(d).map((i) => (
                        <button key={i.id} className={`cal-chip ${i.status === 'done' ? 'done' : ''} ${urg(i) ? `urg-${urg(i)}` : ''}`} style={{ ['--c' as string]: color(i), opacity: drag?.payload.item.id === i.id ? 0.35 : undefined }}
                          onPointerDown={(e) => start(e, { item: i, grabOffsetMin: 0 })}
                          onClick={() => { if (!clickGuard()) ui.openItem(i.id); }}>
                          {urg(i) && <span className="urg-pill">{urgencyLabel(urg(i), urgDays(i))}</span>}{i.title}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="cal-body" ref={bodyRef} style={{ gridTemplateColumns: gridCols, height: 24 * HOUR }}>
            <div className="cal-hours">
              {Array.from({ length: 24 }, (_, h) => h > 0 && <span key={h} style={{ top: h * HOUR }}>{hourLabel(h)}</span>)}
            </div>
            <div className="cal-cols" ref={colsRef} style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, minmax(${minColWidth}px, 1fr))` }}>
              {days.map((d) => (
                <div key={d} className={`cal-col ${isSunday(d) && isWeek ? 'sun' : ''}`} onClick={onColClick(d)}>
                  {mealBlock && !isWeek && (
                    <div className="cal-meal" style={{ top: (timeToMin(mealBlock.start) / 60) * HOUR, height: (mealBlock.duration / 60) * HOUR }}>Repas</div>
                  )}
                  {!isWeek && showFree?.map((f) => (
                    <div key={f.start} className="cal-free" style={{ top: (f.start / 60) * HOUR + 1, height: ((f.end - f.start) / 60) * HOUR - 2 }}>libre</div>
                  ))}
                  {d === t && <div className="cal-now" style={{ top: (nowMin() / 60) * HOUR }}><span>{fmtTime(minToTime(nowMin()))}</span></div>}
                  {layoutFor(d).map(({ i, s, e, col, cols }) => {
                    const h = Math.max(((e - s) / 60) * HOUR - 2, 20);
                    const dragged = drag?.payload.item.id === i.id && drag.mode === 'move';
                    const done = i.status === 'done';
                    return (
                      <div
                        key={i.id}
                        className={`cal-ev ${done ? 'done' : ''} ${overlapIds.has(i.id) ? 'overlap' : ''} ${isWeek ? 'compact' : ''} ${urg(i) ? `urg-${urg(i)}` : ''}`}
                        style={{ ['--c' as string]: color(i), top: (s / 60) * HOUR + 1, height: h, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, opacity: dragged ? 0.35 : undefined }}
                        onClick={(ev) => { ev.stopPropagation(); if (!clickGuard()) ui.openItem(i.id); }}
                        onPointerDown={(ev) => start(ev, { item: i, grabOffsetMin: Math.round(((ev.clientY - ev.currentTarget.getBoundingClientRect().top) / HOUR) * 60) })}
                      >
                        <div className="ev-t">{urg(i) && <span className="urg-pill">{urgencyLabel(urg(i), urgDays(i))}</span>}{i.title}</div>
                        {h > 30 && <div className="ev-s">{fmtTime(i.start!)}{i.duration && !isWeek ? ` – ${fmtTime(minToTime(s + i.duration))}` : ''}{i.travelMin && !isWeek ? ` · trajet ${i.travelMin} min` : ''}</div>}
                        {!isWeek && i.kind !== 'event' && (
                          <button className={`ev-check ${done ? 'on' : ''}`} aria-label={done ? 'Annuler la validation' : 'Valider'}
                            onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => { ev.stopPropagation(); ui.toggleDone(i); }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                          </button>
                        )}
                        <div className="ev-resize" onPointerDown={(ev) => start(ev, { item: i, grabOffsetMin: 0 }, 'resize', true)} />
                      </div>
                    );
                  })}
                  {preview && preview.date === d && (
                    <div className="cal-drop" style={{ top: (preview.top / 60) * HOUR, height: Math.max(20, (preview.dur / 60) * HOUR) }}>{preview.label}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {drag?.mode === 'move' && <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>{drag.payload.item.title}</div>}
    </div>
  );
});
