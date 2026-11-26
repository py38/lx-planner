// Synchronisation entre deux appareils, testée contre un serveur SIMULÉ qui reproduit
// la règle du schéma Supabase (dernière modification gagnante + archivage des conflits).
// Ce test ne remplace pas un essai réel sur votre projet Supabase.
import { describe, expect, it } from 'vitest';
import { freshStore } from './helpers';
import { SyncEngine } from '../src/data/sync';
import { setStore } from '../src/data/store';
import { createItem, updateItem, deleteItem } from '../src/data/actions';
import type { Item } from '../src/data/types';

function fakeServer() {
  const rows = new Map<string, any>();
  const conflicts: any[] = [];
  let clock = 0;
  const nextTs = () => new Date(Date.UTC(2030, 0, 1) + ++clock).toISOString();
  const files = new Map<string, Blob>();
  const backups: { id: number; created_at: string; data: any }[] = [];
  const net = { down: false }; // coupure Internet simulée
  const offline = { data: null, error: { message: 'TypeError: Load failed' } };
  const client: any = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, blob: Blob) => { files.set(`${bucket}/${path}`, blob); return { error: null }; },
        download: async (path: string) => {
          const f = files.get(`${bucket}/${path}`);
          return f ? { data: f, error: null } : { data: null, error: { message: 'Object not found' } };
        },
      }),
    },
    from(table: string) {
      if (table === 'record_conflicts') {
        const res = () => (net.down ? offline : { data: structuredClone(conflicts), error: null });
        const q: any = { select: () => q, order: () => q, limit: () => q, then: (ok: any, ko: any) => Promise.resolve(res()).then(ok, ko) };
        return q;
      }
      if (table === 'backups') {
        return {
          insert: (row: any) => {
            const add = () => { if (net.down) return offline; const b = { id: backups.length + 1, created_at: nextTs(), data: JSON.parse(JSON.stringify(row.data)) }; backups.push(b); return { data: { id: b.id }, error: null }; };
            // comme supabase-js : la requête ne part qu'une fois (soit attendue telle quelle, soit via .select().single())
            return { select: () => ({ single: async () => add() }), then: (res: any, rej: any) => Promise.resolve().then(add).then(res, rej) };
          },
          select: () => {
            const filters: ((b: any) => boolean)[] = [];
            const val = (b: any, col: string) => (col === 'id' ? b.id : col.startsWith('data->>') ? b.data?.[col.slice(7)] : undefined);
            const q: any = {
              eq: (col: string, v: unknown) => { filters.push((b) => val(b, col) === v); return q; },
              order: () => q,
              limit: () => q,
              single: async () => (net.down ? offline : { data: { data: structuredClone(backups.find((b) => filters.every((f) => f(b)))?.data) }, error: null }),
              then: (ok: any, ko: any) => Promise.resolve(net.down ? offline : { data: backups.filter((b) => filters.every((f) => f(b))).map((b) => ({ id: b.id })), error: null }).then(ok, ko),
            };
            return q;
          },
        };
      }
      const q: any = { filters: [] as ((r: any) => boolean)[], lim: 1e9 };
      const run = () => {
        const data = [...rows.values()].filter((r) => q.filters.every((f: any) => f(r))).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at)).slice(0, q.lim);
        return q.head ? { count: data.length, error: null } : { data: structuredClone(data), error: null };
      };
      const b: any = {
        upsert: async (rs: any[]) => {
          if (net.down) return offline;
          for (const r of rs) {
            const k = `${r.user_id}|${r.collection}|${r.id}`;
            const old = rows.get(k);
            if (old && r.updated_at < old.updated_at) { conflicts.push({ collection: r.collection, id: r.id, lost: r.data, kept: old.data, at: nextTs() }); continue; }
            rows.set(k, { ...structuredClone(r), server_updated_at: nextTs() });
          }
          return { error: null };
        },
        select: (_c: string, opts?: any) => { q.head = opts?.head; return b; },
        gt: (col: string, v: string) => { q.filters.push((r: any) => r[col] > v); return b; },
        eq: (col: string, v: unknown) => { q.filters.push((r: any) => r[col] === v); return b; },
        order: () => b,
        limit: (n: number) => { q.lim = n; return b; },
        then: (res: any, rej: any) => Promise.resolve(net.down ? offline : run()).then(res, rej),
      };
      return b;
    },
  };
  return { client, rows, conflicts, files, backups, net };
}

async function device(server: ReturnType<typeof fakeServer>, name: string) {
  const { store } = await freshStore({ name });
  const engine = new SyncEngine(store);
  engine.client = server.client;
  engine.session = { user: { id: 'user-1', email: 'x@y.z' } } as any;
  return { store, engine };
}

describe('Synchronisation entre appareils (serveur simulé)', () => {
  it('un nouvel appareil récupère toutes les données du compte, sans doublon de catégories', async () => {
    const server = fakeServer();
    const A = await device(server, 'A');
    setStore(A.store);
    const t = createItem({ title: 'RDV Inès', kind: 'appointment', date: '2026-12-01', start: '10:00' }) as Item;
    await (A.engine as any).linkDevice('upload');
    expect(server.rows.size).toBeGreaterThan(20);

    const B = await device(server, 'B'); // nouvel appareil avec ses propres données de départ
    await (B.engine as any).linkDevice('download');
    expect(B.store.get('items', t.id)?.title).toBe('RDV Inès');
    expect(B.store.list('categories')).toHaveLength(7);
    expect(B.store.list('habits')).toHaveLength(A.store.list('habits').length);
  });

  it('modifications et suppressions se propagent ; le conflit garde la version la plus récente et archive l’autre', async () => {
    const server = fakeServer();
    const A = await device(server, 'A2');
    setStore(A.store);
    const t = createItem({ title: 'Compta', date: '2026-12-02' }) as Item;
    await (A.engine as any).linkDevice('upload');
    const B = await device(server, 'B2');
    await (B.engine as any).linkDevice('download');

    // A modifie puis synchronise ; B récupère
    setStore(A.store);
    updateItem(t.id, { start: '09:30' });
    await A.engine.syncNow();
    await B.engine.syncNow();
    expect(B.store.get('items', t.id)!.start).toBe('09:30');

    // Conflit : A puis B modifient le même élément hors ligne ; B est plus récent
    setStore(A.store);
    updateItem(t.id, { title: 'Compta (A)' });
    await new Promise((r) => setTimeout(r, 5));
    setStore(B.store);
    updateItem(t.id, { title: 'Compta (B)' });
    await B.engine.syncNow();
    await A.engine.syncNow();
    await B.engine.syncNow();
    expect(A.store.get('items', t.id)!.title).toBe('Compta (B)');
    expect(B.store.get('items', t.id)!.title).toBe('Compta (B)');
    // la version perdante est archivée côté serveur (table record_conflicts) : rien n'est perdu silencieusement
    expect(server.conflicts.some((c: any) => c.lost.title === 'Compta (A)')).toBe(true);

    // Suppression propagée
    setStore(A.store);
    deleteItem(t.id);
    await A.engine.syncNow();
    await B.engine.syncNow();
    expect(B.store.get('items', t.id)).toBeUndefined();
  });

  it('hors ligne : la file d’envoi est conservée et vidée au retour', async () => {
    const server = fakeServer();
    const A = await device(server, 'A3');
    setStore(A.store);
    await (A.engine as any).linkDevice('upload');
    const failing = { from: () => ({ upsert: async () => ({ error: { message: 'Failed to fetch' } }) }) };
    A.engine.client = failing as any;
    createItem({ title: 'Saisi sans réseau' });
    await A.store.flushed();
    await A.engine.syncNow();
    expect(A.engine.status.phase).toBe('error');
    expect((await A.store.db.outbox()).length).toBeGreaterThan(0);
    A.engine.client = server.client;
    await A.engine.syncNow();
    expect(await A.store.db.outbox()).toHaveLength(0);
    expect([...server.rows.values()].some((r) => r.data.title === 'Saisi sans réseau')).toBe(true);
  });

  it('remplacer le compte par cet appareil : pas de doublons des réglages de départ, l’iPhone suit', async () => {
    const server = fakeServer();
    const phone = await device(server, 'P'); // iPhone : réglages de départ seulement
    await (phone.engine as any).linkDevice('upload');
    const chrome = await device(server, 'C'); // Chrome : ses vraies données (autres identifiants de départ)
    setStore(chrome.store);
    const t = createItem({ title: 'call comptable', date: '2026-11-23' }) as Item;
    await (chrome.engine as any).linkDevice('replace');
    // le compte = exactement Chrome
    const active = [...server.rows.values()].filter((r) => !r.deleted);
    expect(active.filter((r) => r.collection === 'categories')).toHaveLength(7);
    expect(active.filter((r) => r.collection === 'habits')).toHaveLength(chrome.store.list('habits').length);
    expect(active.some((r) => r.id === t.id)).toBe(true);
    // l'iPhone se synchronise : ses doublons disparaissent, il reçoit les données de Chrome
    await phone.engine.syncNow();
    expect(phone.store.list('categories')).toHaveLength(7);
    expect(phone.store.list('habits')).toHaveLength(chrome.store.list('habits').length);
    expect(phone.store.get('items', t.id)?.title).toBe('call comptable');
    expect(new Set(phone.store.list('categories').map((c) => c.id))).toEqual(new Set(chrome.store.list('categories').map((c) => c.id)));
  });

  it('images : envoyées depuis Chrome, téléchargées sur l’iPhone à l’affichage, puis gardées hors connexion', async () => {
    const { mediaUrl } = await import('../src/data/media');
    const server = fakeServer();
    const chrome = await device(server, 'IMG-C');
    setStore(chrome.store);
    await chrome.store.db.putMedia('img-1', new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));
    await chrome.store.db.putMedia('img-2', new Blob(['feed-bytes'], { type: 'image/jpeg' }));
    chrome.store.create('contents', { title: 'Collab', format: 'reel', platforms: ['instagram'], checks: {}, coverMediaId: 'img-1' } as any);
    chrome.store.create('feeds', { name: 'Option A', aspect: '3:4', tiles: [{ id: 't', mediaId: 'img-2' }] } as any);
    await (chrome.engine as any).linkDevice('upload'); // les images d'avant la synchro partent aussi
    expect([...server.files.keys()].sort()).toEqual(['media/user-1/img-1', 'media/user-1/img-2']);
    expect(await chrome.engine.syncMedia()).toBe(0); // déjà envoyées : pas de renvoi

    const phone = await device(server, 'IMG-P');
    await (phone.engine as any).linkDevice('download');
    setStore(phone.store);
    expect(await phone.store.db.getMedia('img-1')).toBeUndefined();
    (phone.engine as any).installMediaFetcher();
    expect(await mediaUrl('img-1')).toMatch(/^blob:/);
    expect(await phone.store.db.getMedia('img-1')).toBeTruthy(); // gardée sur l'appareil
    expect(await mediaUrl('inexistante')).toBeNull();
  });
});

describe('Restauration d’une sauvegarde (serveur simulé)', () => {
  it('après restauration, la synchronisation reprend : la sauvegarde part vers le compte et l’autre appareil la reçoit, sans rien supprimer', async () => {
    const { exportData, restoreExport, makeSafetyBackup } = await import('../src/data/sync');
    const server = fakeServer();
    const mac = await device(server, 'RS-MAC');
    setStore(mac.store);
    const x = createItem({ title: 'Version sauvegardée', date: '2026-12-03' }) as Item;
    await (mac.engine as any).linkDevice('upload');
    const phone = await device(server, 'RS-PHONE');
    await (phone.engine as any).linkDevice('download');

    const backup = structuredClone(exportData(mac.store)); // sauvegarde
    setStore(mac.store);
    updateItem(x.id, { title: 'Modifiée après la sauvegarde' });
    const y = createItem({ title: 'Créée après la sauvegarde', date: '2026-12-04' }) as Item;
    await mac.engine.syncNow();

    await restoreExport(backup, mac.store, await makeSafetyBackup(mac.store, mac.engine)); // restauration depuis Réglages
    await mac.engine.syncNow();
    expect(await mac.store.db.getMeta('linkedUser')).toBe('user-1'); // l'appareil reste relié au compte
    expect(await mac.store.db.outbox()).toHaveLength(0); // tout est parti vers le compte
    expect(mac.engine.status.phase).toBe('idle');
    expect([...server.rows.values()].find((r) => r.id === x.id)!.data.title).toBe('Version sauvegardée');

    await phone.engine.syncNow();
    expect(phone.store.get('items', x.id)!.title).toBe('Version sauvegardée');
    // rien n'est supprimé : ce qui a été créé après la sauvegarde est conservé partout
    expect(mac.store.get('items', y.id)?.title).toBe('Créée après la sauvegarde');
    expect(phone.store.get('items', y.id)?.title).toBe('Créée après la sauvegarde');
    // et la synchronisation continue normalement ensuite
    setStore(mac.store);
    updateItem(x.id, { start: '10:00' });
    await mac.engine.syncNow();
    await phone.engine.syncNow();
    expect(phone.store.get('items', x.id)!.start).toBe('10:00');
  });
});

describe('Sauvegarde de sécurité avant restauration (serveur simulé, données fictives)', () => {
  it('complète, vérifiée, identifiée, en ligne et sur l’appareil ; on peut revenir en arrière, historiques compris', async () => {
    const { exportData, restoreExport, makeSafetyBackup, lastSafetyBackup, fingerprint, SAFETY_LABEL } = await import('../src/data/sync');
    const { seedAcademy } = await import('../src/data/migrations');
    const { updateOfferTerms, updateModule } = await import('../src/logic/academy');
    const server = fakeServer();
    const mac = await device(server, 'SB-MAC');
    seedAcademy(mac.store);
    await (mac.engine as any).linkDevice('upload');
    const phone = await device(server, 'SB-PHONE');
    await (phone.engine as any).linkDevice('download');

    const backup = structuredClone(exportData(mac.store)); // tarif 500 € v1, module M04 v1
    setStore(mac.store);
    updateOfferTerms(mac.store, 'ac-offer-solo-1j', { priceCents: 54000 });
    updateModule(mac.store, 'ac-module-m04', { content: 'Contenu fictif après sauvegarde' });
    const y = createItem({ title: 'Créée après la sauvegarde' }) as Item;
    await mac.engine.syncNow();

    const safety = await makeSafetyBackup(mac.store, mac.engine);
    expect(safety.remote).toBe('ok');
    const online = server.backups[server.backups.length - 1];
    expect(online.data.label).toBe(SAFETY_LABEL);
    expect(online.data.exportedAt).toBe(safety.madeAt);
    expect(fingerprint(online.data.data)).toBe(fingerprint(mac.store.state));
    const local = await lastSafetyBackup(mac.store);
    expect(local?.remoteId).toBe(online.id);

    await restoreExport(backup, mac.store, safety);
    expect(mac.store.get('acOffers', 'ac-offer-solo-1j')).toMatchObject({ priceCents: 50000, version: 1 });
    expect(mac.store.get('acModules', 'ac-module-m04')!.version).toBe(1);
    expect(mac.store.get('items', y.id)?.title).toBe('Créée après la sauvegarde'); // créé depuis : conservé
    expect((await lastSafetyBackup(mac.store))?.madeAt).toBe(safety.madeAt); // la sauvegarde de sécurité survit à la restauration

    // revenir à l'état d'avant la restauration (lui-même protégé par une nouvelle sauvegarde de sécurité)
    const undo = await makeSafetyBackup(mac.store, mac.engine);
    await restoreExport(local!.file, mac.store, undo);
    await mac.engine.syncNow();
    await phone.engine.syncNow();
    for (const d of [mac, phone]) {
      const o = d.store.get('acOffers', 'ac-offer-solo-1j')!;
      expect([o.priceCents, o.version, o.history.map((h) => h.priceCents)]).toEqual([54000, 2, [50000]]);
      const m = d.store.get('acModules', 'ac-module-m04')!;
      expect([m.version, m.content, m.history?.map((h) => h.version)]).toEqual([2, 'Contenu fictif après sauvegarde', [1]]);
      expect(d.store.get('items', y.id)?.title).toBe('Créée après la sauvegarde');
      expect(d.store.list('acOffers')).toHaveLength(4);
      expect(d.store.list('acModules')).toHaveLength(15);
    }
  });

  it('coupure Internet : les modifications pas encore envoyées sont protégées, conservées, puis envoyées au retour', async () => {
    const { exportData, restoreExport, makeSafetyBackup, lastSafetyBackup, SAFETY_LABEL } = await import('../src/data/sync');
    const server = fakeServer();
    const mac = await device(server, 'SB-OFF');
    setStore(mac.store);
    const x = createItem({ title: 'Version sauvegardée' }) as Item;
    await (mac.engine as any).linkDevice('upload');
    const backup = structuredClone(exportData(mac.store));

    server.net.down = true; // coupure
    setStore(mac.store);
    updateItem(x.id, { title: 'Modifiée hors ligne, pas encore envoyée' });
    const z = createItem({ title: 'Créée hors ligne, pas encore envoyée' }) as Item;
    await mac.engine.syncNow();
    expect(mac.engine.status.phase).not.toBe('idle');
    expect((await mac.store.db.outbox()).length).toBeGreaterThanOrEqual(2);

    const safety = await makeSafetyBackup(mac.store, mac.engine);
    expect(safety.remote).toBe('failed'); // pas de copie en ligne possible…
    const local = await lastSafetyBackup(mac.store); // …mais la copie sur l'appareil est faite et vérifiée
    expect(local!.file.label).toBe(SAFETY_LABEL);
    expect(local!.file.data.items[x.id].title).toBe('Modifiée hors ligne, pas encore envoyée');
    expect(local!.file.data.items[z.id].title).toBe('Créée hors ligne, pas encore envoyée');

    await restoreExport(backup, mac.store, safety);
    expect(mac.store.get('items', x.id)!.title).toBe('Version sauvegardée');
    expect(mac.store.get('items', z.id)?.title).toBe('Créée hors ligne, pas encore envoyée'); // jamais envoyée, mais conservée

    server.net.down = false; // retour du réseau
    await mac.engine.syncNow();
    expect(mac.engine.status.phase).toBe('idle');
    expect([...server.rows.values()].find((r) => r.id === z.id)?.data.title).toBe('Créée hors ligne, pas encore envoyée');
    const sent = server.backups.find((b) => b.data.label === SAFETY_LABEL);
    expect(sent?.data.data.items[x.id].title).toBe('Modifiée hors ligne, pas encore envoyée'); // la sauvegarde de sécurité est partie en ligne
    expect((await lastSafetyBackup(mac.store))?.remoteId).toBe(sent!.id);

    // revenir en arrière, hors connexion : la modification non envoyée revient
    server.net.down = true;
    await restoreExport(local!.file, mac.store, await makeSafetyBackup(mac.store, mac.engine));
    expect(mac.store.get('items', x.id)!.title).toBe('Modifiée hors ligne, pas encore envoyée');
  });

  it('plusieurs restaurations hors connexion : chaque sauvegarde de sécurité est gardée, puis toutes partent en ligne', async () => {
    const { exportData, restoreExport, makeSafetyBackup, safetyBackups, SAFETY_LABEL } = await import('../src/data/sync');
    const server = fakeServer();
    const mac = await device(server, 'SB-MULTI');
    setStore(mac.store);
    const x = createItem({ title: 'Fictive v0' }) as Item;
    await (mac.engine as any).linkDevice('upload');
    const backup = structuredClone(exportData(mac.store));

    server.net.down = true;
    for (const t of ['Fictive v1', 'Fictive v2', 'Fictive v3']) {
      setStore(mac.store);
      updateItem(x.id, { title: t });
      await mac.store.flushed();
      await new Promise((r) => setTimeout(r, 2)); // horodatages distincts
      const safety = await makeSafetyBackup(mac.store, mac.engine);
      expect(safety.remote).toBe('failed');
      await restoreExport(backup, mac.store, safety);
    }
    const kept = await safetyBackups(mac.store);
    expect(kept.map((k) => k.file.data.items[x.id].title)).toEqual(['Fictive v1', 'Fictive v2', 'Fictive v3']); // aucune écrasée
    expect(kept.every((k) => !k.remoteId)).toBe(true);

    server.net.down = false;
    await mac.engine.syncNow();
    const online = server.backups.filter((b) => b.data.label === SAFETY_LABEL);
    expect(online.map((b) => b.data.data.items[x.id].title)).toEqual(['Fictive v1', 'Fictive v2', 'Fictive v3']); // dans l'ordre
    expect((await safetyBackups(mac.store)).every((k) => k.remoteId)).toBe(true);

    // on peut revenir à n'importe laquelle, ici la plus ancienne
    await restoreExport(kept[0].file, mac.store, await makeSafetyBackup(mac.store, mac.engine));
    expect(mac.store.get('items', x.id)!.title).toBe('Fictive v1');
  });

  it('une copie de sécurité renvoyée après une coupure (réponse perdue) n’est pas créée deux fois en ligne', async () => {
    const { makeSafetyBackup, safetyBackups, SAFETY_LABEL, isSafetyLabel } = await import('../src/data/sync');
    const server = fakeServer();
    const mac = await device(server, 'SB-DUP');
    setStore(mac.store);
    createItem({ title: 'Fictive' });
    await (mac.engine as any).linkDevice('upload');
    const safety = await makeSafetyBackup(mac.store, mac.engine);
    expect(safety.remote).toBe('ok');
    const [copy] = await safetyBackups(mac.store);
    // simulation : la copie est arrivée, mais l'appareil ne l'a pas su et la renvoie
    const id2 = await mac.engine.uploadVerifiedBackup(copy.file);
    expect(id2).toBe(copy.remoteId);
    expect(server.backups.filter((b) => b.data.label === SAFETY_LABEL)).toHaveLength(1);
    // classement : seul le libellé exact compte comme sécurité
    expect([isSafetyLabel(SAFETY_LABEL), isSafetyLabel(null), isSafetyLabel(undefined), isSafetyLabel(''), isSafetyLabel('Autre libellé')]).toEqual([true, false, false, false, false]);
  });

  it('nombre de copies gardées : les 5 plus récentes, et TOUTES celles pas encore en ligne (jamais retirées)', async () => {
    const { pruneSafety, SAFETY_KEEP, SAFETY_MAX } = await import('../src/data/sync');
    const mk = (n: number, online: boolean) => ({ madeAt: new Date(Date.UTC(2026, 10, 26, 10, n)).toISOString(), remoteId: online ? n + 1 : undefined, file: {} as any });
    const minutes = (l: { madeAt: string }[]) => l.map((s) => new Date(s.madeAt).getUTCMinutes());
    expect(SAFETY_KEEP).toBe(5);
    expect(SAFETY_MAX).toBe(10);
    expect(minutes(pruneSafety([0, 1, 2, 3, 4, 5, 6].map((n) => mk(n, true))))).toEqual([2, 3, 4, 5, 6]);
    expect(minutes(pruneSafety([0, 1, 2, 3, 4, 5, 6].map((n) => mk(n, false))))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(minutes(pruneSafety(Array.from({ length: 12 }, (_, n) => mk(n, false))))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(minutes(pruneSafety([mk(0, false), mk(1, false), mk(2, true), mk(3, true), mk(4, true), mk(5, true), mk(6, true), mk(7, true)]))).toEqual([0, 1, 3, 4, 5, 6, 7]);
  });

  it('10 copies non envoyées : nouvelle restauration bloquée, rien n’est modifié ; débloquée après l’envoi', async () => {
    const { exportData, restoreExport, makeSafetyBackup, safetyBackups, safetyWaiting, SAFETY_MAX } = await import('../src/data/sync');
    const server = fakeServer();
    const mac = await device(server, 'SB-FULL');
    setStore(mac.store);
    const x = createItem({ title: 'Fictive v0' }) as Item;
    await (mac.engine as any).linkDevice('upload');
    const backup = structuredClone(exportData(mac.store));
    server.net.down = true;
    for (let n = 1; n <= SAFETY_MAX; n++) {
      setStore(mac.store);
      updateItem(x.id, { title: `Fictive v${n}` });
      await mac.store.flushed();
      await new Promise((r) => setTimeout(r, 2));
      await restoreExport(backup, mac.store, await makeSafetyBackup(mac.store, mac.engine));
    }
    expect(await safetyWaiting(mac.store)).toBe(SAFETY_MAX);
    setStore(mac.store);
    updateItem(x.id, { title: 'Fictive v11 non restaurée' });
    await mac.store.flushed();
    await expect(makeSafetyBackup(mac.store, mac.engine)).rejects.toThrow(/Restauration bloquée/);
    expect(mac.store.get('items', x.id)!.title).toBe('Fictive v11 non restaurée'); // rien n'est modifié
    expect((await safetyBackups(mac.store)).map((s) => s.file.data.items[x.id].title)).toEqual(Array.from({ length: SAFETY_MAX }, (_, i) => `Fictive v${i + 1}`)); // aucune perdue

    server.net.down = false; // retour du réseau : les 10 partent en ligne, la restauration redevient possible
    await mac.engine.syncNow();
    expect(await safetyWaiting(mac.store)).toBe(0);
    expect(server.backups.filter((b) => b.data.label)).toHaveLength(SAFETY_MAX);
    expect((await makeSafetyBackup(mac.store, mac.engine)).remote).toBe('ok');
    expect(await safetyBackups(mac.store)).toHaveLength(5); // en ligne : on n'en garde que 5 sur l'appareil
  });

  it('une sauvegarde de sécurité de l’ancien format (une seule copie) est reprise, jamais perdue', async () => {
    const { makeSafetyBackup, safetyBackups, exportData, SAFETY_LABEL } = await import('../src/data/sync');
    const { store } = await freshStore({ name: 'SB-OLD' });
    setStore(store);
    createItem({ title: 'Fictive' });
    await store.flushed();
    const old = { madeAt: '2026-11-26T11:00:00.000Z', file: { ...exportData(store), label: SAFETY_LABEL } };
    await store.db.setMeta('safetyBackup', structuredClone(old));
    expect((await safetyBackups(store)).map((s) => s.madeAt)).toEqual([old.madeAt]);
    await makeSafetyBackup(store);
    const list = await safetyBackups(store);
    expect(list).toHaveLength(2);
    expect(list[0].madeAt).toBe(old.madeAt);
    expect(await store.db.getMeta('safetyBackup')).toBeNull();
  });

  it('compteur « en attente d’envoi » : juste après chaque modification, et toujours exact pendant une coupure', async () => {
    const server = fakeServer();
    const mac = await device(server, 'PENDING');
    setStore(mac.store);
    await (mac.engine as any).linkDevice('upload');
    await mac.engine.syncNow();
    expect(mac.engine.status.pending).toBe(0);

    server.net.down = true;
    mac.store.onLocalChange = mac.engine.onLocalChange; // comme dans l'app
    const a = createItem({ title: 'Fictive hors ligne A' }) as Item;
    await mac.store.flushed();
    await new Promise((r) => setTimeout(r, 0));
    expect(mac.engine.status.pending).toBe(1); // sans attendre une synchronisation
    createItem({ title: 'Fictive hors ligne B' });
    updateItem(a.id, { title: 'Fictive hors ligne A modifiée' });
    await mac.engine.syncNow(); // échoue (coupure)
    expect(mac.engine.status.phase).not.toBe('idle');
    expect(mac.engine.status.pending).toBe(2); // 2 fiches en attente (A, modifiée deux fois, compte pour une)

    server.net.down = false;
    mac.store.onLocalChange = undefined;
    await mac.engine.syncNow();
    expect(mac.engine.status.pending).toBe(0);
  });

  it('restauration bloquée si la sauvegarde de sécurité ne peut pas être faite ou vérifiée : rien n’est modifié', async () => {
    const { exportData, restoreExport, makeSafetyBackup } = await import('../src/data/sync');
    const { store } = await freshStore({ name: 'SB-BLOCK' });
    setStore(store);
    const x = createItem({ title: 'Version sauvegardée' }) as Item;
    const backup = structuredClone(exportData(store));
    updateItem(x.id, { title: 'Version actuelle' });
    await store.flushed();

    // sans sauvegarde de sécurité : refus
    await expect(restoreExport(backup, store, { madeAt: new Date().toISOString(), remote: 'none' })).rejects.toThrow(/refusée/);

    // écriture impossible sur l'appareil : refus
    const db = store.db as any;
    const setMeta = db.setMeta.bind(db);
    db.setMeta = async () => { throw new Error('disque plein'); };
    await expect(makeSafetyBackup(store)).rejects.toThrow(/restauration est annulée/);
    db.setMeta = setMeta;

    // copie relue différente : refus
    const getMeta = db.getMeta.bind(db);
    db.getMeta = async (k: string) => { const v = await getMeta(k); if (k === 'safetyBackups' && Array.isArray(v) && v.length) delete v[v.length - 1].file.data.items[x.id]; return v; };
    await expect(makeSafetyBackup(store)).rejects.toThrow(/restauration est annulée/);
    db.getMeta = getMeta;

    expect(store.get('items', x.id)!.title).toBe('Version actuelle');
  });
});

describe('Journal des conflits et lien de confirmation e-mail (données fictives)', () => {
  it('le journal réunit les versions écartées du serveur et de l’appareil, sans rien modifier, et survit à une restauration', async () => {
    const { exportData, restoreExport, makeSafetyBackup } = await import('../src/data/sync');
    const server = fakeServer();
    const A = await device(server, 'CJ-A');
    setStore(A.store);
    const t = createItem({ title: 'Fictive' }) as Item;
    await (A.engine as any).linkDevice('upload');
    const B = await device(server, 'CJ-B');
    await (B.engine as any).linkDevice('download');
    const backup = structuredClone(exportData(A.store));

    // A modifie hors ligne (plus ancien), B modifie ensuite et envoie : A perd au serveur
    setStore(A.store);
    updateItem(t.id, { title: 'Version A (écartée)' });
    await new Promise((r) => setTimeout(r, 5));
    setStore(B.store);
    updateItem(t.id, { title: 'Version B (gardée)' });
    await B.engine.syncNow();
    await A.engine.syncNow();
    const before = structuredClone(A.store.state);
    const { entries, serverError } = await A.engine.listConflicts();
    expect(serverError).toBeUndefined();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const e = entries.find((x) => x.lost?.title === 'Version A (écartée)')!;
    expect(e.kept.title).toBe('Version B (gardée)');
    expect(A.store.state).toEqual(before); // consultation seule

    // journal de l'appareil : une version locale non envoyée remplacée par une plus récente
    server.net.down = true;
    setStore(A.store);
    updateItem(t.id, { title: 'Version A2 locale' });
    await new Promise((r) => setTimeout(r, 5));
    setStore(B.store);
    server.net.down = false;
    updateItem(t.id, { title: 'Version B2' });
    await B.engine.syncNow();
    await (A.engine as any).pull();
    const local = (await A.store.db.conflicts()).find((c) => (c.lost as any).title === 'Version A2 locale');
    expect(local).toBeTruthy();

    // une restauration n'efface pas le journal de l'appareil
    await restoreExport(backup, A.store, await makeSafetyBackup(A.store, A.engine));
    expect((await A.store.db.conflicts()).some((c) => (c.lost as any).title === 'Version A2 locale')).toBe(true);
    const all = await A.engine.listConflicts();
    expect(all.entries.some((x) => x.source === 'device')).toBe(true);
    expect(all.entries.some((x) => x.source === 'server')).toBe(true);
  });

  it('un lien de confirmation e-mail ne connecte jamais l’appareil : l’adresse est nettoyée et un message s’affiche', async () => {
    const { consumeAuthRedirect } = await import('../src/data/sync');
    const call = (hash: string, search = '') => {
      const replaced: string[] = [];
      const notice = consumeAuthRedirect({ hash, search, pathname: '/lx-planner/' }, { replaceState: (_d: unknown, _t: string, url?: string | URL | null) => { replaced.push(String(url)); } });
      return { notice, replaced };
    };
    const ok = call('#access_token=FAUX&refresh_token=FAUX&type=signup&expires_in=3600');
    expect(ok.notice?.kind).toBe('ok');
    expect(ok.replaced).toEqual(['/lx-planner/#/reglages']); // les jetons disparaissent de l'adresse
    expect(call('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid').notice?.kind).toBe('error');
    expect(call('', '?code=FAUX').notice?.kind).toBe('ok');
    expect(call('#access_token=FAUX&type=recovery').notice?.kind).toBe('error');
    const normal = call('#/jour/2026-11-26');
    expect(normal.notice).toBeNull();
    expect(normal.replaced).toEqual([]); // navigation normale : rien n'est touché
  });
});

describe('LX Academy — synchronisation iPhone / Mac (serveur simulé)', () => {
  it('un tarif modifié sur le Mac n’est pas écrasé par les données de départ de l’iPhone, et aucun doublon', async () => {
    const { seedAcademy } = await import('../src/data/migrations');
    const { updateOfferTerms } = await import('../src/logic/academy');
    const server = fakeServer();
    const mac = await device(server, 'AC-MAC');
    seedAcademy(mac.store);
    updateOfferTerms(mac.store, 'ac-offer-duo-1j', { priceCents: 38000 });
    await (mac.engine as any).linkDevice('upload');

    const phone = await device(server, 'AC-PHONE');
    seedAcademy(phone.store); // l'iPhone crée ses propres données de départ avant de se connecter
    await (phone.engine as any).linkDevice('merge');
    await mac.engine.syncNow();
    expect(phone.store.get('acOffers', 'ac-offer-duo-1j')!.priceCents).toBe(38000);
    expect(mac.store.get('acOffers', 'ac-offer-duo-1j')!.priceCents).toBe(38000);
    expect(phone.store.list('acOffers')).toHaveLength(4);
    expect(phone.store.list('acModules')).toHaveLength(15);
    const serverOffers = [...server.rows.values()].filter((r) => r.collection === 'acOffers' && !r.deleted);
    expect(serverOffers).toHaveLength(4);
  });

  it('« remplacer le compte par cet appareil » ne supprime jamais les données d’une version plus récente', async () => {
    const server = fakeServer();
    const A = await device(server, 'AC-REPL');
    await (A.engine as any).linkDevice('upload');
    // fiche créée par une future version de l'app (collection inconnue ici)
    server.rows.set('user-1|acFutureThing|f1', { user_id: 'user-1', collection: 'acFutureThing', id: 'f1', data: { id: 'f1' }, updated_at: '2030-01-01T00:00:00.000Z', deleted: false, server_updated_at: '2030-01-01T00:00:00.000Z' });
    await (A.engine as any).linkDevice('replace');
    expect(server.rows.get('user-1|acFutureThing|f1')!.deleted).toBe(false);
  });

  it('un appareil resté sur l’ancienne version récupère les fiches Academy après sa mise à jour', async () => {
    const server = fakeServer();
    const mac = await device(server, 'AC-MAC2');
    await (mac.engine as any).linkDevice('upload');
    const phone = await device(server, 'AC-PHONE2');
    await (phone.engine as any).linkDevice('download');
    // le Mac (à jour) ajoute un lieu ; l'iPhone (ancienne version) l'a ignoré mais a avancé son curseur
    mac.store.create('acVenues', { name: 'Futur centre', address: '1 rue Fictive', active: true, order: 5 });
    await mac.engine.syncNow();
    await phone.store.db.setMeta('lastPull', '2999-01-01T00:00:00.000Z');
    await phone.store.db.setMeta('collectionsSignature', 'ancienne-version');
    await phone.engine.syncNow();
    expect(phone.store.list('acVenues').some((v) => v.name === 'Futur centre')).toBe(true);
  });
});
