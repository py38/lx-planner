import type { ReactNode } from 'react';
import { CheckBtn, Prio } from './kit';
import { useUI } from './UI';
import { useData } from '../data/store';
import { diffDays, fmtDuration, fmtShort, fmtTime, timeToMin, minToTime, today } from '../lib/date';
import { itemUrgency, urgencyLabel } from '../logic/urgency';
import type { ViewItem } from '../data/types';
import { IconRepeat } from './Icons';

export function ItemRow({ item, showDate, actions, onPointerDown, dragging }: {
  item: ViewItem; showDate?: boolean; actions?: ReactNode; onPointerDown?: (e: React.PointerEvent) => void; dragging?: boolean;
}) {
  const state = useData();
  const ui = useUI();
  const cat = item.categoryId ? state.categories[item.categoryId] : undefined;
  const project = item.projectId ? state.projects[item.projectId] : undefined;
  const done = item.status === 'done';
  const late = !done && item.deadline && item.deadline < today();
  const u = itemUrgency(state, item);
  const ref = item.contentRef?.kind === 'publish' ? item.date : item.contentRef?.kind === 'shoot' ? item.contentRef.date : item.deadline;
  return (
    <div className={`item ${done ? 'done' : ''} ${dragging ? 'dragging' : ''} ${u ? `urg-row-${u}` : ''}`} onClick={() => ui.openItem(item.id)} onPointerDown={onPointerDown} data-item-id={item.id}>
      <span className="bar-cat" style={{ background: cat?.color ?? 'var(--surface-3)' }} />
      {item.kind !== 'event' ? <CheckBtn on={done} onClick={() => ui.toggleDone(item)} /> : <span style={{ width: 24 }} />}
      <div className="body">
        <div className="title">{item.title}</div>
        <div className="meta">
          {showDate && item.date && <span>{fmtShort(item.date)}</span>}
          {item.start && <span>{fmtTime(item.start)}{item.duration ? `–${fmtTime(minToTime(timeToMin(item.start) + item.duration))}` : ''}</span>}
          {!item.start && item.duration ? <span>{fmtDuration(item.duration)}</span> : null}
          {project ? <span>{project.title}</span> : cat && <span>{cat.name}</span>}
          {item.deadline && <span className={late ? 'tag danger' : ''}>échéance {fmtShort(item.deadline)}</span>}
          {item.seriesId && <IconRepeat size={12} />}
          {item.status === 'blocked' && <span className="tag danger">Bloqué</span>}
          {item.status === 'in_progress' && <span className="tag warn">En cours</span>}
          {done && item.actualMinutes != null && <span>réalisé : {fmtDuration(item.actualMinutes)}</span>}
        </div>
      </div>
      {u && <span className={`urg-tag ${u}`}>{urgencyLabel(u, ref ? diffDays(ref, today()) : undefined)}</span>}
      <Prio p={item.priority} />
      {actions}
    </div>
  );
}
