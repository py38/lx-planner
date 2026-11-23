// Banque d'idées → projets de contenu, recalcul des étapes et alertes de préparation.
import { getStore } from '../data/store';
import { addDays, diffDays, today } from '../lib/date';
import { projectSteps } from './progress';
import type { DataState, DateStr, ID, Item, Project, Settings } from '../data/types';

/** Transforme une idée en projet de contenu avec ses étapes datées (toutes reliées à l'idée d'origine). */
export function convertIdeaToProject(ideaId: ID, publishDate: DateStr, opts: { categoryId?: ID; withSteps?: boolean } = {}) {
  const store = getStore();
  const idea = store.get('ideas', ideaId);
  if (!idea) throw new Error('Idée introuvable');
  const settings = store.settings;
  return store.transact(() => {
    const project = store.create('projects', {
      title: idea.title, description: idea.content, type: 'content', status: 'active', ideaId,
      publishDate, deadline: publishDate, categoryId: opts.categoryId ?? idea.categoryId,
    } as Project);
    if (opts.withSteps !== false) {
      settings.contentSteps.forEach((st, i) => {
        store.create('items', {
          kind: 'task', title: `${st.title} — ${idea.title}`, categoryId: project.categoryId, projectId: project.id, ideaId,
          contentRole: st.role, date: addDays(publishDate, st.offsetDays), duration: st.duration,
          priority: st.role === 'publication' ? 'must' : 'important', status: 'todo', order: i,
          deadline: st.role === 'publication' ? publishDate : undefined,
        } as Item);
      });
    }
    store.update('ideas', ideaId, { status: 'converted', projectId: project.id });
    return project;
  });
}

export interface RecalcChange { item: Item; from?: DateStr; to: DateStr }

/**
 * Si la date de publication change, propose de nouvelles dates pour les étapes non terminées
 * en conservant leur écart avec la publication. Rien n'est modifié ici.
 */
export function proposeRecalc(state: DataState, project: Project, newPublish: DateStr, settings: Settings): RecalcChange[] {
  const old = project.publishDate;
  const changes: RecalcChange[] = [];
  for (const s of projectSteps(state, project.id)) {
    if (s.status === 'done' || s.contentRole === 'publication') continue;
    const tpl = settings.contentSteps.find((t) => t.role === s.contentRole);
    const offset = s.date && old ? diffDays(s.date, old) : tpl?.offsetDays;
    if (offset == null) continue;
    const to = addDays(newPublish, offset);
    if (to !== s.date) changes.push({ item: s, from: s.date, to });
  }
  return changes;
}

/** Change la date de publication (et l'étape « publication »). Retourne la proposition de recalcul pour les autres étapes. */
export function setPublishDate(projectId: ID, newDate: DateStr): RecalcChange[] {
  const store = getStore();
  const project = store.get('projects', projectId);
  if (!project) return [];
  const proposal = proposeRecalc(store.state, project, newDate, store.settings);
  store.transact(() => {
    store.update('projects', projectId, { publishDate: newDate, deadline: newDate });
    for (const s of projectSteps(store.state, projectId))
      if (s.contentRole === 'publication' && s.status !== 'done') store.update('items', s.id, { date: newDate, deadline: newDate });
  });
  return proposal;
}

export function applyRecalc(changes: RecalcChange[]) {
  const store = getStore();
  store.transact(() => {
    for (const c of changes) store.update('items', c.item.id, { date: c.to });
  });
}

export interface ContentAlert { project: Project; daysLeft: number; pending: Item[] }

/** Contenus à publier bientôt dont la préparation (script, tournage, montage) n'est pas terminée. */
export function contentAlerts(state: DataState, settings: Settings, ref = today()): ContentAlert[] {
  const out: ContentAlert[] = [];
  for (const p of Object.values(state.projects)) {
    if (p.deleted || p.type !== 'content' || p.status === 'done' || !p.publishDate) continue;
    const daysLeft = diffDays(p.publishDate, ref);
    if (daysLeft < 0 || daysLeft > settings.contentLeadDays) continue;
    const pending = projectSteps(state, p.id).filter((s) => s.contentRole !== 'publication' && s.status !== 'done');
    if (pending.length) out.push({ project: p, daysLeft, pending });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}
