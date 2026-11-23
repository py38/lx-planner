import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { freshStore } from './helpers';
import { applyNotionImport, notionUuid, planNotionImport, stableId, type NotionBundle } from '../src/data/importNotion';
import { migrateIdeasToContents } from '../src/data/migrations';
import { bankFilter, contentProgress, isBankIdea, isPosted, shootDays } from '../src/logic/contentPlan';
import type { Idea, Item, Project } from '../src/data/types';
import type { Store } from '../src/data/store';

const FILE = new URL('../import/notion-banque-idees.json', import.meta.url);
const sample: NotionBundle = {
  app: 'lx-planner-import', version: 1, source: 'notion', exportedAt: '2026-11-22T00:00:00Z',
  entries: [
    { notionId: '41a4f243d101805abaf5ed607cb2f05d', title: 'Pose à 35€', status: '💡 Idée', pilier: 'Éducation', script: 'Mon script', legende: 'Ma légende', body: 'Angle', materiel: ['Téléphone'] },
    { notionId: '41a4f243d1018035a44cc61b569bd595', title: 'Collab ULKA', status: '📅 Programmé', format: 'Reel', objectif: 'Conversion', accroche: 'Une matinée', cta: 'Commente', publishDate: '2026-11-23T06:30:00Z', shootDate: '2026-11-18T08:00:00Z' },
    { notionId: '41a4f243d101803686f6d7c6522669dd', title: 'Black week', status: '🎬 À tourner', projet: 'Formation en ligne', phase: 'Pré-lancement', publishDate: '2026-11-24' },
    { notionId: '41b4f243d10180cb8c11fcba33f84202', title: 'aura studio', status: '🚀 Publié', publishDate: '2026-11-17' },
  ],
};

let store: Store;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T10:00:00'));
  ({ store } = await freshStore());
});
afterEach(() => vi.useRealTimers());

describe('Import Notion → fiches contenu', () => {
  it('reprend tous les champs (accroche, script, CTA, légende, format, objectif, pilier, dates)', () => {
    applyNotionImport(planNotionImport(store.state, sample));
    const all = store.list('contents');
    expect(all).toHaveLength(4);
    const pose = all.find((c) => c.title === 'Pose à 35€')!;
    expect(pose).toMatchObject({ script: 'Mon script', caption: 'Ma légende', pillar: 'education', format: 'reel', platforms: ['instagram'] });
    expect(pose.notes).toContain('Angle');
    expect(pose.notes).toContain('Matériel : Téléphone');
    expect(isBankIdea(pose)).toBe(true); // sans date → Banque d'idées
    expect(pose.checks).toEqual({ script: true, caption: true });

    const ulka = all.find((c) => c.title === 'Collab ULKA')!;
    expect(ulka).toMatchObject({ hook: 'Une matinée', cta: 'Commente', goal: 'conversion', shootDate: '2026-11-18', publishDate: '2026-11-23', publishTime: '07:30' });
    expect(ulka.checks).toMatchObject({ script: true, shot: true, edited: true, caption: true, cover: true });
    expect(ulka.checks.posted_instagram).toBeUndefined();

    const bw = all.find((c) => c.title === 'Black week')!;
    expect(bw.tags).toEqual(['Formation en ligne', 'Pré-lancement']);
    expect(bw.checks).toEqual({ script: true });
    expect(isPosted(all.find((c) => c.title === 'aura studio')!)).toBe(true);
  });

  it('aucune tâche ni projet n’est créé dans le planning (calendrier de contenu séparé)', () => {
    const items = store.list('items').length;
    const projects = store.list('projects').length;
    applyNotionImport(planNotionImport(store.state, sample));
    expect(store.list('items')).toHaveLength(items);
    expect(store.list('projects')).toHaveLength(projects);
  });

  it('ré-importer ne crée aucun doublon ; une fiche supprimée n’est pas recréée', () => {
    applyNotionImport(planNotionImport(store.state, sample));
    expect(planNotionImport(store.state, sample).contents).toHaveLength(0);
    const pose = store.list('contents').find((c) => c.title === 'Pose à 35€')!;
    store.remove('contents', pose.id);
    expect(planNotionImport(store.state, sample).contents).toHaveLength(0);
  });

  it('identifiants identiques sur deux appareils', async () => {
    const a = planNotionImport(store.state, sample).contents.map((c) => c.id);
    const { store: other } = await freshStore({ name: 'other' });
    expect(planNotionImport(other.state, sample).contents.map((c) => c.id)).toEqual(a);
    expect(a[0]).toBe(notionUuid('41a4f243d101805abaf5ed607cb2f05d'));
    expect(stableId('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it.runIf(existsSync(FILE))('fichier réel généré depuis Notion : 28 fiches', () => {
    const bundle = JSON.parse(readFileSync(FILE, 'utf8')) as NotionBundle;
    const plan = planNotionImport(store.state, bundle);
    expect(plan.contents).toHaveLength(28);
    applyNotionImport(plan);
    const all = store.list('contents');
    expect(all.filter((c) => bankFilter(c, 'todo')).length).toBeGreaterThanOrEqual(15);
    expect(all.filter(isPosted)).toHaveLength(1);
    const mg = all.find((c) => c.title.startsWith('Tu peux avoir un planning complet'))!;
    expect(mg.notes).toContain('Phrase de conclusion');
    expect(mg.tags).toContain('Marque générale');
  });
});

describe('Banque d’idées = fiches contenu', () => {
  it('planifier une idée = lui donner une date (même fiche, aucune copie)', () => {
    applyNotionImport(planNotionImport(store.state, sample));
    const pose = store.list('contents').find((c) => c.title === 'Pose à 35€')!;
    store.update('contents', pose.id, { shootDate: '2026-11-24', publishDate: '2026-12-03' });
    expect(store.list('contents')).toHaveLength(4);
    expect(shootDays(store.state).get('2026-11-24')!.map((c) => c.id)).toEqual([pose.id]);
    expect(bankFilter(store.get('contents', pose.id)!, 'planned')).toBe(true);
    expect(contentProgress(store.get('contents', pose.id)!).done).toBe(2); // script + légende déjà prêts
  });
});

describe('Migration des anciennes idées', () => {
  it('chaque ancienne idée devient une fiche contenu avec ses textes, sans doublon', () => {
    const legacy = 'ACCROCHE\nMon accroche\n\nSCRIPT\nLe script\n\nLÉGENDE\nLa légende\n\nStatut dans Notion : 💡 Idée\nMatériel : Téléphone';
    const idea = store.create('ideas', { title: 'Vieille idée', type: 'reel', content: legacy, tags: ['Confiance', 'Marque générale'], status: 'idea' } as Idea);
    expect(migrateIdeasToContents(store)).toBe(1);
    const c = store.get('contents', idea.id)!;
    expect(c).toMatchObject({ title: 'Vieille idée', hook: 'Mon accroche', script: 'Le script', caption: 'La légende', goal: 'trust', tags: ['Marque générale'] });
    expect(c.notes).toContain('Matériel : Téléphone');
    expect(c.caption).not.toContain('Statut');
    expect(store.get('ideas', idea.id)).toBeUndefined();
    expect(migrateIdeasToContents(store)).toBe(0); // relancer ne change rien
    expect(store.list('contents').filter((x) => x.title === 'Vieille idée')).toHaveLength(1);
  });

  it('une idée transformée en projet garde sa date de publication et ses étapes faites', () => {
    const p = store.create('projects', { title: 'P', status: 'active', type: 'content', publishDate: '2026-12-10' } as Project);
    const idea = store.create('ideas', { title: 'Avec projet', type: 'reel', status: 'converted', projectId: p.id } as Idea);
    store.create('items', { kind: 'task', title: 'Tournage', projectId: p.id, contentRole: 'shooting', date: '2026-12-05', status: 'done', priority: 'important' } as Item);
    migrateIdeasToContents(store);
    expect(store.get('contents', idea.id)).toMatchObject({ publishDate: '2026-12-10', shootDate: '2026-12-05', checks: { shot: true } });
  });
});

describe('Nettoyage des anciens projets de contenu', () => {
  it('retire les tâches de projet qui feraient doublon avec la fiche contenu', async () => {
    const { retireLegacyContentProjects } = await import('../src/data/migrations');
    const p = store.create('projects', { title: 'P', status: 'active', type: 'content', publishDate: '2026-12-10' } as Project);
    const idea = store.create('ideas', { title: 'Avec projet', type: 'reel', status: 'converted', projectId: p.id } as Idea);
    store.update('projects', p.id, { ideaId: idea.id });
    store.create('items', { kind: 'task', title: 'Script — Avec projet', projectId: p.id, contentRole: 'script', date: '2026-12-07', status: 'todo', priority: 'important' } as Item);
    const other = store.create('items', { kind: 'task', title: 'Tâche normale', date: '2026-12-07', status: 'todo', priority: 'important' } as Item);
    migrateIdeasToContents(store);
    expect(retireLegacyContentProjects(store)).toBe(1);
    expect(store.list('items').filter((i) => i.projectId === p.id)).toHaveLength(0);
    expect(store.get('projects', p.id)).toBeUndefined();
    expect(store.get('items', other.id)).toBeTruthy();
    expect(store.get('contents', idea.id)!.publishDate).toBe('2026-12-10');
  });
});
