import { diffDays, weekday, weekStart, daysBetween, parseDate } from '../lib/date';
import { contentPlanningItems } from './contentPlan';
import type { DataState, DateStr, Item, RecurrenceRule, Series, ViewItem } from '../data/types';

export function occursOn(rule: RecurrenceRule, date: DateStr): boolean {
  if (date < rule.start) return false;
  if (rule.until && date > rule.until) return false;
  const interval = Math.max(1, rule.interval || 1);
  switch (rule.freq) {
    case 'daily':
    case 'interval':
      return diffDays(date, rule.start) % interval === 0;
    case 'weekly': {
      const days = rule.weekdays?.length ? rule.weekdays : [weekday(rule.start)];
      if (!days.includes(weekday(date))) return false;
      const weeks = diffDays(weekStart(date), weekStart(rule.start)) / 7;
      return weeks % interval === 0;
    }
    case 'monthly': {
      const d = parseDate(date);
      const s = parseDate(rule.start);
      if (d.getDate() !== s.getDate()) return false;
      const months = (d.getFullYear() - s.getFullYear()) * 12 + (d.getMonth() - s.getMonth());
      return months % interval === 0;
    }
  }
}

export const virtualId = (seriesId: string, date: DateStr) => `v:${seriesId}:${date}`;
export const isVirtualId = (id: string) => id.startsWith('v:');
export const parseVirtualId = (id: string) => {
  const [, seriesId, date] = id.match(/^v:(.+):(\d{4}-\d{2}-\d{2})$/) ?? [];
  return { seriesId, date };
};

export function virtualItem(series: Series, date: DateStr): ViewItem {
  return {
    ...series.template,
    id: virtualId(series.id, date),
    createdAt: series.createdAt,
    updatedAt: series.updatedAt,
    date,
    status: 'todo',
    seriesId: series.id,
    occurrenceDate: date,
    virtual: true,
  };
}

/** Index des occurrences déjà matérialisées (y compris supprimées) : empêche toute occurrence en double. */
export function materializedIndex(state: DataState): Set<string> {
  const set = new Set<string>();
  for (const it of Object.values(state.items)) if (it.seriesId && it.occurrenceDate) set.add(`${it.seriesId}|${it.occurrenceDate}`);
  return set;
}

/** Tous les éléments (réels + occurrences virtuelles) dont la date est dans [start, end]. */
export function expandRange(state: DataState, start: DateStr, end: DateStr): ViewItem[] {
  const out: ViewItem[] = [];
  for (const it of Object.values(state.items)) if (!it.deleted && it.date && it.date >= start && it.date <= end) out.push(it);
  const mat = materializedIndex(state);
  const days = daysBetween(start, end);
  for (const s of Object.values(state.series)) {
    if (s.deleted) continue;
    if (s.rule.until && s.rule.until < start) continue;
    if (s.rule.start > end) continue;
    const ex = new Set(s.exdates);
    for (const d of days) {
      if (ex.has(d) || mat.has(`${s.id}|${d}`)) continue;
      if (occursOn(s.rule, d)) out.push(virtualItem(s, d));
    }
  }
  out.push(...contentPlanningItems(state, start, end));
  return out;
}

export const byStart = (a: Item, b: Item) =>
  (a.start ?? '99:99').localeCompare(b.start ?? '99:99') || (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title);
