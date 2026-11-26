// LX Academy Présentiel — phase 1 (fondations). Données fictives uniquement.
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { freshStore, reopen } from './helpers';
import { seedAcademy, runMigrations } from '../src/data/migrations';
import { ACADEMY_SEED_STAMP, AC_DEFAULT_TRAINER_ID, AC_DEFAULT_VENUE_ID } from '../src/data/academyDefaults';
import { dayConsistency, defaultTrainer, euros, missingSetup, parseEuros, setDefault, updateModule, updateOfferTerms, offerPedagogicalMin } from '../src/logic/academy';
import { validateExport, exportData } from '../src/data/sync';
import { LocalDB } from '../src/data/db';
import { Store } from '../src/data/store';
import { COLLECTIONS } from '../src/data/types';

describe('LX Academy — données de départ', () => {
  it('crée le catalogue (4 offres), les 15 modules, la formatrice et le lieu par défaut', async () => {
    const { store } = await freshStore();
    const before = { items: store.list('items').length, categories: store.list('categories').length, habits: store.list('habits').length };
    seedAcademy(store);
    const offers = store.list('acOffers');
    expect(offers.map((o) => [o.title, o.priceCents, o.capacity]).sort()).toEqual([
      ['Coaching privé Duo — 1 journée', 35000, 2],
      ['Coaching privé Duo — 2 journées', 65000, 2],
      ['Coaching privé Solo — 1 journée', 50000, 1],
      ['Coaching privé Solo — 2 journées', 95000, 1],
    ]);
    for (const o of offers) {
      expect([o.startTime, o.endTime, o.lunchMin, o.pedagogicalMinPerDay]).toEqual(['09:00', '17:00', 30, 450]);
      expect(dayConsistency(o)).toBeNull();
    }
    expect(offerPedagogicalMin(store.get('acOffers', 'ac-offer-solo-2j')!)).toBe(900);
    const modules = store.list('acModules');
    expect(modules).toHaveLength(15);
    expect(modules.find((m) => m.code === 'M04')?.title).toBe('Manucure russe');
    // aucun contenu pédagogique inventé
    expect(modules.every((m) => !m.content && !m.durationMin && !m.evaluationCriteria)).toBe(true);
    expect(defaultTrainer(store.state)?.id).toBe(AC_DEFAULT_TRAINER_ID);
    expect(store.get('acVenues', AC_DEFAULT_VENUE_ID)?.isDefault).toBe(true);
    // rien d'existant n'est touché
    expect({ items: store.list('items').length, categories: store.list('categories').length, habits: store.list('habits').length }).toEqual(before);
  });

  it('est sans effet si on la relance, et ne recrée jamais une fiche supprimée ou modifiée', async () => {
    const { store } = await freshStore();
    expect(seedAcademy(store)).toBe(22);
    store.remove('acModules', 'ac-module-m15');
    store.update('acModules', 'ac-module-m01', { title: 'Hygiène (ma version)' });
    expect(seedAcademy(store)).toBe(0);
    runMigrations(store);
    expect(store.get('acModules', 'ac-module-m15')).toBeUndefined();
    expect(store.get('acModules', 'ac-module-m01')!.title).toBe('Hygiène (ma version)');
  });

  it('les fiches de départ portent un horodatage ancien : une modification faite ailleurs gagne toujours', async () => {
    const { store } = await freshStore();
    seedAcademy(store);
    expect(store.get('acOffers', 'ac-offer-solo-1j')!.updatedAt).toBe(ACADEMY_SEED_STAMP);
    const edited = store.update('acOffers', 'ac-offer-solo-1j', { title: 'x' })!;
    expect(edited.updatedAt > ACADEMY_SEED_STAMP).toBe(true);
  });

  it('les données Academy sont conservées après fermeture et réouverture', async () => {
    const { store, factory } = await freshStore({ name: 'reopen-ac' });
    seedAcademy(store);
    store.update('acVenues', AC_DEFAULT_VENUE_ID, { address: '1 rue Fictive, 51100 Reims' });
    await store.flushed();
    const again = await reopen(factory, 'reopen-ac');
    expect(again.get('acVenues', AC_DEFAULT_VENUE_ID)!.address).toBe('1 rue Fictive, 51100 Reims');
    expect(again.list('acModules')).toHaveLength(15);
  });

  it('mise à jour d’une base existante (version précédente de l’app) : rien n’est perdu', async () => {
    const factory = new IDBFactory();
    // base « v2 » telle qu'avant LX Academy, avec une tâche dedans
    await new Promise<void>((resolve, reject) => {
      const open = factory.open('old', 2);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const c of COLLECTIONS.filter((c) => !c.startsWith('ac'))) db.createObjectStore(c, { keyPath: 'id' });
        for (const s of ['outbox', 'conflicts']) db.createObjectStore(s, { keyPath: 'key' });
        db.createObjectStore('meta');
        db.createObjectStore('media');
        open.transaction!.objectStore('items').put({ id: 't1', title: 'Tâche existante', kind: 'task', priority: 'important', status: 'todo', createdAt: 'x', updatedAt: 'x' });
      };
      open.onsuccess = () => { open.result.close(); resolve(); };
      open.onerror = () => reject(open.error);
    });
    const store = new Store(new LocalDB('old', factory));
    await store.init({ seed: false });
    expect(store.get('items', 't1')?.title).toBe('Tâche existante');
    seedAcademy(store);
    await store.flushed();
    expect(store.list('acOffers')).toHaveLength(4);
  });
});

describe('Retour à une version précédente de l’app', () => {
  it('une base créée par une version plus récente s’ouvre sans rien perdre, y compris les tiroirs inconnus', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const open = factory.open('future', 9); // version « future » de l'app
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const c of COLLECTIONS) db.createObjectStore(c, { keyPath: 'id' });
        db.createObjectStore('acFutureThing', { keyPath: 'id' }); // tiroir inconnu de cette version
        for (const s of ['outbox', 'conflicts']) db.createObjectStore(s, { keyPath: 'key' });
        db.createObjectStore('meta');
        db.createObjectStore('media');
        open.transaction!.objectStore('items').put({ id: 't1', title: 'Tâche', kind: 'task', priority: 'important', status: 'todo', createdAt: 'x', updatedAt: 'x' });
        open.transaction!.objectStore('acFutureThing').put({ id: 'f1', note: 'donnée d’une version future' });
      };
      open.onsuccess = () => { open.result.close(); resolve(); };
      open.onerror = () => reject(open.error);
    });
    const db = new LocalDB('future', factory);
    const store = new Store(db);
    await store.init({ seed: false });
    expect(store.get('items', 't1')?.title).toBe('Tâche');
    store.create('items', { title: 'Nouvelle', kind: 'task', priority: 'important', status: 'todo' } as any);
    await store.flushed();
    await db.close();
    // le tiroir inconnu est intact
    const kept = await new Promise<any>((resolve) => {
      const open = factory.open('future');
      open.onsuccess = () => { const r = open.result.transaction('acFutureThing').objectStore('acFutureThing').get('f1'); r.onsuccess = () => { resolve(r.result); open.result.close(); }; };
    });
    expect(kept?.note).toBe('donnée d’une version future');
  });

  it('une base « future » à laquelle il manque un tiroir de cette version est complétée, sans perte', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve) => {
      const open = factory.open('future2', 9);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('items', { keyPath: 'id' });
        open.transaction!.objectStore('items').put({ id: 't1', title: 'Gardée', kind: 'task', priority: 'important', status: 'todo', createdAt: 'x', updatedAt: 'x' });
      };
      open.onsuccess = () => { open.result.close(); resolve(); };
    });
    const store = new Store(new LocalDB('future2', factory));
    await store.init({ seed: false });
    expect(store.get('items', 't1')?.title).toBe('Gardée');
    seedAcademy(store);
    await store.flushed();
    expect(store.list('acModules')).toHaveLength(15);
  });
});

describe('LX Academy — catalogue et tarifs', () => {
  it('changer un tarif crée une nouvelle version et garde l’ancienne (aucun effet rétroactif)', async () => {
    const { store } = await freshStore();
    seedAcademy(store);
    const id = 'ac-offer-solo-1j';
    updateOfferTerms(store, id, { title: 'Coaching privé Solo — 1 jour' });
    expect(store.get('acOffers', id)!.version).toBe(1); // changer l'intitulé ne crée pas de version
    updateOfferTerms(store, id, { priceCents: 55000 });
    const o = store.get('acOffers', id)!;
    expect(o.priceCents).toBe(55000);
    expect(o.version).toBe(2);
    expect(o.history).toHaveLength(1);
    expect(o.history[0]).toMatchObject({ version: 1, priceCents: 50000, capacity: 1, days: 1 });
    updateOfferTerms(store, id, { priceCents: 55000 }); // même valeur : rien ne change
    expect(store.get('acOffers', id)!.version).toBe(2);
  });

  it('montants et contrôle des horaires', () => {
    expect(euros(50000)).toBe('500 €');
    expect(euros(35050)).toBe('350,50 €');
    expect(euros(95000).replace(/\s/g, ' ')).toBe('950 €');
    expect(parseEuros('350,5')).toBe(35050);
    expect(parseEuros('1 200 €')).toBe(120000);
    expect(parseEuros('abc')).toBeNull();
    expect(dayConsistency({ startTime: '09:00', endTime: '17:00', lunchMin: 30, pedagogicalMinPerDay: 420 })).toMatch(/7 h 30/);
    expect(dayConsistency({ startTime: '17:00', endTime: '09:00', lunchMin: 30, pedagogicalMinPerDay: 450 })).toMatch(/après/);
  });
});

describe('LX Academy — modalité des offres (E10 : présentiel, en ligne, mixte)', () => {
  const ORIGINAL_KEYS = ['active', 'capacity', 'code', 'createdAt', 'days', 'endTime', 'format', 'history', 'id', 'lunchMin', 'order', 'pedagogicalMinPerDay', 'priceCents', 'startTime', 'title', 'type', 'updatedAt', 'version'];

  it('les 4 offres existantes restent intactes : mêmes champs, mêmes tarifs, présentiel par défaut', async () => {
    const { academyOffers } = await import('../src/data/academyDefaults');
    const { modalityOf, termsSummary, offerPedagogicalMin } = await import('../src/logic/academy');
    const offers = academyOffers();
    expect(offers).toHaveLength(4);
    for (const o of offers) {
      expect(Object.keys(o).sort()).toEqual(ORIGINAL_KEYS); // aucun champ ajouté aux fiches existantes
      expect(modalityOf(o)).toBe('onsite');
      expect(o.history).toEqual([]);
    }
    expect(offers.map((o) => [o.id, o.priceCents, o.capacity, o.days, o.version])).toEqual([
      ['ac-offer-solo-1j', 50000, 1, 1, 1], ['ac-offer-solo-2j', 95000, 1, 2, 1], ['ac-offer-duo-1j', 35000, 2, 1, 1], ['ac-offer-duo-2j', 65000, 2, 2, 1],
    ]);
    expect(termsSummary(offers[0])).toBe('1 stagiaire · 1 j · 9 h–17 h · 7 h 30 au total');
    expect(offerPedagogicalMin(offers[1])).toBe(900);
  });

  it('un changement de tarif d’une offre existante garde un historique de la même forme qu’avant', async () => {
    const { store } = await freshStore();
    seedAcademy(store);
    updateOfferTerms(store, 'ac-offer-duo-2j', { priceCents: 68000 });
    updateOfferTerms(store, 'ac-offer-duo-2j', { priceCents: 70000 });
    const o = store.get('acOffers', 'ac-offer-duo-2j')!;
    expect([o.priceCents, o.version, o.modality]).toEqual([70000, 3, undefined]);
    expect(o.history.map((h) => h.priceCents)).toEqual([65000, 68000]);
    for (const h of o.history) expect(Object.keys(h).sort()).toEqual(['capacity', 'days', 'endTime', 'lunchMin', 'pedagogicalMinPerDay', 'priceCents', 'startTime', 'validFrom', 'validUntil', 'version']);
  });

  it('une offre EN LIGNE fonctionne sans journée, sans horaires et sans session présentielle', async () => {
    const { termsOf, offerPedagogicalMin, termsSummary, modalityOf } = await import('../src/logic/academy');
    const { store, factory } = await freshStore({ name: 'online-offer' });
    seedAcademy(store);
    const o = store.create('acOffers', {
      title: 'Mini-formation fictive', code: 'offre-fictive', type: 'mini_course', format: 'solo', modality: 'online',
      priceCents: 4900, accessDays: 365, lessons: 8, onlineMinutes: 180, active: true, order: 10, version: 1, history: [],
    });
    expect(o.days).toBeUndefined();
    expect(o.startTime).toBeUndefined();
    expect(o.capacity).toBeUndefined();
    expect(modalityOf(o)).toBe('online');
    expect(termsOf(o)).toEqual({ priceCents: 4900, accessDays: 365, lessons: 8, onlineMinutes: 180 });
    expect(offerPedagogicalMin(o)).toBe(180);
    expect(dayConsistency(o)).toBeNull(); // rien à contrôler sans horaires
    expect(termsSummary(o)).toBe('En ligne · accès 365 j · 8 leçons · 3 h au total');

    updateOfferTerms(store, o.id, { priceCents: 5900 });
    const v2 = store.get('acOffers', o.id)!;
    expect([v2.priceCents, v2.version]).toEqual([5900, 2]);
    expect(v2.history[0]).toMatchObject({ priceCents: 4900, accessDays: 365, lessons: 8, onlineMinutes: 180, version: 1 });
    expect(v2.history[0].days).toBeUndefined();

    await store.flushed();
    const again = await reopen(factory, 'online-offer');
    expect(again.get('acOffers', o.id)!.modality).toBe('online');
    expect(again.list('acOffers')).toHaveLength(5); // les 4 offres + la nouvelle, sans doublon
    expect((exportData(again).data.acOffers as any)[o.id].priceCents).toBe(5900);
  });

  it('offre mixte : journées en présentiel + partie en ligne ; accès sans limite affiché', async () => {
    const { offerPedagogicalMin, termsSummary } = await import('../src/logic/academy');
    const hybrid = { modality: 'hybrid' as const, priceCents: 120000, capacity: 4, days: 1, startTime: '09:00', endTime: '17:00', lunchMin: 30, pedagogicalMinPerDay: 450, onlineMinutes: 120 };
    expect(offerPedagogicalMin(hybrid)).toBe(570);
    expect(termsSummary(hybrid)).toBe('Mixte (présentiel + en ligne) · 4 stagiaires · 1 j · 9 h–17 h · accès sans limite · 9 h 30 au total');
    // une offre en ligne qui contiendrait encore des journées ne les compte pas
    expect(offerPedagogicalMin({ modality: 'online', days: 2, pedagogicalMinPerDay: 450 })).toBeUndefined();
  });
});

describe('LX Academy — historique des modules pédagogiques', () => {
  it('chaque modification du contenu garde la version précédente EN ENTIER', async () => {
    const { store } = await freshStore();
    seedAcademy(store);
    const id = 'ac-module-m04';
    const v1 = store.get('acModules', id)!;
    expect(v1.version).toBe(1);

    let r = updateModule(store, id, { durationMin: 120, content: 'Contenu fictif A' });
    expect(r.changed).toBe(true);
    expect(r.record?.version).toBe(2);

    r = updateModule(store, id, { title: 'Intitulé fictif', content: 'Contenu fictif B', material: 'Matériel fictif' });
    expect(r.record?.version).toBe(3);

    const m = store.get('acModules', id)!;
    expect(m).toMatchObject({ title: 'Intitulé fictif', content: 'Contenu fictif B', durationMin: 120, material: 'Matériel fictif', version: 3 });
    expect(m.history).toHaveLength(2);
    // v1 : le module de départ, tel quel
    expect(m.history![0]).toMatchObject({ version: 1, title: v1.title, objective: v1.objective, versionDate: v1.versionDate });
    expect(m.history![0].content).toBeUndefined();
    // v2 : tous les champs de l'époque, y compris ceux modifiés ensuite
    expect(m.history![1]).toMatchObject({ version: 2, title: v1.title, objective: v1.objective, content: 'Contenu fictif A', durationMin: 120 });
    expect(m.history![1].material).toBeUndefined();
    expect(m.history![1].replacedAt >= m.history![0].replacedAt).toBe(true);
  });

  it('un enregistrement sans changement de contenu ne crée pas de version ; archiver non plus', async () => {
    const { store } = await freshStore();
    seedAcademy(store);
    const id = 'ac-module-m01';
    const cur = store.get('acModules', id)!;
    expect(updateModule(store, id, { ...cur }).changed).toBe(false);
    expect(updateModule(store, id, { status: 'archived' }).changed).toBe(false);
    expect(updateModule(store, id, { content: '' }).changed).toBe(false);
    const m = store.get('acModules', id)!;
    expect(m.version).toBe(1);
    expect(m.history ?? []).toHaveLength(0);
    expect(m.status).toBe('archived');
  });

  it('un formulaire resté ouvert ne peut pas effacer l’historique enregistré entre-temps', async () => {
    const { store } = await freshStore();
    seedAcademy(store);
    const id = 'ac-module-m02';
    const stale = { ...store.get('acModules', id)! }; // fiche ouverte avant la modification
    updateModule(store, id, { content: 'Contenu fictif 1' });
    updateModule(store, id, { ...stale, content: 'Contenu fictif 2' });
    const m = store.get('acModules', id)!;
    expect(m.version).toBe(3);
    expect(m.history!.map((h) => [h.version, h.content])).toEqual([[1, undefined], [2, 'Contenu fictif 1']]);
  });

  it('l’historique est conservé après fermeture et dans l’export de sauvegarde', async () => {
    const { store, factory } = await freshStore({ name: 'reopen-mod' });
    seedAcademy(store);
    updateModule(store, 'ac-module-m05', { content: 'Contenu fictif' });
    await store.flushed();
    const again = await reopen(factory, 'reopen-mod');
    expect(again.get('acModules', 'ac-module-m05')!.history).toHaveLength(1);
    const exported = exportData(again);
    expect((exported.data.acModules as any)['ac-module-m05'].history[0].version).toBe(1);
  });
});

describe('LX Academy — formatrices, lieux, informations à compléter', () => {
  it('une seule formatrice par défaut, et on peut en ajouter d’autres', async () => {
    const { store } = await freshStore();
    seedAcademy(store);
    const other = store.create('acTrainers', { name: 'Formatrice Fictive', active: true, order: 1 });
    expect(defaultTrainer(store.state)?.id).toBe(AC_DEFAULT_TRAINER_ID);
    setDefault(store, 'acTrainers', other.id);
    expect(store.list('acTrainers').filter((t) => t.isDefault).map((t) => t.id)).toEqual([other.id]);
  });

  it('signale les informations manquantes sans rien inventer', async () => {
    const { store } = await freshStore();
    seedAcademy(store);
    expect(missingSetup(store.state)).toHaveLength(3);
    store.update('acTrainers', AC_DEFAULT_TRAINER_ID, { name: 'Prénom Nom' });
    store.update('acVenues', AC_DEFAULT_VENUE_ID, { address: '1 rue Fictive' });
    store.update('acSettings', 'ac-settings', { identity: { legalName: 'Prénom Nom' } });
    expect(missingSetup(store.state)).toEqual([]);
  });
});

describe('Sauvegardes', () => {
  it('une sauvegarde faite AVANT LX Academy reste restaurable', async () => {
    const { store } = await freshStore();
    const file: any = structuredClone(exportData(store));
    for (const c of COLLECTIONS) if (c.startsWith('ac')) delete file.data[c];
    expect(validateExport(file)).toBe(true);
    expect(file.data.acOffers).toEqual({});
  });

  it('un fichier sans les données essentielles est refusé', () => {
    expect(validateExport({ app: 'lx-planner', data: { items: {} } })).toBe(false);
    expect(validateExport({ app: 'autre', data: {} })).toBe(false);
  });

  it('les données Academy sont incluses dans l’export', async () => {
    const { store } = await freshStore();
    seedAcademy(store);
    expect(Object.keys(exportData(store).data.acModules)).toHaveLength(15);
  });
});
