import { useMemo, useRef, useState } from 'react';
import { useData, getStore } from '../data/store';
import { useUI } from '../ui/UI';
import { ItemRow } from '../ui/ItemRow';
import { PendingList } from '../ui/PendingList';
import { Bar, Ring, Sheet, Empty, CatDot } from '../ui/kit';
import { useDrag } from '../ui/drag';
import { TimeGrid, type TimeGridHandle } from '../ui/TimeGrid';
import { CalendarHeader } from '../ui/CalendarHeader';
import { expandRange, byStart } from '../logic/recurrence';
import { dayProgress, unscheduled } from '../logic/progress';
import { freeSlots, proposeDayPlan, workLoad, type PlanProposal } from '../logic/planner';
import { computeAlerts } from '../logic/alerts';
import { logsByHabit, doneOn } from '../logic/habits';
import { moveItem } from '../data/actions';
import { addDays, fmt, fmtDuration, fmtLong, fmtTime, isSunday, minToTime, today, weekDays } from '../lib/date';
import { go, href } from '../lib/router';
import { IconPlus, IconSparkle, IconInbox, IconCamera, IconBell, IconRight } from '../ui/Icons';
import type { ViewItem } from '../data/types';

export function DayView({ date }: { date: string }) {
  const state = useData();
  const ui = useUI();
  const settings = getStore().settings;
  const items = useMemo(() => expandRange(state, date, date).sort(byStart), [state, date]);
  const todo = useMemo(() => unscheduled(state), [state]);
  const progress = dayProgress(items);
  const alerts = useMemo(() => computeAlerts(state, settings), [state, settings]);
  const load = workLoad(state, date);
  const [showFree, setShowFree] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [proposal, setProposal] = useState<PlanProposal | null>(null);
  const isToday = date === today();
  const gridRef = useRef<TimeGridHandle>(null);

  // bande des 7 jours (comme l'app Calendrier de l'iPhone)
  const strip = weekDays(date);
  const stripItems = useMemo(() => expandRange(state, strip[0], strip[6]), [state, strip[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  // glisser une tâche « À planifier » sur la grille horaire
  const { drag, start } = useDrag<{ item: ViewItem }>(async (d) => {
    const loc = gridRef.current?.locate(d.x, d.y);
    if (!loc) return;
    if (!(await ui.checkSunday(loc.date, d.payload.item.categoryId))) return;
    moveItem(d.payload.item.id, loc.date, minToTime(loc.min));
    ui.toast(`Planifié à ${fmtTime(minToTime(loc.min))}`);
  });

  const openProposal = () => {
    const candidates = [...items.filter((i) => !i.start && i.kind === 'task' && i.status !== 'done'), ...todo.filter((i) => i.kind === 'task')];
    setProposal(proposeDayPlan(state, date, candidates, settings));
  };

  const habits = Object.values(state.habits).filter((h) => !h.deleted && !h.archived && h.period === 'day' && !h.optional);
  const hlogs = logsByHabit(state);
  const habitsDone = habits.filter((h) => doneOn(h, hlogs.get(h.id) ?? [], date)).length;
  const clientCat = Object.values(state.categories).find((c) => c.name === 'Rendez-vous clientes' && !c.deleted);

  return (
    <div>
      <CalendarHeader
        view="jour" date={date} isCurrent={isToday}
        title={fmt(date, 'EEEE d MMMM')}
        onPrev={() => go(`jour/${addDays(date, -1)}`)} onNext={() => go(`jour/${addDays(date, 1)}`)}
      />

      <div className="cal-strip">
        {strip.map((d) => (
          <a key={d} href={href(`jour/${d}`)} aria-label={fmtLong(d)}>
            <span className="wd">{fmt(d, 'EEEEE')}</span>
            <span className={`dn ${d === today() ? 'today' : ''} ${d === date ? 'sel' : ''}`}>{fmt(d, 'd')}</span>
            <span className={`dot ${stripItems.some((i) => i.date === d) ? '' : 'none'}`} />
          </a>
        ))}
      </div>

      {isToday && (alerts.unvalidated.length > 0 || alerts.reminders.length > 0 || alerts.overdue.length > 0) && (
        <div className="col" style={{ marginBottom: 12 }}>
          {alerts.unvalidated.length > 0 && (
            <div className="banner soft">
              <IconInbox size={18} />
              <span className="grow">{alerts.unvalidated.length} tâche{alerts.unvalidated.length > 1 ? 's' : ''} des jours précédents attend{alerts.unvalidated.length > 1 ? 'ent' : ''} votre décision.</span>
              <button className="btn small" onClick={() => setPendingOpen(true)}>Traiter</button>
            </div>
          )}
          {(alerts.reminders.length > 0 || alerts.overdue.length > 0) && (
            <a className="banner" href={href('alertes')} style={{ textDecoration: 'none' }}>
              <IconBell size={18} />
              <span className="grow">{[alerts.reminders.length && `${alerts.reminders.length} rappel${alerts.reminders.length > 1 ? 's' : ''}`, alerts.overdue.length && `${alerts.overdue.length} échéance${alerts.overdue.length > 1 ? 's' : ''} dépassée${alerts.overdue.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</span>
              <IconRight size={16} />
            </a>
          )}
        </div>
      )}

      <div className="day-layout">
        {/* ------- Planning (grille horaire Apple) ------- */}
        <div>
          <div className="row between" style={{ marginBottom: 8, gap: 8 }}>
            <div className="row small muted" style={{ gap: 8, minWidth: 0 }}>
              <span className="nowrap"><b style={{ color: 'var(--ink)' }}>{progress.done}/{progress.total}</b> terminées</span>
              <div style={{ width: 70 }}><Bar pct={progress.pct} thin /></div>
              {load > 0 && <span className="nowrap hide-mobile">· {fmtDuration(load)} de travail prévu</span>}
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button className={`chip ${showFree ? 'on' : ''}`} onClick={() => setShowFree((s) => !s)}>Créneaux libres</button>
            </div>
          </div>
          <TimeGrid
            ref={gridRef}
            days={[date]}
            items={items}
            showHeader={false}
            height="var(--day-grid-h)"
            showFree={showFree ? freeSlots(state, date, settings) : undefined}
            mealBlock={settings.mealBlock?.enabled ? settings.mealBlock : null}
            externalDrag={drag ? { x: drag.x, y: drag.y, title: drag.payload.item.title, duration: drag.payload.item.duration ?? 60 } : null}
          />
          <div className="kbd-hint" style={{ marginTop: 6 }}>
            Touchez une heure libre pour ajouter. Glissez un bloc pour le déplacer (appui long sur iPhone), tirez son bas pour changer la durée.
            {isSunday(date) && settings.sundayProtected && ' · Dimanche protégé.'}
            {load > settings.maxDailyWorkMin && ' · Attention : au-delà de votre charge maximale.'}
          </div>
        </div>

        {/* ------- À planifier & résumé ------- */}
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="stat-pill">
              <Ring pct={progress.pct} size={54} />
              <div className="grow">
                <div className="kpis">
                  <div className="k"><div className="n">{progress.total}</div><div className="l">prévues</div></div>
                  <div className="k"><div className="n">{progress.done}</div><div className="l">terminées</div></div>
                  <div className="k"><div className="n">{progress.remaining}</div><div className="l">restantes</div></div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>À planifier · {todo.length}</h3>
              <div className="row">
                <button className="btn small" onClick={openProposal} title="Proposer un placement pour la journée"><IconSparkle size={14} /> Proposer</button>
                <button className="icon-btn small" aria-label="Ajouter une tâche à planifier" onClick={() => ui.newItem({})}><IconPlus size={16} /></button>
              </div>
            </div>
            {todo.length ? todo.map((i) => (
              <ItemRow key={i.id} item={i} dragging={drag?.payload.item.id === i.id}
                onPointerDown={(e) => start(e, { item: i })}
                actions={<button className="btn small" onClick={(e) => { e.stopPropagation(); ui.plan(i); }}>Planifier</button>} />
            )) : <Empty>Aucune tâche en attente de planification.</Empty>}
            <div className="kbd-hint" style={{ marginTop: 8 }}>Glissez une tâche sur le planning pour lui donner un horaire.</div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Habitudes du jour</h3>
              <a className="btn small ghost" href={href(`habitudes/${date}`)}>{habitsDone}/{habits.length}</a>
            </div>
            <Bar pct={habits.length ? (habitsDone / habits.length) * 100 : 0} thin />
          </div>

          <div className="card">
            <div className="card-head"><h3>Raccourcis</h3></div>
            <div className="chips">
              <button className="chip" onClick={() => ui.newItem({ kind: 'appointment', date, duration: 120, categoryId: clientCat?.id, confirmed: true })}><CatDot cat={clientCat} /> RDV cliente</button>
              <a className="chip" href={href('import')}><IconCamera size={14} /> Importer une capture</a>
              <button className="chip" onClick={() => ui.newItem({ kind: 'event', date })}>Événement perso</button>
            </div>
          </div>
        </div>
      </div>

      {drag && <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>{drag.payload.item.title}</div>}

      {pendingOpen && (
        <Sheet title="Tâches à traiter" onClose={() => setPendingOpen(false)} wide>
          <p className="muted small" style={{ marginTop: 0 }}>Ces tâches avaient une date passée et n’ont pas été validées. Elles ne sont pas comptées comme réalisées. À vous de décider pour chacune.</p>
          <PendingList items={alerts.unvalidated} />
        </Sheet>
      )}
      {proposal && <ProposalSheet date={date} proposal={proposal} onClose={() => setProposal(null)} />}
    </div>
  );
}

/** Proposition de réorganisation : l'utilisatrice coche, ajuste les horaires, puis confirme — ou refuse. */
function ProposalSheet({ date, proposal, onClose }: { date: string; proposal: PlanProposal; onClose: () => void }) {
  const ui = useUI();
  const [rows, setRows] = useState(proposal.placements.map((p) => ({ ...p, on: true })));
  const apply = async () => {
    const sel = rows.filter((r) => r.on);
    if (sel.some((r) => r.item.categoryId) && !(await ui.checkSunday(date, sel.find((r) => r.item.categoryId)?.item.categoryId))) return;
    getStore().transact(() => sel.forEach((r) => moveItem(r.item.id, date, r.start)));
    ui.toast(`${sel.length} tâche${sel.length > 1 ? 's' : ''} planifiée${sel.length > 1 ? 's' : ''}`);
    onClose();
  };
  return (
    <Sheet title="Proposition de planning" onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Refuser</button>
      <button className="btn primary" disabled={!rows.some((r) => r.on)} onClick={apply}>Appliquer la sélection</button>
    </>}>
      <p className="muted small" style={{ marginTop: 0 }}>Placement suggéré pour le {fmtLong(date)} dans vos créneaux libres, par ordre de priorité. Vos rendez-vous et événements ne bougent pas. Décochez ou modifiez avant d’appliquer.</p>
      {rows.length ? rows.map((r, idx) => (
        <div key={r.item.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
          <input type="checkbox" checked={r.on} onChange={(e) => setRows((x) => x.map((y, j) => j === idx ? { ...y, on: e.target.checked } : y))} style={{ width: 18, height: 18, accentColor: 'var(--ink)' }} />
          <div className="grow">
            <div style={{ fontWeight: 500 }}>{r.item.title}</div>
            <div className="tiny faint">{fmtDuration(r.item.duration ?? 60)}</div>
          </div>
          <input className="input" type="time" step={300} style={{ width: 120 }} value={r.start} onChange={(e) => setRows((x) => x.map((y, j) => j === idx ? { ...y, start: e.target.value } : y))} />
        </div>
      )) : <Empty>Aucun créneau disponible pour placer ces tâches ce jour-là.</Empty>}
      {proposal.unplaced.length > 0 && (
        <p className="small muted">Non placées (manque de place, charge maximale ou dimanche protégé) : {proposal.unplaced.map((u) => u.title).join(', ')}.</p>
      )}
    </Sheet>
  );
}
