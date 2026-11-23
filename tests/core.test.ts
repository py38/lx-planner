import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { freshStore, reopen } from './helpers';
import {
  createItem, deleteItem, moveItem, postponeItem, updateItem, validateItem, unvalidateItem, toggleHabit, addHabitCount,
} from '../src/data/actions';
import { expandRange } from '../src/logic/recurrence';
import { dayProgress, projectHealth, unscheduled } from '../src/logic/progress';
import { periodStats, goalProgress } from '../src/logic/stats';
import type { Item, Series } from '../src/data/types';
import type { Store } from '../src/data/store';

let store: Store;
let factory: any;
const catId = (name: string) => store.list('categories').find((c) => c.name === name)!.id;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T10:00:00')); // mercredi
  ({ store, factory } = await freshStore());
});
afterEach(() => vi.useRealTimers());

describe('Données de départ', () => {
  it('crée les 5 catégories pro, les habitudes et le projet de lancement', () => {
    const pro = store.list('categories').filter((c) => c.kind === 'pro').map((c) => c.name);
    expect(pro).toEqual(expect.arrayContaining(['Rendez-vous clientes', 'Business & Gestion', 'LX Academy Online', 'LX Academy Présentiel', 'Création de contenu']));
    expect(pro).toHaveLength(5);
    expect(store.list('habits').length).toBeGreaterThanOrEqual(15);
    expect(store.list('projects')[0].deadline).toBe('2027-01-11');
    expect(store.settings.sundayProtected).toBe(true);
  });
  it('ne recrée pas les données de départ à la réouverture', async () => {
    await store.flushed();
    const s2 = await reopen(factory);
    expect(s2.list('categories')).toHaveLength(7);
  });
});

describe('Tâches : création, modification, suppression, déplacement', () => {
  it('une tâche datée apparaît dans le jour, la semaine et le mois correspondants', () => {
    const t = createItem({ title: 'Compta', date: '2026-11-26', start: '10:00', duration: 60, categoryId: catId('Business & Gestion') }) as Item;
    expect(expandRange(store.state, '2026-11-26', '2026-11-26').map((i) => i.id)).toContain(t.id);
    expect(expandRange(store.state, '2026-11-23', '2026-11-29').map((i) => i.id)).toContain(t.id);
    expect(expandRange(store.state, '2026-11-01', '2026-11-30').map((i) => i.id)).toContain(t.id);
  });
  it('déplacer met à jour toutes les vues (une seule donnée)', () => {
    const t = createItem({ title: 'Cliente Léa', kind: 'appointment', date: '2026-11-26', start: '09:00', duration: 90 }) as Item;
    moveItem(t.id, '2026-11-26', '09:30');
    expect(store.get('items', t.id)!.start).toBe('09:30');
    moveItem(t.id, '2026-11-27', '14:00');
    expect(expandRange(store.state, '2026-11-26', '2026-11-26').find((i) => i.id === t.id)).toBeUndefined();
    expect(expandRange(store.state, '2026-11-27', '2026-11-27').find((i) => i.id === t.id)?.start).toBe('14:00');
    expect(store.list('items').filter((i) => i.title === 'Cliente Léa')).toHaveLength(1);
  });
  it('modifie et supprime', () => {
    const t = createItem({ title: 'A', date: '2026-11-26' }) as Item;
    updateItem(t.id, { title: 'B', priority: 'must' });
    expect(store.get('items', t.id)!.title).toBe('B');
    deleteItem(t.id);
    expect(store.get('items', t.id)).toBeUndefined();
    expect(expandRange(store.state, '2026-11-26', '2026-11-26')).toHaveLength(0);
  });
  it('« À planifier » : une tâche sans date reste visible jusqu’à planification / validation / suppression', () => {
    const t = createItem({ title: 'Commander les capsules' }) as Item;
    expect(unscheduled(store.state).map((i) => i.id)).toContain(t.id);
    moveItem(t.id, '2026-11-28', '15:00');
    expect(unscheduled(store.state).map((i) => i.id)).not.toContain(t.id);
    postponeItem(t.id, null);
    expect(unscheduled(store.state).map((i) => i.id)).toContain(t.id);
    validateItem(t.id, 20);
    expect(unscheduled(store.state).map((i) => i.id)).not.toContain(t.id);
  });
});

describe('Validation : jamais de « terminé » automatique', () => {
  it('une tâche passée non validée n’est pas comptée comme réalisée', () => {
    createItem({ title: 'Montage', date: '2026-11-24', start: '10:00', duration: 120, categoryId: catId('Création de contenu') });
    const st = periodStats(store.state, '2026-11-23', '2026-11-29');
    const c = st.categories.find((x) => x.name === 'Création de contenu')!;
    expect(c.plannedMin).toBe(120);
    expect(c.actualMin).toBe(0);
    expect(c.done).toBe(0);
    expect(c.notDone).toBe(1);
  });
  it('heures prévues ≠ heures réalisées : le temps saisi à la validation fait foi', () => {
    const t = createItem({ title: 'Vidéos module 1', date: '2026-11-24', duration: 120, categoryId: catId('LX Academy Online') }) as Item;
    validateItem(t.id, 90);
    const c = periodStats(store.state, '2026-11-23', '2026-11-29').categories.find((x) => x.name === 'LX Academy Online')!;
    expect(c.plannedMin).toBe(120);
    expect(c.actualMin).toBe(90);
    expect(c.pct).toBe(75);
    unvalidateItem(t.id);
    expect(periodStats(store.state, '2026-11-23', '2026-11-29').categories.find((x) => x.name === 'LX Academy Online')!.actualMin).toBe(0);
  });
  it('progression du jour', () => {
    const a = createItem({ title: 'a', date: '2026-11-25' }) as Item;
    createItem({ title: 'b', date: '2026-11-25' });
    createItem({ title: 'c', date: '2026-11-25' });
    createItem({ title: 'culte', kind: 'event', date: '2026-11-25' });
    validateItem(a.id, 30);
    const p = dayProgress(expandRange(store.state, '2026-11-25', '2026-11-25'));
    expect(p).toEqual({ total: 3, done: 1, remaining: 2, pct: 33 });
  });
});

describe('Récurrences', () => {
  const mkSeries = () => createItem(
    { title: 'Prière', date: '2026-11-23', start: '08:00', duration: 15 },
    { freq: 'daily', interval: 1 },
  ) as Series;

  it('génère les occurrences sans doublon après modification', () => {
    const s = mkSeries();
    let week = expandRange(store.state, '2026-11-23', '2026-11-29');
    expect(week).toHaveLength(7);
    const wed = week.find((i) => i.date === '2026-11-25')!;
    updateItem(wed.id, { start: '08:30' }, 'one');
    week = expandRange(store.state, '2026-11-23', '2026-11-29');
    expect(week).toHaveLength(7);
    expect(week.find((i) => i.date === '2026-11-25')!.start).toBe('08:30');
    expect(week.filter((i) => i.date === '2026-11-24')[0].start).toBe('08:00');
    expect(s.id).toBeTruthy();
  });
  it('supprimer une occurrence ne supprime pas la série', () => {
    mkSeries();
    const wed = expandRange(store.state, '2026-11-25', '2026-11-25')[0];
    deleteItem(wed.id, 'one');
    expect(expandRange(store.state, '2026-11-25', '2026-11-25')).toHaveLength(0);
    expect(expandRange(store.state, '2026-11-23', '2026-11-29')).toHaveLength(6);
  });
  it('modifier les occurrences futures conserve le passé et l’historique validé', () => {
    mkSeries();
    const mon = expandRange(store.state, '2026-11-23', '2026-11-23')[0];
    validateItem(mon.id, 15);
    const thu = expandRange(store.state, '2026-11-26', '2026-11-26')[0];
    updateItem(thu.id, { start: '07:45' }, 'future');
    const week = expandRange(store.state, '2026-11-23', '2026-11-29');
    expect(week).toHaveLength(7);
    expect(week.filter((i) => i.date! < '2026-11-26').every((i) => i.start === '08:00')).toBe(true);
    expect(week.filter((i) => i.date! >= '2026-11-26').every((i) => i.start === '07:45')).toBe(true);
    expect(week.find((i) => i.date === '2026-11-23')!.status).toBe('done');
  });
  it('supprimer la série entière garde les occurrences déjà réalisées', () => {
    mkSeries();
    const mon = expandRange(store.state, '2026-11-23', '2026-11-23')[0];
    validateItem(mon.id, 15);
    const fri = expandRange(store.state, '2026-11-27', '2026-11-27')[0];
    deleteItem(fri.id, 'all');
    const week = expandRange(store.state, '2026-11-23', '2026-11-29');
    expect(week).toHaveLength(1);
    expect(week[0].status).toBe('done');
  });
  it('hebdomadaire sur certains jours et tous les X jours', () => {
    createItem({ title: 'Église', kind: 'event', date: '2026-11-22' }, { freq: 'weekly', interval: 1, weekdays: [0, 1] });
    createItem({ title: 'Cheveux', date: '2026-11-23' }, { freq: 'interval', interval: 3 });
    const items = expandRange(store.state, '2026-11-23', '2026-12-06');
    expect(items.filter((i) => i.title === 'Église').map((i) => i.date)).toEqual(['2026-11-23', '2026-11-29', '2026-11-30', '2026-12-06']);
    expect(items.filter((i) => i.title === 'Cheveux').map((i) => i.date)).toEqual(['2026-11-23', '2026-11-26', '2026-11-29', '2026-12-02', '2026-12-05']);
  });
});

describe('Projets', () => {
  it('progression = étapes validées / étapes totales (4/10 = 40 %)', () => {
    const p = store.create('projects', { title: 'P', status: 'active', type: 'standard', deadline: '2026-12-31' } as any);
    const steps = Array.from({ length: 10 }, (_, i) => createItem({ title: `É${i}`, projectId: p.id, date: '2026-12-01' }) as Item);
    steps.slice(0, 4).forEach((s) => validateItem(s.id, 30));
    expect(projectHealth(store.state, p).pct).toBe(40);
  });
  it('une étape datée apparaît dans le calendrier ; la déplacer met à jour le projet', () => {
    const p = store.create('projects', { title: 'P', status: 'active', type: 'standard' } as any);
    const s = createItem({ title: 'Tournage', projectId: p.id, date: '2026-12-02' }) as Item;
    expect(expandRange(store.state, '2026-12-02', '2026-12-02')[0].projectId).toBe(p.id);
    moveItem(s.id, '2026-12-03', '10:00');
    const st = store.list('items').find((i) => i.projectId === p.id)!;
    expect(st.date).toBe('2026-12-03');
  });
  it('détecte les projets en retard et bloqués', () => {
    const p = store.create('projects', { title: 'P', status: 'active', type: 'standard', deadline: '2026-11-20' } as any);
    createItem({ title: 'x', projectId: p.id });
    expect(projectHealth(store.state, p).late).toBe(true);
    const q = store.create('projects', { title: 'Q', status: 'active', type: 'standard' } as any);
    createItem({ title: 'y', projectId: q.id, status: 'blocked' });
    expect(projectHealth(store.state, q).blocked).toBe(true);
  });
});

describe('Habitudes et objectifs chiffrés', () => {
  it('séances de sport : 2 validées sur 4 = 50 %', () => {
    const hyrox = store.list('habits').find((h) => h.name === 'Séance HYROX')!;
    const run = store.list('habits').find((h) => h.name === 'Running')!;
    toggleHabit(hyrox.id, '2026-11-23');
    toggleHabit(run.id, '2026-11-24');
    const goal = store.list('goals').find((g) => g.source === 'sportSessions')!;
    expect(goalProgress(store.state, goal)).toMatchObject({ value: 2, target: 4, pct: 50 });
    toggleHabit(run.id, '2026-11-24'); // décoche
    expect(goalProgress(store.state, goal).value).toBe(1);
    addHabitCount(run.id, '2026-11-24', 1);
    expect(goalProgress(store.state, goal).value).toBe(2);
  });
  it('une séance planifiée non validée ne compte pas', () => {
    const run = store.list('habits').find((h) => h.name === 'Running')!;
    createItem({ title: 'Running', date: '2026-11-24', start: '18:00', duration: 60, habitId: run.id });
    const goal = store.list('goals').find((g) => g.source === 'sportSessions')!;
    expect(goalProgress(store.state, goal).value).toBe(0);
    const it = store.list('items').find((i) => i.habitId === run.id)!;
    validateItem(it.id, 60);
    expect(goalProgress(store.state, goal).value).toBe(1);
  });
});

describe('Persistance', () => {
  it('les données sont relues après fermeture / réouverture', async () => {
    const t = createItem({ title: 'RDV Inès', kind: 'appointment', date: '2026-11-27', start: '11:00', duration: 120 }) as Item;
    validateItem(t.id, 110);
    await store.flushed();
    const s2 = await reopen(factory);
    const back = s2.get('items', t.id)!;
    expect(back.title).toBe('RDV Inès');
    expect(back.status).toBe('done');
    expect(back.actualMinutes).toBe(110);
  });
  it('toute modification est mise en file d’envoi pour la synchronisation', async () => {
    const t = createItem({ title: 'x' }) as Item;
    await store.flushed();
    const ob = await store.db.outbox();
    expect(ob.map((e) => e.id)).toContain(t.id);
  });
});
