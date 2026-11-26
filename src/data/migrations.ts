// Migrations de données au démarrage (idempotentes : les relancer ne change rien).
import type { Store } from './store';
import { contentFromIdea } from '../logic/contentPlan';
import { projectSteps } from '../logic/progress';
import type { ContentPiece } from './types';
import { PASTEL_REMAP } from './defaults';
import { academyModules, academyOffers, academySettings, academyTrainer, academyVenue } from './academyDefaults';

/**
 * La Banque d'idées est désormais faite de fiches contenu (mêmes champs que le calendrier de contenu).
 * Chaque ancienne « idée » devient une fiche contenu portant le même identifiant (→ aucun doublon entre appareils),
 * puis l'ancienne fiche est retirée. Une idée déjà reliée à un contenu est simplement retirée.
 */
export function migrateIdeasToContents(store: Store): number {
  const ideas = Object.values(store.state.ideas).filter((i) => !i.deleted);
  if (!ideas.length) return 0;
  let converted = 0;
  store.transact(() => {
    for (const idea of ideas) {
      const alreadyLinked = store.state.contents[idea.id] || Object.values(store.state.contents).some((c) => !c.deleted && c.ideaId === idea.id);
      if (!alreadyLinked) {
        const c = { ...contentFromIdea(idea), id: idea.id, createdAt: idea.createdAt, ideaId: undefined } as ContentPiece;
        const project = idea.projectId ? store.state.projects[idea.projectId] : undefined;
        if (project && !project.deleted) {
          c.publishDate = project.publishDate ?? c.publishDate;
          const steps = projectSteps(store.state, project.id);
          const done = (role: string) => steps.some((s) => s.contentRole === role && s.status === 'done');
          const shoot = steps.find((s) => s.contentRole === 'shooting');
          if (shoot?.date) c.shootDate = shoot.date;
          c.checks = { ...c.checks, script: c.checks.script || done('script'), shot: done('shooting'), edited: done('editing'), posted_instagram: project.status === 'done' };
        }
        store.create('contents', c);
        converted++;
      }
      store.remove('ideas', idea.id);
    }
  });
  return converted;
}

/**
 * Les anciens « projets de contenu » (créés par la 1re version de l'import Notion ou « Transformer en projet ») faisaient
 * apparaître script / tournage / montage / publication comme tâches du planning. Leur idée étant devenue une fiche
 * contenu (qui s'affiche elle-même dans le planning), ces tâches feraient doublon : on les retire, ainsi que le projet.
 */
export function retireLegacyContentProjects(store: Store): number {
  const hasContent = (ideaId: string) =>
    (store.state.contents[ideaId] && !store.state.contents[ideaId].deleted) || Object.values(store.state.contents).some((c) => !c.deleted && c.ideaId === ideaId);
  const legacy = Object.values(store.state.projects).filter((p) => !p.deleted && p.type === 'content' && p.ideaId && hasContent(p.ideaId));
  if (!legacy.length) return 0;
  store.transact(() => {
    for (const p of legacy) {
      for (const it of Object.values(store.state.items)) if (!it.deleted && it.projectId === p.id && it.contentRole) store.remove('items', it.id);
      store.remove('projects', p.id);
    }
  });
  return legacy.length;
}

/** Passe les catégories encore aux anciennes couleurs par défaut sur la palette pastel (les couleurs personnalisées sont gardées). */
export function pastelizeCategories(store: Store): number {
  let n = 0;
  store.transact(() => {
    for (const c of Object.values(store.state.categories)) {
      const next = !c.deleted && PASTEL_REMAP[c.color.toLowerCase()];
      if (next) { store.update('categories', c.id, { color: next }); n++; }
    }
  });
  return n;
}

/**
 * LX Academy Présentiel : catalogue, modules M01–M15, formatrice et lieu par défaut.
 * Ajout pur (aucune donnée existante n'est touchée). Une fiche déjà présente — même modifiée ou supprimée — n'est jamais recréée.
 */
export function seedAcademy(store: Store): number {
  let n = 0;
  store.transact(() => {
    for (const o of academyOffers()) if (store.seedIfAbsent('acOffers', o)) n++;
    for (const m of academyModules()) if (store.seedIfAbsent('acModules', m)) n++;
    if (store.seedIfAbsent('acTrainers', academyTrainer())) n++;
    if (store.seedIfAbsent('acVenues', academyVenue())) n++;
    if (store.seedIfAbsent('acSettings', academySettings())) n++;
  });
  return n;
}

export function runMigrations(store: Store) {
  pastelizeCategories(store);
  migrateIdeasToContents(store);
  retireLegacyContentProjects(store);
  seedAcademy(store);
}
