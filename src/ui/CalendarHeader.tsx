// En-tête commun du calendrier : sélecteur Jour / Semaine / Mois / Année + titre + navigation (comme Calendrier Apple).
import type { ReactNode } from 'react';
import { go, href } from '../lib/router';
import { monthStart, today, weekStart } from '../lib/date';
import { IconLeft, IconRight } from './Icons';

export type CalView = 'jour' | 'semaine' | 'mois' | 'annee';

export function CalendarHeader({ view, date, title, onPrev, onNext, isCurrent, actions }: {
  view: CalView; date: string; title: ReactNode; onPrev: () => void; onNext: () => void; isCurrent: boolean; actions?: ReactNode;
}) {
  const t = today();
  const target = (v: CalView) =>
    v === 'jour' ? `jour/${date.slice(0, 7) === t.slice(0, 7) && view !== 'jour' ? t : date}`
      : v === 'semaine' ? `semaine/${weekStart(date)}`
      : v === 'mois' ? `mois/${monthStart(date)}`
      : `annee/${date.slice(0, 4)}`;
  const resetTo: Record<CalView, string> = { jour: `jour/${t}`, semaine: `semaine/${weekStart(t)}`, mois: `mois/${monthStart(t)}`, annee: `annee/${t.slice(0, 4)}` };
  return (
    <div className="cal-header">
      <div className="cal-switch" role="tablist">
        {([['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois'], ['annee', 'Année']] as [CalView, string][]).map(([v, l]) => (
          <a key={v} role="tab" aria-selected={v === view} className={v === view ? 'on' : ''} href={href(target(v))}>{l}</a>
        ))}
      </div>
      <div className="cal-titlebar">
        <h1 className="cal-title">{title}</h1>
        <div className="row" style={{ gap: 6 }}>
          {actions}
          <button className="icon-btn small" aria-label="Précédent" onClick={onPrev}><IconLeft size={16} /></button>
          <button className="btn small" disabled={isCurrent} onClick={() => go(resetTo[view])}>Aujourd’hui</button>
          <button className="icon-btn small" aria-label="Suivant" onClick={onNext}><IconRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}
