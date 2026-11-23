import { useMemo } from 'react';
import { useData } from '../data/store';
import { Bar, Empty, CatDot } from '../ui/kit';
import { expandRange } from '../logic/recurrence';
import { projectHealth } from '../logic/progress';
import { periodStats } from '../logic/stats';
import { fmt, fmtHours, today, diffDays } from '../lib/date';
import { go } from '../lib/router';
import { CalendarHeader } from '../ui/CalendarHeader';

export function YearView({ year }: { year: number }) {
  const state = useData();
  const ys = `${year}-01-01`, ye = `${year}-12-31`;
  const items = useMemo(() => expandRange(state, ys, ye), [state, ys, ye]);
  const stats = useMemo(() => periodStats(state, ys, ye), [state, ys, ye]);

  // Dates clés : échéances, lancements, publications, événements prioritaires
  const keyDates = useMemo(() => {
    const out: { date: string; label: string; tag: string; color?: string; onClick?: () => void }[] = [];
    for (const p of Object.values(state.projects)) {
      if (p.deleted) continue;
      const d = p.publishDate ?? p.deadline;
      if (d && d >= ys && d <= ye) out.push({ date: d, label: p.title, tag: p.type === 'content' ? 'Publication' : 'Projet', color: p.categoryId ? state.categories[p.categoryId]?.color : undefined, onClick: () => go(`projets/${p.id}`) });
    }
    for (const o of Object.values(state.objectives)) if (!o.deleted && o.deadline && o.deadline >= ys && o.deadline <= ye) out.push({ date: o.deadline, label: o.title, tag: 'Objectif', color: o.categoryId ? state.categories[o.categoryId]?.color : undefined, onClick: () => go('projets') });
    for (const i of items) if (i.priority === 'must' && !i.projectId && !i.seriesId) out.push({ date: i.date!, label: i.title, tag: i.kind === 'event' ? 'Événement' : i.kind === 'appointment' ? 'Rendez-vous' : 'Prioritaire', color: i.categoryId ? state.categories[i.categoryId]?.color : undefined, onClick: () => go(`jour/${i.date}`) });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [state, items, ys, ye]);
  const keySet = new Set(keyDates.map((k) => k.date));
  const busy = new Map<string, number>();
  for (const i of items) busy.set(i.date!, (busy.get(i.date!) ?? 0) + 1);

  const yearObjectives = Object.values(state.objectives).filter((o) => !o.deleted && (o.level === 'year' ? o.period === String(year) : o.deadline?.startsWith(String(year))));
  const objDone = yearObjectives.filter((o) => o.done).length;
  const projects = Object.values(state.projects).filter((p) => !p.deleted && ((p.deadline ?? p.publishDate ?? '').startsWith(String(year)) || (p.status !== 'done' && !p.deadline)));

  // progression annuelle : part de l'année écoulée
  const elapsed = year < +today().slice(0, 4) ? 100 : year > +today().slice(0, 4) ? 0 : Math.round((diffDays(today(), ys) / 365) * 100);

  return (
    <div>
      <CalendarHeader
        view="annee" date={`${year}-01-01`} isCurrent={year === +today().slice(0, 4)}
        title={String(year)}
        onPrev={() => go(`annee/${year - 1}`)} onNext={() => go(`annee/${year + 1}`)}
      />

      <div className="ay-grid" style={{ marginBottom: 18 }}>
        {Array.from({ length: 12 }, (_, m) => {
          const first = `${year}-${String(m + 1).padStart(2, '0')}-01`;
          const mm = first.slice(0, 7);
          const lead = (new Date(year, m, 1).getDay() + 6) % 7;
          const n = new Date(year, m + 1, 0).getDate();
          return (
            <div key={m} className={`ay-month ${today().slice(0, 7) === mm ? 'cur' : ''}`} onClick={() => go(`mois/${first}`)} role="button">
              <div className="ay-name">{fmt(first, 'MMMM')}</div>
              <div className="ay-cells">
                {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((w, i) => <span key={'w' + i} className="w">{w}</span>)}
                {Array.from({ length: lead }, (_, i) => <span key={'e' + i} />)}
                {Array.from({ length: n }, (_, i) => {
                  const d = `${mm}-${String(i + 1).padStart(2, '0')}`;
                  return <span key={d} className={`d ${d === today() ? 'today' : keySet.has(d) ? 'key' : busy.get(d) ? 'has' : ''}`}>{i + 1}</span>;
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid-3" style={{ marginBottom: 14 }}>
        <div className="kpi-card"><div className="l">Objectifs atteints</div><div className="big-num">{objDone}<span className="faint" style={{ fontSize: 16 }}> / {yearObjectives.length}</span></div><Bar pct={yearObjectives.length ? (objDone / yearObjectives.length) * 100 : 0} thin /></div>
        <div className="kpi-card"><div className="l">Heures pro réalisées</div><div className="big-num">{fmtHours(stats.totals.actualMin)}</div><div className="sub">{stats.projects.done} projet(s) terminé(s) · {stats.appointmentsDone} RDV clientes</div></div>
        <div className="kpi-card"><div className="l">Année écoulée</div><div className="big-num">{elapsed} %</div><Bar pct={elapsed} thin color="var(--warm)" /></div>
      </div>

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card-head"><h3>Grands objectifs</h3><button className="btn small ghost" onClick={() => go('projets')}>Gérer</button></div>
          {yearObjectives.length ? yearObjectives.map((o) => {
            const linked = Object.values(state.projects).filter((p) => !p.deleted && p.objectiveId === o.id);
            const h = linked.map((p) => projectHealth(state, p));
            const tot = h.reduce((s, x) => s + x.total, 0), dn = h.reduce((s, x) => s + x.done, 0);
            return (
              <div key={o.id} style={{ padding: '8px 0' }}>
                <div className="row between small"><span className="row"><CatDot cat={o.categoryId ? state.categories[o.categoryId] : undefined} /><b className={o.done ? 'strike' : ''}>{o.title}</b></span>{o.deadline && <span className="faint">{fmt(o.deadline, 'd MMM')}</span>}</div>
                {tot > 0 && <><Bar pct={(dn / tot) * 100} thin /><div className="tiny faint">{dn}/{tot} étapes · {linked.length} projet(s)</div></>}
              </div>
            );
          }) : <Empty>Aucun objectif annuel.</Empty>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Projets importants</h3></div>
          {projects.length ? projects.slice(0, 8).map((p) => {
            const h = projectHealth(state, p);
            return (
              <div key={p.id} style={{ padding: '6px 0', cursor: 'pointer' }} onClick={() => go(`projets/${p.id}`)}>
                <div className="row between small"><span className="row"><CatDot cat={p.categoryId ? state.categories[p.categoryId] : undefined} />{p.title}</span><span className="faint">{h.pct} %</span></div>
                <Bar pct={h.pct} thin />
              </div>
            );
          }) : <Empty>Aucun projet.</Empty>}
        </div>
      </div>

      <div className="card section">
        <div className="card-head"><h3>Dates clés {year}</h3></div>
        <div className="timeline-list">
          {keyDates.length ? keyDates.map((k, i) => (
            <div key={i} className="tli" style={{ cursor: k.onClick ? 'pointer' : undefined }} onClick={k.onClick}>
              <div className="date-box"><div className="d">{fmt(k.date, 'd')}</div><div className="m">{fmt(k.date, 'MMM')}</div></div>
              {k.color && <span className="cat-dot" style={{ background: k.color }} />}
              <div className="grow">{k.label}</div>
              <span className="tag">{k.tag}</span>
            </div>
          )) : <Empty>Ajoutez des échéances à vos projets ou une priorité « Obligatoire » à un événement pour le voir ici.</Empty>}
        </div>
      </div>
    </div>
  );
}
