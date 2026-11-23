import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { freshStore, reopen } from './helpers';
import { LocalDB } from '../src/data/db';
import {
  checksFor, contentFromIdea, contentProgress, datesFromFeedOrder, distributeDates, feedFromContents, moveTile, parseIdeaContent, shootDays,
} from '../src/logic/contentPlan';

import type { ContentPiece, FeedSim, Idea } from '../src/data/types';
import type { Store } from '../src/data/store';

let store: Store;
let factory: IDBFactory;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T10:00:00'));
  ({ store, factory } = await freshStore());
});
afterEach(() => vi.useRealTimers());

const piece = (p: Partial<ContentPiece>) => store.create('contents', { title: 'x', format: 'reel', platforms: ['instagram'], checks: {}, ...p } as ContentPiece);

describe('Planifier un mois de contenu', () => {
  it('30 scripts tournés le 24/11, publiés 1 par jour en décembre', () => {
    const dates = distributeDates('2026-12-01', 30, { mode: 'daily' });
    expect(dates[0]).toBe('2026-12-01');
    expect(dates[29]).toBe('2026-12-30');
    dates.forEach((d, i) => piece({ title: `Script ${i + 1}`, shootDate: '2026-11-24', publishDate: d }));
    const day = shootDays(store.state).get('2026-11-24')!;
    expect(day).toHaveLength(30);
    expect(day[0].publishDate).toBe('2026-12-01'); // dans l'ordre de publication
  });
  it('rythmes : tous les 2 jours, jours choisis, sans dimanche', () => {
    expect(distributeDates('2026-12-01', 3, { mode: 'every', every: 2 })).toEqual(['2026-12-01', '2026-12-03', '2026-12-05']);
    expect(distributeDates('2026-11-30', 4, { mode: 'weekdays', weekdays: [1, 3, 5] })).toEqual(['2026-11-30', '2026-12-02', '2026-12-04', '2026-12-07']);
    expect(distributeDates('2026-12-05', 3, { mode: 'daily', skipSundays: true })).toEqual(['2026-12-05', '2026-12-07', '2026-12-08']);
  });
});

describe('Fiche contenu et cases à cocher', () => {
  it('étapes adaptées au format et aux plateformes', () => {
    expect(checksFor({ format: 'reel', platforms: ['instagram', 'tiktok'] })).toEqual(['script', 'shot', 'edited', 'caption', 'cover', 'posted_instagram', 'posted_tiktok']);
    expect(checksFor({ format: 'photo', platforms: ['instagram'] })).toEqual(['shot', 'edited', 'caption', 'posted_instagram']);
    const p = piece({ checks: { script: true, shot: true } });
    expect(contentProgress(p)).toMatchObject({ done: 2, total: 6 });
  });
  it('une ancienne idée (texte à sections) devient un contenu avec accroche, script, CTA, légende, objectif et pilier', () => {
    const content = 'ACCROCHE\nMon accroche\n\nSCRIPT\nLigne 1\nLigne 2\n\nLÉGENDE\nMa légende\n\nCTA\nCommente !\n\nNOTES\nNote';
    expect(parseIdeaContent(content)).toMatchObject({ hook: 'Mon accroche', script: 'Ligne 1\nLigne 2', caption: 'Ma légende', cta: 'Commente !', notes: 'Note' });
    const idea = { id: 'i1', title: 'Idée', type: 'reel', content, tags: ['Éducation', 'Confiance'], status: 'idea' } as Idea;
    expect(contentFromIdea(idea)).toMatchObject({ format: 'reel', goal: 'trust', pillar: 'education', hook: 'Mon accroche', cta: 'Commente !', checks: { script: true, caption: true } });
  });
});

describe('Aperçu du feed', () => {
  it('feed prévu : couvertures, la publication la plus récente en haut à gauche, sans stories', () => {
    piece({ title: 'A', publishDate: '2026-12-01', coverMediaId: 'm1' });
    piece({ title: 'B', publishDate: '2026-12-03', coverMediaId: 'm2' });
    piece({ title: 'C', publishDate: '2026-12-02', coverMediaId: 'm3', format: 'story' });
    piece({ title: 'D', publishDate: '2026-12-04' }); // sans couverture
    expect(feedFromContents(store.list('contents')).map((t) => t.label)).toEqual(['B', 'A']);
  });
  it('réordonner puis reporter l’ordre sur les dates (sans rien appliquer seul)', () => {
    const a = piece({ title: 'A', publishDate: '2026-12-01', coverMediaId: 'm1' });
    const b = piece({ title: 'B', publishDate: '2026-12-02', coverMediaId: 'm2' });
    const c = piece({ title: 'C', publishDate: '2026-12-03', coverMediaId: 'm3' });
    let tiles = feedFromContents(store.list('contents')); // C, B, A
    tiles = moveTile(tiles, 2, 0); // A, C, B
    const proposal = datesFromFeedOrder(tiles, store.state.contents);
    expect(proposal).toEqual(expect.arrayContaining([
      { id: a.id, title: 'A', from: '2026-12-01', to: '2026-12-03' },
      { id: c.id, title: 'C', from: '2026-12-03', to: '2026-12-02' },
      { id: b.id, title: 'B', from: '2026-12-02', to: '2026-12-01' },
    ]));
    expect(store.get('contents', a.id)!.publishDate).toBe('2026-12-01');
  });
  it('les simulations et contenus sont conservés après fermeture', async () => {
    piece({ title: 'Persistant', shootDate: '2026-11-24' });
    store.create('feeds', { name: 'Option A', aspect: '3:4', tiles: [{ id: 't1', mediaId: 'm1' }, { id: 't2', mediaId: 'm2' }] } as FeedSim);
    await store.flushed();
    const s2 = await reopen(factory);
    expect(s2.list('contents').map((c) => c.title)).toContain('Persistant');
    expect(s2.list('feeds')[0].tiles.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});

describe('Mise à jour de la base existante', () => {
  it('une base créée avant cette version reçoit les nouveaux tiroirs sans perte', async () => {
    const f = new IDBFactory();
    await new Promise<void>((res) => {
      const open = f.open('old', 1);
      open.onupgradeneeded = () => { open.result.createObjectStore('items', { keyPath: 'id' }).put({ id: 'x', title: 'ancienne tâche', updatedAt: '1' }); };
      open.onsuccess = () => { open.result.close(); res(); };
    });
    const db = new LocalDB('old', f);
    const state = await db.loadAll();
    expect(state.items.x.title).toBe('ancienne tâche');
    expect(state.contents).toEqual({});
    await db.putMedia('m', new Blob(['img']));
    expect(await db.getMedia('m')).toBeTruthy();
  });
});

describe('Calendrier de contenu dans le planning du quotidien', () => {
  it('publication et tournage apparaissent dans la journée, sans copie', async () => {
    const { expandRange } = await import('../src/logic/recurrence');
    const c = piece({ title: 'Reel russe', shootDate: '2026-11-24', publishDate: '2026-11-26', publishTime: '18:00' });
    piece({ title: 'Autre', shootDate: '2026-11-24' });
    const day24 = expandRange(store.state, '2026-11-24', '2026-11-24');
    expect(day24.map((i) => i.title)).toContain('🎬 Tournage · 2 contenus (0/2)');
    const day26 = expandRange(store.state, '2026-11-26', '2026-11-26');
    const pub = day26.find((i) => i.contentRef?.kind === 'publish')!;
    expect(pub).toMatchObject({ title: '📲 Publier · Reel russe', start: '18:00', status: 'todo', kind: 'task' });
    expect(store.list('items').some((i) => i.title.includes('Reel russe'))).toBe(false); // aucune tâche créée
    expect(c.id).toBeTruthy();
  });

  it('cocher, déplacer, reporter ou retirer depuis le planning modifie la fiche contenu', async () => {
    const { validateItem, moveItem, postponeItem, deleteItem, unvalidateItem } = await import('../src/data/actions');
    const c = piece({ title: 'R', publishDate: '2026-11-26', publishTime: '18:00', platforms: ['instagram', 'tiktok'] });
    validateItem(`cp:${c.id}`, 0);
    expect(store.get('contents', c.id)!.checks).toMatchObject({ posted_instagram: true, posted_tiktok: true });
    unvalidateItem(`cp:${c.id}`);
    expect(store.get('contents', c.id)!.checks.posted_instagram).toBe(false);
    moveItem(`cp:${c.id}`, '2026-11-27', '12:30');
    expect(store.get('contents', c.id)).toMatchObject({ publishDate: '2026-11-27', publishTime: '12:30' });
    postponeItem(`cp:${c.id}`, '2026-12-01');
    expect(store.get('contents', c.id)!.publishDate).toBe('2026-12-01');
    deleteItem(`cp:${c.id}`);
    expect(store.get('contents', c.id)!.publishDate).toBeUndefined(); // revient dans la Banque d'idées
    expect(store.get('contents', c.id)).toBeTruthy(); // la fiche n'est pas supprimée
  });

  it('déplacer une journée de tournage déplace tous ses scripts', async () => {
    const { moveItem } = await import('../src/data/actions');
    piece({ title: 'a', shootDate: '2026-11-24' });
    piece({ title: 'b', shootDate: '2026-11-24' });
    moveItem('cs:2026-11-24', '2026-11-25');
    expect(shootDays(store.state).get('2026-11-25')).toHaveLength(2);
  });

  it('pas d’heures fictives dans les bilans ; réglage pour masquer', async () => {
    const { expandRange } = await import('../src/logic/recurrence');
    const { periodStats } = await import('../src/logic/stats');
    piece({ title: 'p', publishDate: '2026-11-26', checks: { posted_instagram: true } });
    expect(periodStats(store.state, '2026-11-23', '2026-11-29').totals.plannedMin).toBe(0);
    store.update('settings', 'settings', { showContentInPlanning: false });
    expect(expandRange(store.state, '2026-11-26', '2026-11-26')).toHaveLength(0);
  });
});

describe('Annuler une journée de tournage', () => {
  it('retire la date de tournage mais conserve les fiches et leurs textes', async () => {
    const { cancelShootDay, createItem } = await import('../src/data/actions');
    const { expandRange } = await import('../src/logic/recurrence');
    const a = piece({ title: 'A', script: 'Mon script', shootDate: '2026-11-24', publishDate: '2026-12-01', checks: { script: true } });
    const b = piece({ title: 'B', shootDate: '2026-11-24' });
    const other = piece({ title: 'C', shootDate: '2026-11-25' });
    createItem({ kind: 'event', title: 'Journée de tournage · 2 contenus', date: '2026-11-24', start: '09:00', duration: 480 });
    expect(cancelShootDay('2026-11-24')).toBe(2);
    expect(store.get('contents', a.id)).toMatchObject({ title: 'A', script: 'Mon script', publishDate: '2026-12-01', checks: { script: true } });
    expect(store.get('contents', a.id)!.shootDate).toBeUndefined();
    expect(store.get('contents', b.id)!.shootDate).toBeUndefined();
    expect(store.get('contents', other.id)!.shootDate).toBe('2026-11-25'); // autre tournage intact
    expect(expandRange(store.state, '2026-11-24', '2026-11-24')).toHaveLength(0); // plus rien dans le planning ce jour-là
  });
  it('option : remettre aussi les dates de publication à zéro (retour dans la Banque d’idées)', async () => {
    const { cancelShootDay } = await import('../src/data/actions');
    const a = piece({ title: 'A', shootDate: '2026-11-24', publishDate: '2026-12-01', publishTime: '18:00' });
    cancelShootDay('2026-11-24', { alsoPublishDates: true });
    const c = store.get('contents', a.id)!;
    expect([c.shootDate, c.publishDate, c.publishTime]).toEqual([undefined, undefined, undefined]);
    expect(store.list('contents')).toHaveLength(1);
  });
});
