import { addDays, daysBetween, diffDays, monthEnd, monthStart, today, weekStart } from '../lib/date';
import type { DataState, DateStr, Habit, HabitLog } from '../data/types';

export function logsByHabit(state: DataState): Map<string, HabitLog[]> {
  const m = new Map<string, HabitLog[]>();
  for (const l of Object.values(state.habitLogs)) {
    if (l.deleted) continue;
    const arr = m.get(l.habitId) ?? [];
    arr.push(l);
    m.set(l.habitId, arr);
  }
  return m;
}

export const valueOn = (logs: HabitLog[], date: DateStr) => logs.filter((l) => l.date === date).reduce((s, l) => s + l.value, 0);
export const sumBetween = (logs: HabitLog[], start: DateStr, end: DateStr) =>
  logs.filter((l) => l.date >= start && l.date <= end).reduce((s, l) => s + l.value, 0);

/** Validée ce jour-là ? (uniquement à partir des coches réelles) */
export function doneOn(h: Habit, logs: HabitLog[], date: DateStr): boolean {
  const v = valueOn(logs, date);
  return h.kind === 'quantity' ? v >= h.target : v >= 1;
}

export function lastDone(logs: HabitLog[], before = today()): DateStr | undefined {
  return logs.filter((l) => l.date <= before && l.value > 0).map((l) => l.date).sort().pop();
}

export interface HabitPeriodStatus {
  value: number;
  target: number;
  pct: number;
  label: string;
  due?: boolean; // pour les habitudes « tous les N jours »
  nextDue?: DateStr;
}

export function periodStatus(h: Habit, logs: HabitLog[], ref = today()): HabitPeriodStatus {
  switch (h.period) {
    case 'day': {
      const v = valueOn(logs, ref);
      const value = h.kind === 'quantity' ? v : Math.min(v, h.target);
      return { value, target: h.target, pct: pct(value, h.target), label: "aujourd'hui" };
    }
    case 'week': {
      const v = sumBetween(logs, weekStart(ref), addDays(weekStart(ref), 6));
      return { value: v, target: h.target, pct: pct(v, h.target), label: 'cette semaine' };
    }
    case 'month': {
      const v = sumBetween(logs, monthStart(ref), monthEnd(ref));
      return { value: v, target: h.target, pct: pct(v, h.target), label: 'ce mois-ci' };
    }
    case 'interval': {
      const last = lastDone(logs, ref);
      const every = h.intervalDays ?? 1;
      const nextDue = last ? addDays(last, every) : ref;
      const due = nextDue <= ref;
      return { value: due ? 0 : 1, target: 1, pct: due ? 0 : 100, label: last ? `dernière fois il y a ${diffDays(ref, last)} j` : 'jamais validée', due, nextDue };
    }
  }
}

const pct = (v: number, t: number) => (t > 0 ? Math.min(100, Math.round((v / t) * 100)) : 0);

/**
 * Taux de réalisation d'une habitude sur une période (seules les validations réelles comptent).
 * Les jours futurs et ceux précédant la création de l'habitude ne sont pas comptés.
 */
export function completionRate(h: Habit, logs: HabitLog[], start: DateStr, end: DateStr, ref = today()): { done: number; expected: number; pct: number } | null {
  if (h.optional) return null;
  const created = h.createdAt.slice(0, 10);
  const s = start > created ? start : created;
  const e = end < ref ? end : ref;
  if (s > e) return null;
  const days = daysBetween(s, e);
  switch (h.period) {
    case 'day': {
      const done = days.filter((d) => doneOn(h, logs, d)).length;
      return { done, expected: days.length, pct: pct(done, days.length) };
    }
    case 'week':
    case 'month': {
      // proportion de l'objectif atteinte, période par période
      const buckets = new Map<string, DateStr[]>();
      for (const d of days) {
        const k = h.period === 'week' ? weekStart(d) : monthStart(d);
        buckets.set(k, [...(buckets.get(k) ?? []), d]);
      }
      let done = 0;
      let expected = 0;
      for (const [, ds] of buckets) {
        done += Math.min(h.target, sumBetween(logs, ds[0], ds[ds.length - 1]));
        expected += h.target;
      }
      return { done, expected, pct: pct(done, expected) };
    }
    case 'interval': {
      const expected = Math.max(1, Math.floor(days.length / (h.intervalDays ?? 1)));
      const done = Math.min(expected, logs.filter((l) => l.date >= s && l.date <= e && l.value > 0).length);
      return { done, expected, pct: pct(done, expected) };
    }
  }
}

/** Série en cours de jours consécutifs (habitudes quotidiennes). */
export function streak(h: Habit, logs: HabitLog[], ref = today()): number {
  if (h.period !== 'day') return 0;
  let d = doneOn(h, logs, ref) ? ref : addDays(ref, -1);
  let n = 0;
  while (doneOn(h, logs, d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** Défi « N jours consécutifs » : progression = jours consécutifs validés depuis le début, interrompue par un jour manqué. */
export function challengeStatus(c: { startDate: DateStr; days: number; checks: DateStr[] }, ref = today()) {
  const set = new Set(c.checks);
  let run = 0;
  let best = 0;
  let broken = false;
  const end = addDays(c.startDate, c.days - 1);
  for (let d = c.startDate; d <= end && d <= ref; d = addDays(d, 1)) {
    if (set.has(d)) {
      run++;
      best = Math.max(best, run);
    } else if (d < ref) {
      run = 0;
      broken = true;
    }
  }
  const completed = best >= c.days;
  return { current: run, best, broken, completed, pct: pct(run, c.days), ended: ref > end };
}
