import { today } from '../lib/date';
import { expandRange } from './recurrence';
import { contentAlerts, type ContentAlert } from './content';
import { contentPrepAlerts } from './contentPlan';
import { dueReminders, type DueReminder } from './reminders';
import { projectHealth } from './progress';
import { addDays } from '../lib/date';
import type { DataState, Item, Project, Settings, ViewItem } from '../data/types';

export interface Alerts {
  overdue: Item[]; // échéance finale dépassée, non terminée
  unvalidated: ViewItem[]; // date passée, ni validée ni reportée
  reminders: DueReminder[];
  content: ContentAlert[];
  contentPrep: ReturnType<typeof contentPrepAlerts>;
  projects: { project: Project; kind: 'late' | 'blocked' | 'near'; daysLeft?: number }[];
  count: number;
}

export function computeAlerts(state: DataState, settings: Settings, ref = today()): Alerts {
  const overdue = Object.values(state.items).filter((i) => !i.deleted && i.status !== 'done' && i.deadline && i.deadline < ref);
  // occurrences récurrentes passées non validées : limitées aux 14 derniers jours pour rester lisible
  const unvalidated = [
    ...Object.values(state.items).filter((i) => !i.deleted && !i.seriesId && i.kind !== 'event' && i.status !== 'done' && i.date && i.date < ref),
    ...expandRange(state, addDays(ref, -14), addDays(ref, -1)).filter((i) => i.seriesId && i.kind !== 'event' && i.status !== 'done'),
  ].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const reminders = dueReminders(state);
  const content = contentAlerts(state, settings, ref);
  const contentPrep = contentPrepAlerts(Object.values(state.contents), ref, settings.contentLeadDays);
  const projects: Alerts['projects'] = [];
  for (const p of Object.values(state.projects)) {
    if (p.deleted || p.status === 'done') continue;
    const h = projectHealth(state, p, ref);
    if (h.blocked) projects.push({ project: p, kind: 'blocked' });
    else if (h.late) projects.push({ project: p, kind: 'late', daysLeft: h.daysLeft });
    else if (h.nearDeadline) projects.push({ project: p, kind: 'near', daysLeft: h.daysLeft });
  }
  return {
    overdue, unvalidated, reminders, content, contentPrep, projects,
    count: overdue.length + reminders.length + content.length + contentPrep.length + projects.filter((p) => p.kind !== 'near').length,
  };
}
