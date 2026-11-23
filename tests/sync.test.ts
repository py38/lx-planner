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
  const client: any = {
    from(table: string) {
      if (table === 'backups') return { insert: async () => ({ error: null }) };
      const q: any = { filters: [] as ((r: any) => boolean)[], lim: 1e9 };
      const run = () => {
        const data = [...rows.values()].filter((r) => q.filters.every((f: any) => f(r))).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at)).slice(0, q.lim);
        return q.head ? { count: data.length, error: null } : { data: structuredClone(data), error: null };
      };
      const b: any = {
        upsert: async (rs: any[]) => {
          for (const r of rs) {
            const k = `${r.user_id}|${r.collection}|${r.id}`;
            const old = rows.get(k);
            if (old && r.updated_at < old.updated_at) { conflicts.push({ lost: r.data, kept: old.data }); continue; }
            rows.set(k, { ...structuredClone(r), server_updated_at: nextTs() });
          }
          return { error: null };
        },
        select: (_c: string, opts?: any) => { q.head = opts?.head; return b; },
        gt: (col: string, v: string) => { q.filters.push((r: any) => r[col] > v); return b; },
        order: () => b,
        limit: (n: number) => { q.lim = n; return b; },
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return b;
    },
  };
  return { client, rows, conflicts };
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
});
