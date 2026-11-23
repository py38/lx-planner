// Bilans : calculés UNIQUEMENT à partir de ce qui a été réellement validé.
// « Prévu » (durées planifiées) et « réalisé » (temps saisi à la validation) sont toujours séparés.
import { expandRange } from './recurrence';
import { completionRate, logsByHabit, sumBetween } from './habits';
import { today, addDays, monthStart, monthEnd, weekStart, yearStart, yearEnd } from '../lib/date';
import type { DataState, DateStr, Goal, ID, ViewItem } from '../data/types';

export interface CategoryStats {
  categoryId: ID;
  name: string;
  color: string;
  plannedMin: number;
  actualMin: number;
  pct: number; // réalisé / prévu (heures)
  done: number;
  notDone: number; // date passée et non validée
  upcoming: number; // à venir dans la période
  missed: ViewItem[];
}

export interface PeriodStats {
  start: DateStr;
  end: DateStr;
  categories: CategoryStats[];
  totals: { plannedMin: number; actualMin: number; pct: number; done: number; notDone: number; upcoming: number; taskPct: number };
  postponed: number;
  appointmentsDone: number;
  projects: { done: number; active: number };
  sportSessions: number;
  habits: { validations: number; pct: number };
  perso: { plannedMin: number; actualMin: number };
  objectivesReached: number;
}

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function periodStats(state: DataState, start: DateStr, end: DateStr, ref = today()): PeriodStats {
  // les publications/tournages du calendrier de contenu sont affichés dans le planning mais n'ont pas de temps validé : hors bilans d'heures
  const items = expandRange(state, start, end).filter((i) => !i.contentRef);
  const cats = Object.values(state.categories).filter((c) => !c.deleted).sort((a, b) => a.order - b.order);
  const pro = cats.filter((c) => c.kind === 'pro');
  const proIds = new Set(pro.map((c) => c.id));

  const categories: CategoryStats[] = pro.map((c) => {
    const its = items.filter((i) => i.categoryId === c.id);
    const doneItems = its.filter((i) => i.status === 'done');
    const missed = its.filter((i) => i.status !== 'done' && i.date! < ref);
    const plannedMin = its.reduce((s, i) => s + (i.duration ?? 0), 0);
    const actualMin = doneItems.reduce((s, i) => s + (i.actualMinutes ?? 0), 0);
    return {
      categoryId: c.id, name: c.name, color: c.color, plannedMin, actualMin, pct: ratio(actualMin, plannedMin),
      done: doneItems.length, notDone: missed.length, upcoming: its.length - doneItems.length - missed.length, missed,
    };
  });

  const sum = (k: 'plannedMin' | 'actualMin' | 'done' | 'notDone' | 'upcoming') => categories.reduce((s, c) => s + c[k], 0);
  const persoItems = items.filter((i) => !i.categoryId || !proIds.has(i.categoryId));

  const allItems = Object.values(state.items).filter((i) => !i.deleted);
  const postponed = allItems.reduce(
    (s, i) => s + (i.postponements ?? []).filter((p) => p.at.slice(0, 10) >= start && p.at.slice(0, 10) <= end).length, 0);

  const projects = Object.values(state.projects).filter((p) => !p.deleted);
  const habits = Object.values(state.habits).filter((h) => !h.deleted && !h.archived);
  const logs = logsByHabit(state);
  const sportSessions = habits.filter((h) => h.isSport).reduce((s, h) => s + sumBetween(logs.get(h.id) ?? [], start, end), 0);
  let hDone = 0, hExp = 0, validations = 0;
  for (const h of habits) {
    const ls = logs.get(h.id) ?? [];
    validations += ls.filter((l) => l.date >= start && l.date <= end).length;
    const r = completionRate(h, ls, start, end, ref);
    if (r) { hDone += Math.min(r.done, r.expected); hExp += r.expected; }
  }
  const objectivesReached = Object.values(state.objectives).filter(
    (o) => !o.deleted && o.done && o.completedAt && o.completedAt.slice(0, 10) >= start && o.completedAt.slice(0, 10) <= end).length;

  const plannedMin = sum('plannedMin');
  const actualMin = sum('actualMin');
  const done = sum('done');
  const notDone = sum('notDone');
  return {
    start, end, categories,
    totals: { plannedMin, actualMin, pct: ratio(actualMin, plannedMin), done, notDone, upcoming: sum('upcoming'), taskPct: ratio(done, done + notDone) },
    postponed,
    appointmentsDone: items.filter((i) => i.kind === 'appointment' && i.status === 'done').length,
    projects: {
      done: projects.filter((p) => p.status === 'done' && p.completedAt && p.completedAt.slice(0, 10) >= start && p.completedAt.slice(0, 10) <= end).length,
      active: projects.filter((p) => p.status === 'active' || p.status === 'blocked').length,
    },
    sportSessions,
    habits: { validations, pct: ratio(hDone, hExp) },
    perso: {
      plannedMin: persoItems.reduce((s, i) => s + (i.duration ?? 0), 0),
      actualMin: persoItems.filter((i) => i.status === 'done').reduce((s, i) => s + (i.actualMinutes ?? 0), 0),
    },
    objectivesReached,
  };
}

// ---------- Objectifs chiffrés ----------
export function goalPeriod(g: Goal, ref = today()): [DateStr, DateStr] {
  switch (g.period) {
    case 'day': return [ref, ref];
    case 'week': return [weekStart(ref), addDays(weekStart(ref), 6)];
    case 'month': return [monthStart(ref), monthEnd(ref)];
    case 'year': return [yearStart(ref), yearEnd(ref)];
    case 'once': return [g.startDate, g.endDate ?? '9999-12-31'];
  }
}

export function goalProgress(state: DataState, g: Goal, ref = today()) {
  const [start, end] = goalPeriod(g, ref);
  let value = 0;
  const items = () => Object.values(state.items).filter((i) => !i.deleted && i.status === 'done' && i.date && i.date >= start && i.date <= end);
  switch (g.source) {
    case 'manual':
      value = Object.values(state.goalLogs).filter((l) => !l.deleted && l.goalId === g.id && l.date >= start && l.date <= end).reduce((s, l) => s + l.value, 0);
      break;
    case 'habit': {
      value = Object.values(state.habitLogs).filter((l) => !l.deleted && l.habitId === g.habitId && l.date >= start && l.date <= end).reduce((s, l) => s + l.value, 0);
      break;
    }
    case 'sportSessions': {
      const sport = new Set(Object.values(state.habits).filter((h) => !h.deleted && h.isSport).map((h) => h.id));
      value = Object.values(state.habitLogs).filter((l) => !l.deleted && sport.has(l.habitId) && l.date >= start && l.date <= end).reduce((s, l) => s + l.value, 0);
      break;
    }
    case 'categoryHours':
      value = Math.round((items().filter((i) => i.categoryId === g.categoryId).reduce((s, i) => s + (i.actualMinutes ?? 0), 0) / 60) * 10) / 10;
      break;
    case 'categoryCount':
      value = items().filter((i) => i.categoryId === g.categoryId).length;
      break;
    case 'projectsDone':
      value = Object.values(state.projects).filter((p) => !p.deleted && p.status === 'done' && p.completedAt && p.completedAt.slice(0, 10) >= start && p.completedAt.slice(0, 10) <= end).length;
      break;
  }
  const active = ref >= g.startDate && (!g.endDate || ref <= g.endDate);
  return { value, target: g.target, pct: g.target > 0 ? Math.min(100, Math.round((value / g.target) * 100)) : 0, start, end, active };
}
