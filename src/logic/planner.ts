// Planification assistée : l'application SUGGÈRE, elle ne déplace jamais rien seule.
import { expandRange } from './recurrence';
import { addDays, isSunday, minToTime, nowMin, timeToMin, today } from '../lib/date';
import type { DataState, DateStr, Item, Settings, TimeStr, ViewItem } from '../data/types';

export interface Interval { start: number; end: number; label?: string }
const DEFAULT_DURATION = 30;
const SNAP = 15;

export const isPro = (state: DataState, categoryId?: string) => !!categoryId && state.categories[categoryId]?.kind === 'pro';

/** Créneaux occupés d'un jour (rendez-vous, formations, événements, tâches déjà placées) + trajets + marges. */
export function busyIntervals(state: DataState, date: DateStr, settings: Settings, excludeId?: string): Interval[] {
  const out: Interval[] = [];
  for (const it of expandRange(state, date, date)) {
    if (!it.start || it.id === excludeId) continue;
    const s = timeToMin(it.start) - (it.travelMin ?? 0);
    const e = timeToMin(it.start) + (it.duration ?? DEFAULT_DURATION) + (it.travelMin ? it.travelMin : 0);
    out.push({ start: s, end: e + settings.bufferMin, label: it.title });
  }
  if (settings.mealBlock?.enabled) {
    const s = timeToMin(settings.mealBlock.start);
    out.push({ start: s, end: s + settings.mealBlock.duration, label: 'Repas' });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function freeSlots(state: DataState, date: DateStr, settings: Settings, opts: { excludeId?: string; extraBusy?: Interval[] } = {}): Interval[] {
  let from = timeToMin(settings.dayStart);
  const to = timeToMin(settings.dayEnd);
  if (date === today()) from = Math.max(from, Math.ceil(nowMin() / SNAP) * SNAP);
  const busy = [...busyIntervals(state, date, settings, opts.excludeId), ...(opts.extraBusy ?? [])].sort((a, b) => a.start - b.start);
  const free: Interval[] = [];
  let cur = from;
  for (const b of busy) {
    if (b.end <= cur) continue;
    if (b.start > cur) free.push({ start: cur, end: Math.min(b.start, to) });
    cur = Math.max(cur, b.end);
    if (cur >= to) break;
  }
  if (cur < to) free.push({ start: cur, end: to });
  return free.filter((f) => f.end - f.start >= SNAP).map((f) => ({ start: Math.ceil(f.start / SNAP) * SNAP, end: f.end })).filter((f) => f.end > f.start);
}

/** Charge de travail pro déjà prévue un jour donné (minutes). */
export function workLoad(state: DataState, date: DateStr): number {
  return expandRange(state, date, date).filter((i) => isPro(state, i.categoryId)).reduce((s, i) => s + (i.duration ?? 0), 0);
}

export interface SlotSuggestion { date: DateStr; start: TimeStr; reason: string }

/** Propose quelques créneaux libres pour une tâche — sans surcharger les journées ni toucher au dimanche protégé. */
export function suggestSlots(state: DataState, item: Pick<Item, 'duration' | 'categoryId' | 'deadline' | 'id'>, settings: Settings, from = today(), days = 14, max = 5): SlotSuggestion[] {
  const dur = item.duration ?? 60;
  const pro = isPro(state, item.categoryId);
  const out: SlotSuggestion[] = [];
  for (let i = 0; i < days && out.length < max; i++) {
    const d = addDays(from, i);
    if (item.deadline && d > item.deadline) break;
    if (pro && settings.sundayProtected && isSunday(d)) continue;
    const load = workLoad(state, d);
    if (pro && load + dur > settings.maxDailyWorkMin) continue;
    const slot = freeSlots(state, d, settings, { excludeId: item.id }).find((f) => f.end - f.start >= dur);
    if (slot) out.push({ date: d, start: minToTime(slot.start), reason: load ? `${Math.round(load / 60 * 10) / 10} h déjà prévues ce jour-là` : 'Journée encore libre' });
  }
  return out;
}

export interface PlanProposal { placements: { item: ViewItem; start: TimeStr }[]; unplaced: ViewItem[] }

/** Propose un placement pour plusieurs tâches d'une journée (par priorité). Rien n'est appliqué sans confirmation. */
export function proposeDayPlan(state: DataState, date: DateStr, tasks: ViewItem[], settings: Settings): PlanProposal {
  const rank = { must: 0, important: 1, optional: 2 } as const;
  const sorted = [...tasks].sort((a, b) => rank[a.priority] - rank[b.priority] || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
  const placed: Interval[] = [];
  const placements: PlanProposal['placements'] = [];
  const unplaced: ViewItem[] = [];
  let load = workLoad(state, date);
  const sundayBlocked = settings.sundayProtected && isSunday(date);
  for (const t of sorted) {
    const dur = t.duration ?? 60;
    const pro = isPro(state, t.categoryId);
    if ((pro && sundayBlocked) || (pro && load + dur > settings.maxDailyWorkMin)) { unplaced.push(t); continue; }
    const slot = freeSlots(state, date, settings, { excludeId: t.id, extraBusy: placed }).find((f) => f.end - f.start >= dur);
    if (!slot) { unplaced.push(t); continue; }
    placements.push({ item: t, start: minToTime(slot.start) });
    placed.push({ start: slot.start, end: slot.start + dur + settings.bufferMin });
    if (pro) load += dur;
  }
  return { placements, unplaced };
}

/** Chevauchements dans une journée (pour signaler, jamais pour corriger automatiquement). */
export function overlaps(items: ViewItem[]): Set<string> {
  const timed = items.filter((i) => i.start).map((i) => ({ id: i.id, s: timeToMin(i.start!), e: timeToMin(i.start!) + (i.duration ?? DEFAULT_DURATION) }));
  const set = new Set<string>();
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length; j++)
      if (timed[i].s < timed[j].e && timed[j].s < timed[i].e) { set.add(timed[i].id); set.add(timed[j].id); }
  return set;
}
