import { useMemo, useState } from 'react';
import { getStore, useData } from '../data/store';
import { ObjectiveEditor } from './ProjectsView';
import type { Objective } from '../data/types';
import { useUI } from '../ui/UI';
import { Bar, Empty, CatDot } from '../ui/kit';
import { expandRange, byStart } from '../logic/recurrence';
import { dayProgress } from '../logic/progress';
import { periodStats } from '../logic/stats';
import { addMonths, fmt, fmtMonth, fmtShort, fmtTime, monthEnd, monthGrid, monthStart, today, fmtHours, addDays } from '../lib/date';
import { go } from '../lib/router';
import { CalendarHeader } from '../ui/CalendarHeader';
import { itemUrgency, URGENT_RED } from '../logic/urgency';
import { IconPlus } from '../ui/Icons';

export function MonthView({ date }: { date: string }) {
  const state = useData();
  const ui = useUI();
  const ms = monthStart(date), me = monthEnd(date);
  const grid = monthGrid(date);
  const items = useMemo(() => expandRange(state, grid[0], grid[grid.length - 1]).sort(byStart), [state, grid[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthItems = items.filter((i) => i.date! >= ms && i.date! <= me);
  const prog = dayProgress(monthItems);
  const stats = useMemo(() => periodStats(state, ms, me), [state, ms, me]);
  const monthKey = ms.slice(0, 7);
  const [editObj, setEditObj] = useState<Partial<Objective> | null>(null);

  const objectives = Object.values(state.objectives).filter((o) => !o.deleted && o.level === 'month' && o.period === monthKey);

  // Grandes échéances à venir : projets, publications, échéances, rendez-vous importants (60 jours)
  const upcoming = useMemo(() => {
    const from = ms < today() ? today() : ms;
    const to = addDays(me, 45);
    const out: { date: string; label: string; tag: string; color?: string; go: () => void }[] = [];
    for (const p of Object.values(state.projects)) {
      if (p.deleted || p.status === 'done') continue;
      const d = p.publishDate ?? p.deadline;
      if (d && d >= from && d <= to) out.push({ date: d, label: p.title, tag: p.type === 'content' ? 'Publication' : 'Échéance projet', color: p.categoryId ? state.categories[p.categoryId]?.color : undefined, go: () => go(`projets/${p.id}`) });
    }
    for (const o of Object.values(state.objectives)) if (!o.deleted && !o.done && o.deadline && o.deadline >= from && o.deadline <= to) out.push({ date: o.deadline, label: o.title, tag: 'Objectif', go: () => go('projets') });
    for (const i of Object.values(state.items)) {
      if (i.deleted || i.status === 'done') continue;
      if (i.deadline && i.deadline >= from && i.deadline <= to && !i.projectId) out.push({ date: i.deadline, label: i.title, tag: 'Échéance', go: () => ui.openItem(i.id) });
      else if (i.priority === 'must' && i.date && i.date >= from && i.date <= to && (i.kind === 'event' || !i.projectId)) out.push({ date: i.date, label: i.title, tag: i.kind === 'event' ? 'Événement' : 'Prioritaire', go: () => ui.openItem(i.id) });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  }, [state, ms, me]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <CalendarHeader
        view="mois" date={ms} isCurrent={monthKey === today().slice(0, 7)}
        title={fmtMonth(ms)}
        onPrev={() => go(`mois/${addMonths(ms, -1)}`)} onNext={() => go(`mois/${addMonths(ms, 1)}`)}
      />

      <div className="am-grid">
        <div className="am-wd">{['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => <div key={d}>{d}</div>)}</div>
        <div className="am-days">
          {grid.map((d) => {
            const its = items.filter((i) => i.date === d);
            const color = (i: typeof its[number]) => (i.categoryId ? state.categories[i.categoryId]?.color : undefined) ?? '#9c9188';
            return (
              <div key={d} className={`am-day ${d < ms || d > me ? 'out' : ''} ${d === today() ? 'today' : ''} ${its.some((i) => itemUrgency(state, i)) ? 'has-urgent' : ''}`} onClick={() => go(`jour/${d}`)} role="button" aria-label={fmt(d, 'EEEE d MMMM')}>
                <span className="am-num">{fmt(d, 'd')}</span>
                {its.slice(0, 3).map((i) => (
                  <span key={i.id} className={`am-ev ${i.status === 'done' ? 'done' : ''} ${itemUrgency(state, i) ? `urg-${itemUrgency(state, i)}` : ''}`} style={{ ['--c' as string]: itemUrgency(state, i) ? URGENT_RED : color(i) }}
                    onClick={(e) => { e.stopPropagation(); ui.openItem(i.id); }}>
                    {i.start ? fmtTime(i.start) + ' ' : ''}{i.title}
                  </span>
                ))}
                {its.length > 3 && <span className="am-more">+{its.length - 3}</span>}
                <span className="am-dots">{its.slice(0, 4).map((i) => itemUrgency(state, i) ? <span key={i.id} className="cat-dot" style={{ width: 6, height: 6, background: URGENT_RED }} /> : <CatDot key={i.id} size={6} cat={i.categoryId ? state.categories[i.categoryId] : undefined} />)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid-3 section">
        <div className="kpi-card"><div className="l">Tâches et rendez-vous validés</div><div className="big-num">{prog.done}<span className="faint" style={{ fontSize: 16 }}> / {prog.total}</span></div><Bar pct={prog.pct} thin /></div>
        <div className="kpi-card"><div className="l">Heures pro réalisées</div><div className="big-num">{fmtHours(stats.totals.actualMin)}</div><div className="sub">sur {fmtHours(stats.totals.plannedMin)} prévues</div></div>
        <div className="kpi-card"><div className="l">Rendez-vous clientes réalisés</div><div className="big-num">{stats.appointmentsDone}</div><div className="sub">{stats.sportSessions} séances de sport</div></div>
      </div>

      <div className="grid-2 section">
        <div className="card">
          <div className="card-head">
            <h3>Objectifs du mois</h3>
            <button className="icon-btn small" aria-label="Ajouter un objectif du mois" onClick={() => setEditObj({ level: 'month', period: monthKey })}><IconPlus size={15} /></button>
          </div>
          {objectives.length ? objectives.map((o) => (
            <div key={o.id} className="row" style={{ padding: '6px 0' }}>
              <button className={`checkbox ${o.done ? 'on' : ''}`} style={{ width: 22, height: 22 }} aria-label="Objectif atteint"
                onClick={() => getStore().update('objectives', o.id, o.done ? { done: false, completedAt: undefined } : { done: true, completedAt: new Date().toISOString() })}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </button>
              <span className={o.done ? 'strike' : ''} style={{ cursor: 'pointer' }} onClick={() => setEditObj(o)}>{o.title}</span>
            </div>
          )) : <Empty>Aucun objectif pour ce mois.</Empty>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Grandes échéances à venir</h3></div>
          {upcoming.length ? upcoming.map((u, k) => (
            <div key={k} className="row" style={{ padding: '6px 0', cursor: 'pointer' }} onClick={u.go}>
              <span className="tag" style={{ minWidth: 58, justifyContent: 'center' }}>{fmtShort(u.date)}</span>
              {u.color && <span className="cat-dot" style={{ background: u.color }} />}
              <span className="grow small">{u.label}</span>
              <span className="tiny faint">{u.tag}</span>
            </div>
          )) : <Empty>Rien de prévu prochainement.</Empty>}
        </div>
      </div>
      {editObj && <ObjectiveEditor value={editObj} onClose={() => setEditObj(null)} />}
    </div>
  );
}
