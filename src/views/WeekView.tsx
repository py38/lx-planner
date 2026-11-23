import { useMemo } from 'react';
import { useData } from '../data/store';
import { useUI } from '../ui/UI';
import { Bar, Empty, CatDot } from '../ui/kit';
import { TimeGrid } from '../ui/TimeGrid';
import { CalendarHeader } from '../ui/CalendarHeader';
import { ItemRow } from '../ui/ItemRow';
import { expandRange, byStart } from '../logic/recurrence';
import { dayProgress, projectHealth } from '../logic/progress';
import { addDays, fmt, fmtShort, isoWeekNumber, today, weekDays, weekStart, fmtDuration } from '../lib/date';
import { go, href } from '../lib/router';
import { IconStats, IconFlag } from '../ui/Icons';

export function WeekView({ date }: { date: string }) {
  const state = useData();
  const ui = useUI();
  const days = weekDays(date);
  const ws = days[0], we = days[6];
  const items = useMemo(() => expandRange(state, ws, we).sort(byStart), [state, ws, we]);
  const prog = dayProgress(items);
  const plannedMin = items.filter((i) => i.kind !== 'event').reduce((s, i) => s + (i.duration ?? 0), 0);

  const deadlines = useMemo(() => {
    const out: { date: string; label: string; kind: string; onClick: () => void }[] = [];
    for (const i of Object.values(state.items)) if (!i.deleted && i.status !== 'done' && i.deadline && i.deadline >= ws && i.deadline <= we) out.push({ date: i.deadline, label: i.title, kind: 'Échéance', onClick: () => ui.openItem(i.id) });
    for (const p of Object.values(state.projects)) {
      if (p.deleted || p.status === 'done') continue;
      if (p.deadline && p.deadline >= ws && p.deadline <= we) out.push({ date: p.deadline, label: p.title, kind: p.type === 'content' ? 'Publication' : 'Fin de projet', onClick: () => go(`projets/${p.id}`) });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [state, ws, we]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeProjects = Object.values(state.projects).filter((p) => !p.deleted && (p.status === 'active' || p.status === 'blocked'))
    .map((p) => ({ p, h: projectHealth(state, p) }))
    .filter(({ p }) => items.some((i) => i.projectId === p.id) || (p.deadline && p.deadline <= addDays(we, 30)))
    .slice(0, 6);

  return (
    <div>
      <CalendarHeader
        view="semaine" date={ws} isCurrent={ws === weekStart(today())}
        title={<>{fmt(ws, 'd MMM')} – {fmt(we, 'd MMM yyyy')} <span className="faint" style={{ fontSize: 14, fontWeight: 400 }}>· sem. {isoWeekNumber(ws)}</span></>}
        onPrev={() => go(`semaine/${addDays(ws, -7)}`)} onNext={() => go(`semaine/${addDays(ws, 7)}`)}
        actions={<a className="btn small primary" href={href(`semaine/${ws}/bilan`)}><IconStats size={14} /> Bilan</a>}
      />

      <div className="row between small" style={{ marginBottom: 8, gap: 10 }}>
        <span className="muted"><b style={{ color: 'var(--ink)' }}>{prog.done}/{prog.total}</b> terminées · {prog.remaining} restantes</span>
        <span className="muted">Prévu : <b style={{ color: 'var(--ink)' }}>{fmtDuration(plannedMin)}</b></span>
      </div>
      <TimeGrid
        days={days}
        items={items}
        minColWidth={78}
        height="var(--week-grid-h)"
        onHeaderClick={(d) => go(`jour/${d}`)}
      />
      <div className="kbd-hint" style={{ marginTop: 6 }}>Touchez un jour pour l’ouvrir, une heure libre pour ajouter. Glissez un bloc vers un autre jour ou une autre heure (appui long sur iPhone).</div>

      <div className="grid-2 section">
        <div className="card">
          <div className="card-head"><h3><IconFlag size={14} /> Échéances de la semaine</h3></div>
          {deadlines.length ? deadlines.map((d, k) => (
            <div key={k} className="row" style={{ padding: '6px 0', cursor: 'pointer' }} onClick={d.onClick}>
              <span className="tag">{fmtShort(d.date)}</span><span className="grow">{d.label}</span><span className="tiny faint">{d.kind}</span>
            </div>
          )) : <Empty>Aucune échéance cette semaine.</Empty>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Projets en cours</h3><a className="btn small ghost" href={href('projets')}>Tous</a></div>
          {activeProjects.length ? activeProjects.map(({ p, h }) => (
            <div key={p.id} style={{ padding: '6px 0', cursor: 'pointer' }} onClick={() => go(`projets/${p.id}`)}>
              <div className="row between small"><span className="row"><CatDot cat={p.categoryId ? state.categories[p.categoryId] : undefined} />{p.title}</span><span className="faint">{h.done}/{h.total}</span></div>
              <Bar pct={h.pct} thin />
            </div>
          )) : <Empty>Aucun projet actif lié à cette semaine.</Empty>}
        </div>
      </div>

      {items.some((i) => i.status !== 'done' && i.kind !== 'event' && i.date! < today()) && (
        <div className="section">
          <div className="section-title">Restées en attente cette semaine</div>
          {items.filter((i) => i.status !== 'done' && i.kind !== 'event' && i.date! < today()).map((i) => <ItemRow key={i.id} item={i} showDate />)}
        </div>
      )}

    </div>
  );
}
