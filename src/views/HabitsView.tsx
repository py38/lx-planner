import { useMemo, useState } from 'react';
import { getStore, useData } from '../data/store';
import { useUI } from '../ui/UI';
import { Bar, Empty, Sheet, Seg, Ring } from '../ui/kit';
import { addHabitCount, setHabitValue, toggleChallengeDay, toggleHabit } from '../data/actions';
import { challengeStatus, completionRate, doneOn, logsByHabit, periodStatus, streak, valueOn } from '../logic/habits';
import { goalProgress } from '../logic/stats';
import { addDays, addMonths, daysBetween, fmt, fmtDay, fmtMonth, fmtShort, monthEnd, monthStart, today, weekDays, cap } from '../lib/date';
import { go } from '../lib/router';
import { IconLeft, IconRight, IconPlus, IconCheck, IconTrash } from '../ui/Icons';
import type { Challenge, Goal, GoalPeriod, GoalSource, GoalType, Habit, HabitPeriod } from '../data/types';

type Tab = 'day' | 'week' | 'month' | 'goals' | 'challenges';

export function HabitsView({ date }: { date: string }) {
  const [tab, setTab] = useState<Tab>('day');
  const [edit, setEdit] = useState<Partial<Habit> | null>(null);
  return (
    <div>
      <div className="page-head">
        <div className="title-block"><div className="eyebrow">Mes habitudes</div><h1>Suivi personnel</h1></div>
        {tab !== 'goals' && tab !== 'challenges' && <button className="btn" onClick={() => setEdit({ kind: 'check', period: 'day', target: 1, group: 'Bien-être' })}><IconPlus size={16} /> Habitude</button>}
      </div>
      <div style={{ marginBottom: 16, overflowX: 'auto' }}>
        <Seg value={tab} onChange={setTab} options={[{ value: 'day', label: 'Jour' }, { value: 'week', label: 'Semaine' }, { value: 'month', label: 'Mois & historique' }, { value: 'goals', label: 'Objectifs chiffrés' }, { value: 'challenges', label: 'Défis' }]} />
      </div>
      {tab === 'day' && <DayHabits date={date} onEdit={setEdit} />}
      {tab === 'week' && <WeekHabits date={date} />}
      {tab === 'month' && <MonthHabits date={date} onEdit={setEdit} />}
      {tab === 'goals' && <Goals />}
      {tab === 'challenges' && <Challenges />}
      {edit && <HabitEditor value={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

const useHabits = () => {
  const state = useData();
  const habits = Object.values(state.habits).filter((h) => !h.deleted && !h.archived).sort((a, b) => a.order - b.order);
  const logs = useMemo(() => logsByHabit(state), [state]);
  return { state, habits, logs };
};

function HabitControl({ h, date, logs }: { h: Habit; date: string; logs: ReturnType<typeof logsByHabit> }) {
  const ls = logs.get(h.id) ?? [];
  if (h.kind === 'quantity') {
    const v = valueOn(ls, date);
    const step = h.step ?? 1;
    return (
      <div className="stepper">
        <button className="icon-btn small" aria-label="Moins" onClick={() => setHabitValue(h.id, date, Math.max(0, Math.round((v - step) * 100) / 100))}>−</button>
        <span className="v" style={{ color: v >= h.target ? 'var(--ok)' : undefined }}>{v.toLocaleString('fr-FR')} / {h.target.toLocaleString('fr-FR')} {h.unit}</span>
        <button className="icon-btn small" aria-label="Plus" onClick={() => setHabitValue(h.id, date, Math.round((v + step) * 100) / 100)}>+</button>
      </div>
    );
  }
  const v = valueOn(ls, date);
  return (
    <div className="row" style={{ gap: 6 }}>
      {v > 1 && <span className="tag">×{v}</span>}
      {v >= 1 && h.period !== 'day' && <button className="icon-btn small ghost" aria-label="Ajouter une séance le même jour" onClick={() => addHabitCount(h.id, date, 1)}>+</button>}
      <button className={`checkbox ${v >= 1 ? 'on' : ''}`} style={{ width: 30, height: 30 }} aria-label={v >= 1 ? 'Annuler' : 'Valider'} onClick={() => toggleHabit(h.id, date)}><IconCheck size={16} /></button>
    </div>
  );
}

function DayHabits({ date, onEdit }: { date: string; onEdit: (h: Habit) => void }) {
  const { habits, logs } = useHabits();
  const groups = Array.from(new Set(habits.map((h) => h.group)));
  const daily = habits.filter((h) => h.period === 'day' && !h.optional);
  const done = daily.filter((h) => doneOn(h, logs.get(h.id) ?? [], date)).length;
  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div className="row">
          <button className="icon-btn" aria-label="Jour précédent" onClick={() => go(`habitudes/${addDays(date, -1)}`)}><IconLeft /></button>
          <b>{date === today() ? "Aujourd'hui" : fmtDay(date)}</b>
          <button className="icon-btn" aria-label="Jour suivant" disabled={date >= today()} onClick={() => go(`habitudes/${addDays(date, 1)}`)}><IconRight /></button>
        </div>
        <Ring pct={daily.length ? Math.round((done / daily.length) * 100) : 0} size={48} label={`${done}/${daily.length}`} />
      </div>
      {groups.map((g) => (
        <div key={g} className="card">
          <div className="card-head"><h3>{g}</h3></div>
          {habits.filter((h) => h.group === g).map((h) => {
            const ls = logs.get(h.id) ?? [];
            const st = periodStatus(h, ls, date);
            const s = streak(h, ls, date);
            return (
              <div key={h.id} className="habit-row">
                <div className="grow" style={{ cursor: 'pointer' }} onClick={() => onEdit(h)}>
                  <div style={{ fontWeight: 500 }}>{h.name}{h.durationMin ? <span className="faint small"> · {h.durationMin} min</span> : null}{h.optional ? <span className="faint small"> · facultatif</span> : null}</div>
                  <div className="tiny faint">
                    {h.period === 'week' && `${st.value}/${st.target} cette semaine`}
                    {h.period === 'month' && `${st.value}/${st.target} ce mois-ci`}
                    {h.period === 'interval' && <>{st.due ? <span className="tag warn">À faire</span> : `prochaine fois vers le ${fmtShort(st.nextDue!)}`} · tous les {h.intervalDays} j · {st.label}</>}
                    {h.period === 'day' && (s > 1 ? `${s} jours d’affilée` : h.kind === 'quantity' ? 'objectif quotidien' : 'chaque jour')}
                  </div>
                </div>
                <HabitControl h={h} date={date} logs={logs} />
              </div>
            );
          })}
        </div>
      ))}
      <p className="tiny faint">Une habitude n’est comptée que si vous la cochez. Une séance prévue dans le planning n’est pas comptée tant qu’elle n’est pas validée.</p>
    </>
  );
}

function WeekHabits({ date }: { date: string }) {
  const { habits, logs } = useHabits();
  const [ref, setRef] = useState(date);
  const days = weekDays(ref);
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="icon-btn" aria-label="Semaine précédente" onClick={() => setRef(addDays(ref, -7))}><IconLeft /></button>
        <b>{fmt(days[0], 'd MMM')} – {fmt(days[6], 'd MMM')}</b>
        <button className="icon-btn" aria-label="Semaine suivante" onClick={() => setRef(addDays(ref, 7))}><IconRight /></button>
      </div>
      <table className="habit-grid">
        <thead><tr><th style={{ textAlign: 'left' }}>Habitude</th>{days.map((d) => <th key={d}>{fmt(d, 'EEEEE')}<br />{fmt(d, 'd')}</th>)}<th>Total</th></tr></thead>
        <tbody>
          {habits.map((h) => {
            const ls = logs.get(h.id) ?? [];
            const total = days.reduce((s, d) => s + valueOn(ls, d), 0);
            const target = h.period === 'day' ? (h.kind === 'quantity' ? h.target * 7 : 7) : h.period === 'week' ? h.target : null;
            return (
              <tr key={h.id}>
                <td className="name">{h.name}</td>
                {days.map((d) => {
                  const v = valueOn(ls, d);
                  const on = doneOn(h, ls, d);
                  return (
                    <td key={d}>
                      <button className={`hcell ${on ? 'on' : v > 0 ? 'part' : ''}`} disabled={d > today()} aria-label={`${h.name} ${d}`}
                        onClick={() => h.kind === 'quantity' ? setHabitValue(h.id, d, on ? 0 : h.target) : toggleHabit(h.id, d)}>
                        {h.kind === 'quantity' && v > 0 ? v.toLocaleString('fr-FR') : on ? '✓' : ''}
                      </button>
                    </td>
                  );
                })}
                <td className="small nowrap">{h.kind === 'quantity' ? `${Math.round(total * 10) / 10} ${h.unit}` : total}{target != null && !h.optional ? <span className="faint"> / {h.kind === 'quantity' ? Math.round(target * 10) / 10 : target}</span> : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonthHabits({ date, onEdit }: { date: string; onEdit: (h: Habit) => void }) {
  const { habits, logs } = useHabits();
  const [ref, setRef] = useState(monthStart(date));
  const ms = monthStart(ref), me = monthEnd(ref);
  const prevS = addMonths(ms, -1), prevE = monthEnd(prevS);
  const days = daysBetween(ms, me);
  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <button className="icon-btn" aria-label="Mois précédent" onClick={() => setRef(addMonths(ms, -1))}><IconLeft /></button>
        <b>{fmtMonth(ms)}</b>
        <button className="icon-btn" aria-label="Mois suivant" onClick={() => setRef(addMonths(ms, 1))}><IconRight /></button>
      </div>
      <div className="card">
        {habits.map((h) => {
          const ls = logs.get(h.id) ?? [];
          const r = completionRate(h, ls, ms, me);
          const prev = completionRate(h, ls, prevS, prevE);
          return (
            <div key={h.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="row between small" style={{ cursor: 'pointer' }} onClick={() => onEdit(h)}>
                <b>{h.name}</b>
                <span>{r ? <>{r.pct} %{prev && <span className={prev.pct > r.pct ? 'delta-down' : 'delta-up'} style={{ marginLeft: 6 }}>{r.pct - prev.pct >= 0 ? '+' : ''}{r.pct - prev.pct} pts</span>}</> : <span className="faint">{h.optional ? 'facultatif' : '—'}</span>}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: 2, marginTop: 6 }}>
                {days.map((d) => <span key={d} title={d} style={{ height: 10, borderRadius: 3, background: doneOn(h, ls, d) ? 'var(--ink)' : valueOn(ls, d) > 0 ? 'var(--surface-3)' : d > today() ? 'transparent' : 'var(--surface-2)' }} />)}
              </div>
              {r && <div className="tiny faint" style={{ marginTop: 4 }}>{h.period === 'day' ? `${r.done} jour(s) sur ${r.expected}` : `${r.done} sur ${r.expected} attendus`}</div>}
            </div>
          );
        })}
      </div>
      <p className="tiny faint">Les pourcentages sont calculés uniquement à partir de vos validations, sur les jours écoulés depuis la création de chaque habitude.</p>
    </>
  );
}

function HabitEditor({ value, onClose }: { value: Partial<Habit>; onClose: () => void }) {
  const ui = useUI();
  const state = useData();
  const [h, setH] = useState<Partial<Habit>>(value);
  const groups = Array.from(new Set(Object.values(state.habits).filter((x) => !x.deleted).map((x) => x.group)));
  const save = () => {
    if (!h.name?.trim()) return;
    const order = Object.keys(state.habits).length;
    if (h.id) getStore().update('habits', h.id, h);
    else getStore().create('habits', { kind: 'check', period: 'day', target: 1, group: 'Autres', order, ...h, name: h.name.trim() } as Habit);
    onClose();
  };
  return (
    <Sheet title={h.id ? 'Modifier l’habitude' : 'Nouvelle habitude'} onClose={onClose} footer={<>
      {h.id && <button className="btn ghost danger" style={{ marginRight: 'auto' }} onClick={async () => {
        if (await ui.confirm('Supprimer cette habitude ? Son historique sera conservé dans les bilans passés si vous choisissez plutôt « Archiver ».', { ok: 'Archiver', cancel: 'Annuler' })) { getStore().update('habits', h.id!, { archived: true }); onClose(); }
      }}><IconTrash size={16} /> Archiver</button>}
      <button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button>
    </>}>
      <div className="col" style={{ gap: 12 }}>
        <input className="input title-input" autoFocus placeholder="Ex : Skincare du soir" value={h.name ?? ''} onChange={(e) => setH({ ...h, name: e.target.value })} />
        <div className="form-grid">
          <div className="field full"><label>Groupe</label>
            <input className="input" list="habit-groups" value={h.group ?? ''} onChange={(e) => setH({ ...h, group: e.target.value })} />
            <datalist id="habit-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          </div>
          <div className="field"><label>Type</label>
            <select className="input" value={h.kind} onChange={(e) => setH({ ...h, kind: e.target.value as Habit['kind'] })}>
              <option value="check">Case à cocher</option><option value="quantity">Quantité (ex : litres)</option>
            </select>
          </div>
          <div className="field"><label>Fréquence</label>
            <select className="input" value={h.period} onChange={(e) => setH({ ...h, period: e.target.value as HabitPeriod })}>
              <option value="day">Chaque jour</option><option value="week">X fois par semaine</option><option value="month">X fois par mois</option><option value="interval">Tous les X jours</option>
            </select>
          </div>
          {h.period === 'interval' ? (
            <div className="field"><label>Tous les … jours</label><input className="input" type="number" min={1} value={h.intervalDays ?? 3} onChange={(e) => setH({ ...h, intervalDays: +e.target.value })} /></div>
          ) : (
            <div className="field"><label>{h.kind === 'quantity' ? 'Objectif par jour' : h.period === 'day' ? 'Fois par jour' : 'Nombre de fois'}</label><input className="input" type="number" min={0} step={h.kind === 'quantity' ? 0.1 : 1} value={h.target ?? 1} onChange={(e) => setH({ ...h, target: +e.target.value })} /></div>
          )}
          {h.kind === 'quantity' && <>
            <div className="field"><label>Unité</label><input className="input" value={h.unit ?? ''} onChange={(e) => setH({ ...h, unit: e.target.value })} /></div>
            <div className="field"><label>Pas (+/−)</label><input className="input" type="number" min={0.05} step={0.05} value={h.step ?? 1} onChange={(e) => setH({ ...h, step: +e.target.value })} /></div>
          </>}
          <div className="field"><label>Durée indicative (min)</label><input className="input" type="number" min={0} value={h.durationMin ?? ''} onChange={(e) => setH({ ...h, durationMin: e.target.value ? +e.target.value : undefined })} /></div>
        </div>
        <label className="check"><input type="checkbox" checked={!!h.isSport} onChange={(e) => setH({ ...h, isSport: e.target.checked })} /> Séance de sport (comptée dans les bilans sport)</label>
        <label className="check"><input type="checkbox" checked={!!h.optional} onChange={(e) => setH({ ...h, optional: e.target.checked })} /> Facultative (suivie sans objectif, ex : collation)</label>
      </div>
    </Sheet>
  );
}

// ---------------- Objectifs chiffrés ----------------
const PERIOD_LABEL: Record<GoalPeriod, string> = { day: 'par jour', week: 'par semaine', month: 'par mois', year: 'par an', once: 'au total' };

function Goals() {
  const state = useData();
  const [edit, setEdit] = useState<Partial<Goal> | null>(null);
  const [logFor, setLogFor] = useState<Goal | null>(null);
  const goals = Object.values(state.goals).filter((g) => !g.deleted && !g.archived);
  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <p className="small muted" style={{ margin: 0 }}>Progression calculée automatiquement à partir de vos validations réelles.</p>
        <button className="btn primary" onClick={() => setEdit({ period: 'week', type: 'number', source: 'manual', target: 1, unit: '', startDate: today() })}><IconPlus size={16} /> Objectif</button>
      </div>
      {goals.length ? <div className="grid-2">{goals.map((g) => {
        const p = goalProgress(state, g);
        return (
          <div key={g.id} className="card" style={{ marginTop: 0 }}>
            <div className="row between">
              <b style={{ cursor: 'pointer' }} onClick={() => setEdit(g)}>{g.title}</b>
              <span className="tag">{PERIOD_LABEL[g.period]}</span>
            </div>
            <div className="row" style={{ margin: '10px 0 6px', alignItems: 'baseline' }}>
              <span className="big-num">{p.value.toLocaleString('fr-FR')}</span><span className="muted">/ {g.target.toLocaleString('fr-FR')} {g.unit}</span>
              <span className="grow" /><b>{p.pct} %</b>
            </div>
            <Bar pct={p.pct} />
            <div className="row between" style={{ marginTop: 8 }}>
              <span className="tiny faint">{g.period === 'once' ? `depuis le ${fmtShort(g.startDate)}` : `${fmtShort(p.start)} → ${fmtShort(p.end)}`}{!p.active ? ' · inactif' : ''}</span>
              {g.source === 'manual' && <button className="btn small" onClick={() => setLogFor(g)}>+ Ajouter</button>}
              {g.source !== 'manual' && <span className="tiny faint">{{ habit: 'via habitude', sportSessions: 'via séances de sport', categoryHours: 'via heures validées', categoryCount: 'via tâches validées', projectsDone: 'via projets terminés', manual: '' }[g.source]}</span>}
            </div>
          </div>
        );
      })}</div> : <Empty>Aucun objectif chiffré.</Empty>}
      {edit && <GoalEditor value={edit} onClose={() => setEdit(null)} />}
      {logFor && <GoalLogSheet goal={logFor} onClose={() => setLogFor(null)} />}
    </>
  );
}

function GoalLogSheet({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const [v, setV] = useState(1);
  const [d, setD] = useState(today());
  return (
    <Sheet title={goal.title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={() => { getStore().create('goalLogs', { goalId: goal.id, date: d, value: v } as any); onClose(); }}>Enregistrer</button></>}>
      <div className="form-grid">
        <div className="field"><label>Valeur réalisée ({goal.unit})</label><input className="input" type="number" step="any" value={v} onChange={(e) => setV(+e.target.value)} /></div>
        <div className="field"><label>Date</label><input className="input" type="date" value={d} onChange={(e) => setD(e.target.value)} /></div>
      </div>
    </Sheet>
  );
}

function GoalEditor({ value, onClose }: { value: Partial<Goal>; onClose: () => void }) {
  const state = useData();
  const ui = useUI();
  const [g, setG] = useState<Partial<Goal>>(value);
  const habits = Object.values(state.habits).filter((h) => !h.deleted && !h.archived);
  const cats = Object.values(state.categories).filter((c) => !c.deleted);
  const save = () => {
    if (!g.title?.trim() || !g.target) return;
    if (g.id) getStore().update('goals', g.id, g);
    else getStore().create('goals', { ...g, title: g.title.trim() } as Goal);
    onClose();
  };
  return (
    <Sheet title={g.id ? 'Objectif chiffré' : 'Nouvel objectif chiffré'} onClose={onClose} footer={<>
      {g.id && <button className="btn ghost danger" style={{ marginRight: 'auto' }} onClick={async () => { if (await ui.confirm('Supprimer cet objectif ?', { ok: 'Supprimer', danger: true })) { getStore().remove('goals', g.id!); onClose(); } }}><IconTrash size={16} /></button>}
      <button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" onClick={save}>Enregistrer</button>
    </>}>
      <div className="col" style={{ gap: 12 }}>
        <input className="input title-input" autoFocus placeholder="Ex : Publier des Reels" value={g.title ?? ''} onChange={(e) => setG({ ...g, title: e.target.value })} />
        <div className="form-grid">
          <div className="field"><label>Valeur cible</label><input className="input" type="number" step="any" min={0} value={g.target ?? ''} onChange={(e) => setG({ ...g, target: +e.target.value })} /></div>
          <div className="field"><label>Unité</label><input className="input" placeholder="séances, h, L, Reels…" value={g.unit ?? ''} onChange={(e) => setG({ ...g, unit: e.target.value })} /></div>
          <div className="field"><label>Période</label>
            <select className="input" value={g.period} onChange={(e) => setG({ ...g, period: e.target.value as GoalPeriod })}>
              {(Object.keys(PERIOD_LABEL) as GoalPeriod[]).map((p) => <option key={p} value={p}>{cap(PERIOD_LABEL[p])}</option>)}
            </select>
          </div>
          <div className="field"><label>Type</label>
            <select className="input" value={g.type} onChange={(e) => setG({ ...g, type: e.target.value as GoalType })}>
              <option value="number">Nombre</option><option value="duration">Durée</option><option value="quantity">Quantité</option><option value="frequency">Fréquence</option><option value="oneoff">Réalisation ponctuelle</option>
            </select>
          </div>
          <div className="field"><label>Début</label><input className="input" type="date" value={g.startDate ?? today()} onChange={(e) => setG({ ...g, startDate: e.target.value })} /></div>
          <div className="field"><label>Fin (facultatif)</label><input className="input" type="date" value={g.endDate ?? ''} onChange={(e) => setG({ ...g, endDate: e.target.value || undefined })} /></div>
          <div className="field full"><label>Calcul de la progression</label>
            <select className="input" value={g.source} onChange={(e) => setG({ ...g, source: e.target.value as GoalSource })}>
              <option value="manual">Saisie manuelle</option>
              <option value="habit">À partir d’une habitude</option>
              <option value="sportSessions">Séances de sport validées</option>
              <option value="categoryHours">Heures validées dans une catégorie</option>
              <option value="categoryCount">Tâches validées dans une catégorie</option>
              <option value="projectsDone">Projets terminés</option>
            </select>
          </div>
          {g.source === 'habit' && <div className="field full"><label>Habitude</label>
            <select className="input" value={g.habitId ?? ''} onChange={(e) => setG({ ...g, habitId: e.target.value })}><option value="">—</option>{habits.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          </div>}
          {(g.source === 'categoryHours' || g.source === 'categoryCount') && <div className="field full"><label>Catégorie</label>
            <select className="input" value={g.categoryId ?? ''} onChange={(e) => setG({ ...g, categoryId: e.target.value })}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </div>}
        </div>
      </div>
    </Sheet>
  );
}

// ---------------- Défis ----------------
function Challenges() {
  const state = useData();
  const ui = useUI();
  const [edit, setEdit] = useState<Partial<Challenge> | null>(null);
  const list = Object.values(state.challenges).filter((c) => !c.deleted && !c.archived).sort((a, b) => b.startDate.localeCompare(a.startDate));
  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <p className="small muted" style={{ margin: 0 }}>Ex : prendre un petit-déjeuner avant 9h pendant 7 jours consécutifs.</p>
        <button className="btn primary" onClick={() => setEdit({ days: 7, startDate: today(), checks: [] })}><IconPlus size={16} /> Défi</button>
      </div>
      {list.length ? list.map((c) => {
        const s = challengeStatus(c);
        const days = Array.from({ length: c.days }, (_, i) => addDays(c.startDate, i));
        return (
          <div key={c.id} className="card">
            <div className="row between">
              <b style={{ cursor: 'pointer' }} onClick={() => setEdit(c)}>{c.title}</b>
              {s.completed ? <span className="tag ok">Réussi</span> : s.broken ? <span className="tag warn">Série interrompue</span> : <span className="tag">{s.current}/{c.days} jours</span>}
            </div>
            {c.description && <div className="small muted">{c.description}</div>}
            <div className="row wrap" style={{ gap: 6, margin: '10px 0' }}>
              {days.map((d) => (
                <button key={d} className={`hcell ${c.checks.includes(d) ? 'on' : ''}`} disabled={d > today()} title={d} onClick={() => toggleChallengeDay(c.id, d)}>{+d.slice(8)}</button>
              ))}
            </div>
            <Bar pct={s.pct} />
            {s.broken && !s.completed && (
              <button className="btn small" style={{ marginTop: 10 }} onClick={async () => {
                if (await ui.confirm('Recommencer ce défi à partir d’aujourd’hui ?', { ok: 'Recommencer' })) getStore().update('challenges', c.id, { startDate: today(), checks: [] });
              }}>Recommencer aujourd’hui</button>
            )}
          </div>
        );
      }) : <Empty>Aucun défi en cours.</Empty>}
      {edit && (
        <Sheet title={edit.id ? 'Défi' : 'Nouveau défi'} onClose={() => setEdit(null)} footer={<>
          {edit.id && <button className="btn ghost danger" style={{ marginRight: 'auto' }} onClick={() => { getStore().update('challenges', edit.id!, { archived: true }); setEdit(null); }}>Archiver</button>}
          <button className="btn" onClick={() => setEdit(null)}>Annuler</button>
          <button className="btn primary" onClick={() => {
            if (!edit.title?.trim()) return;
            if (edit.id) getStore().update('challenges', edit.id, edit);
            else getStore().create('challenges', { checks: [], ...edit, title: edit.title.trim() } as Challenge);
            setEdit(null);
          }}>Enregistrer</button>
        </>}>
          <div className="col" style={{ gap: 12 }}>
            <input className="input title-input" autoFocus placeholder="Ex : Petit-déjeuner avant 9h" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            <div className="form-grid">
              <div className="field"><label>Nombre de jours consécutifs</label><input className="input" type="number" min={1} value={edit.days ?? 7} onChange={(e) => setEdit({ ...edit, days: Math.max(1, +e.target.value) })} /></div>
              <div className="field"><label>Début</label><input className="input" type="date" value={edit.startDate ?? today()} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} /></div>
            </div>
            <div className="field"><label>Description</label><textarea className="input" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
          </div>
        </Sheet>
      )}
    </>
  );
}
