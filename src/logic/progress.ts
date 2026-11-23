import { addDays, diffDays, today } from '../lib/date';
import type { DataState, ID, Item, Project, ViewItem } from '../data/types';

/** Ce qui compte dans la progression du jour : tâches et rendez-vous (pas les événements perso). */
export const countsForProgress = (i: Item) => i.kind !== 'event';
export const isDone = (i: Item) => i.status === 'done';

export function dayProgress(items: ViewItem[]) {
  const counted = items.filter(countsForProgress);
  const done = counted.filter(isDone).length;
  const total = counted.length;
  return { total, done, remaining: total - done, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function projectSteps(state: DataState, projectId: ID): Item[] {
  return Object.values(state.items)
    .filter((i) => !i.deleted && i.projectId === projectId)
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.order ?? 0) - (b.order ?? 0));
}

export interface ProjectHealth {
  total: number;
  done: number;
  pct: number;
  late: boolean;
  lateSteps: Item[];
  blocked: boolean;
  nearDeadline: boolean;
  daysLeft?: number;
  nextStep?: Item;
}

/** Progression réelle = étapes validées / étapes totales. */
export function projectHealth(state: DataState, p: Project, ref = today()): ProjectHealth {
  const steps = projectSteps(state, p.id);
  const done = steps.filter(isDone).length;
  const total = steps.length;
  const lateSteps = steps.filter((s) => !isDone(s) && ((s.deadline && s.deadline < ref) || (s.date && s.date < ref)));
  const daysLeft = p.deadline ? diffDays(p.deadline, ref) : undefined;
  const open = p.status !== 'done';
  return {
    total,
    done,
    pct: total ? Math.round((done / total) * 100) : p.status === 'done' ? 100 : 0,
    lateSteps,
    late: open && ((daysLeft != null && daysLeft < 0) || lateSteps.length > 0),
    blocked: open && (p.status === 'blocked' || steps.some((s) => s.status === 'blocked')),
    nearDeadline: open && daysLeft != null && daysLeft >= 0 && daysLeft <= 14,
    daysLeft,
    nextStep: steps.find((s) => !isDone(s)),
  };
}

/** Tâches sans date : restent visibles tant qu'elles ne sont ni planifiées, ni terminées, ni supprimées. */
export function unscheduled(state: DataState): Item[] {
  const rank = { must: 0, important: 1, optional: 2 } as const;
  return Object.values(state.items)
    .filter((i) => !i.deleted && !i.date && i.status !== 'done')
    .sort((a, b) => rank[a.priority] - rank[b.priority] || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.createdAt.localeCompare(b.createdAt));
}

/** Tâches passées non validées (jamais considérées comme faites, jamais reportées automatiquement). */
export function pastUnvalidated(items: ViewItem[], ref = today()): ViewItem[] {
  return items.filter((i) => countsForProgress(i) && !isDone(i) && i.date && i.date < ref);
}

export const nextDays = (n: number, from = today()) => Array.from({ length: n }, (_, i) => addDays(from, i));
