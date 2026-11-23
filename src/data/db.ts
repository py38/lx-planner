// Stockage persistant local (IndexedDB).
// Chaque écriture est confirmée par IndexedDB avant d'être considérée comme sauvegardée.
import { COLLECTIONS, type CollectionName, type DataState } from './types';

const DB_VERSION = 2; // v2 : contenus, simulations de feed et images
export const META = 'meta';
export const OUTBOX = 'outbox';
export const CONFLICTS = 'conflicts';
/** Images (couvertures, feed) : stockées à part, en Blob, sur l'appareil */
export const MEDIA = 'media';

export interface OutboxEntry {
  key: string; // `${collection}:${id}`
  collection: CollectionName;
  id: string;
  updatedAt: string;
}

export interface ConflictEntry {
  key: string;
  collection: CollectionName;
  id: string;
  /** version perdante conservée pour ne jamais rien perdre silencieusement */
  lost: unknown;
  kept: unknown;
  at: string;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('Transaction annulée'));
  });
}

export class LocalDB {
  private dbp: Promise<IDBDatabase>;
  constructor(public name = 'lx-planner', idb: IDBFactory = indexedDB) {
    this.dbp = new Promise((resolve, reject) => {
      const open = idb.open(name, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const c of COLLECTIONS) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(CONFLICTS)) db.createObjectStore(CONFLICTS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('Base locale bloquée par un autre onglet'));
    });
  }

  async loadAll(): Promise<DataState> {
    const db = await this.dbp;
    const tx = db.transaction(COLLECTIONS, 'readonly');
    const state = {} as DataState;
    await Promise.all(
      COLLECTIONS.map(async (c) => {
        const rows = await req(tx.objectStore(c).getAll());
        const map: Record<string, any> = {};
        for (const r of rows) map[r.id] = r;
        (state as any)[c] = map;
      }),
    );
    return state;
  }

  /** Écrit plusieurs enregistrements (et éventuellement la file d'envoi) dans une seule transaction atomique. */
  async putMany(
    records: { collection: CollectionName; record: { id: string; updatedAt: string } }[],
    opts: { enqueue: boolean } = { enqueue: true },
  ): Promise<void> {
    if (!records.length) return;
    const db = await this.dbp;
    const stores = Array.from(new Set(records.map((r) => r.collection))) as string[];
    if (opts.enqueue) stores.push(OUTBOX);
    const tx = db.transaction(stores, 'readwrite');
    for (const { collection, record } of records) {
      tx.objectStore(collection).put(record);
      if (opts.enqueue) {
        const e: OutboxEntry = { key: `${collection}:${record.id}`, collection, id: record.id, updatedAt: record.updatedAt };
        tx.objectStore(OUTBOX).put(e);
      }
    }
    await txDone(tx);
  }

  async clearAll(): Promise<void> {
    const db = await this.dbp;
    const stores = [...COLLECTIONS, META, OUTBOX, CONFLICTS]; // les images (MEDIA) sont conservées
    const tx = db.transaction(stores, 'readwrite');
    for (const s of stores) tx.objectStore(s).clear();
    await txDone(tx);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const db = await this.dbp;
    return req(db.transaction(META, 'readonly').objectStore(META).get(key)) as Promise<T | undefined>;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await this.dbp;
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put(value, key);
    await txDone(tx);
  }

  async outbox(): Promise<OutboxEntry[]> {
    const db = await this.dbp;
    return req(db.transaction(OUTBOX, 'readonly').objectStore(OUTBOX).getAll());
  }
  /** Retire de la file uniquement les entrées envoyées dont la version n'a pas changé entre-temps. */
  async ackOutbox(sent: OutboxEntry[]): Promise<void> {
    const db = await this.dbp;
    const tx = db.transaction(OUTBOX, 'readwrite');
    const store = tx.objectStore(OUTBOX);
    for (const e of sent) {
      const cur = (await req(store.get(e.key))) as OutboxEntry | undefined;
      if (cur && cur.updatedAt === e.updatedAt) store.delete(e.key);
    }
    await txDone(tx);
  }

  async addConflict(c: ConflictEntry): Promise<void> {
    const db = await this.dbp;
    const tx = db.transaction(CONFLICTS, 'readwrite');
    tx.objectStore(CONFLICTS).put(c);
    await txDone(tx);
  }
  async conflicts(): Promise<ConflictEntry[]> {
    const db = await this.dbp;
    return req(db.transaction(CONFLICTS, 'readonly').objectStore(CONFLICTS).getAll());
  }

  // ---------- Images ----------
  async putMedia(id: string, blob: Blob): Promise<void> {
    const db = await this.dbp;
    const tx = db.transaction(MEDIA, 'readwrite');
    tx.objectStore(MEDIA).put(blob, id);
    await txDone(tx);
  }
  async getMedia(id: string): Promise<Blob | undefined> {
    const db = await this.dbp;
    return req(db.transaction(MEDIA, 'readonly').objectStore(MEDIA).get(id)) as Promise<Blob | undefined>;
  }
  async deleteMedia(id: string): Promise<void> {
    const db = await this.dbp;
    const tx = db.transaction(MEDIA, 'readwrite');
    tx.objectStore(MEDIA).delete(id);
    await txDone(tx);
  }

  async close() {
    (await this.dbp).close();
  }
}
