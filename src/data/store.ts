// Source de données unique : état en mémoire + persistance IndexedDB + file de synchronisation.
import { useSyncExternalStore } from 'react';
import { LocalDB } from './db';
import { uid } from '../lib/id';
import { COLLECTIONS, type CollectionName, type Collections, type DataState, type ID } from './types';
import { buildDefaults } from './defaults';

type Change = { collection: CollectionName; record: any };
export type SaveStatus = { pending: number; lastError?: string; lastSavedAt?: string };

let lastStamp = 0;
/** Horodatage ISO strictement croissant (même si deux écritures tombent dans la même milliseconde). */
export const stamp = (): string => {
  const n = Math.max(Date.now(), lastStamp + 1);
  lastStamp = n;
  return new Date(n).toISOString();
};

const emptyState = (): DataState => Object.fromEntries(COLLECTIONS.map((c) => [c, {}])) as unknown as DataState;

export class Store {
  state: DataState = emptyState();
  ready = false;
  save: SaveStatus = { pending: 0 };
  private listeners = new Set<() => void>();
  private batch: Change[] | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  /** appelé après chaque écriture locale (déclenche la synchro distante si configurée) */
  onLocalChange?: () => void;

  constructor(public db: LocalDB) {}

  async init(opts: { seed?: boolean } = { seed: true }) {
    this.state = await this.db.loadAll();
    if (opts.seed && !Object.keys(this.state.settings).length) {
      // Premier lancement : catégories, habitudes et réglages de départ (tous modifiables).
      const defaults = buildDefaults();
      this.transact(() => {
        for (const [coll, records] of Object.entries(defaults)) for (const r of records as any[]) this.putRaw(coll as CollectionName, r);
      });
      await this.flushed();
    }
    this.ready = true;
    this.emit();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private snap: { state: DataState; save: SaveStatus } = { state: this.state, save: this.save };
  getSnapshot = () => this.snap;
  private emit() {
    this.snap = { state: this.state, save: this.save };
    for (const l of this.listeners) l();
  }

  // ---------- Lecture ----------
  get<C extends CollectionName>(c: C, id: ID | undefined): Collections[C] | undefined {
    if (!id) return undefined;
    const r = this.state[c][id] as Collections[C] | undefined;
    return r && !r.deleted ? r : undefined;
  }
  list<C extends CollectionName>(c: C): Collections[C][] {
    return Object.values(this.state[c]).filter((r) => !r.deleted) as Collections[C][];
  }
  get settings() {
    return this.list('settings')[0];
  }

  // ---------- Écriture ----------
  /** Regroupe plusieurs modifications en une seule transaction (tout ou rien sur le disque). */
  transact<T>(fn: () => T): T {
    if (this.batch) return fn();
    this.batch = [];
    try {
      const out = fn();
      const changes = this.batch;
      this.batch = null;
      this.commit(changes);
      return out;
    } catch (e) {
      this.batch = null;
      throw e;
    }
  }

  private putRaw(collection: CollectionName, record: any) {
    const next = { ...this.state[collection], [record.id]: record };
    this.state = { ...this.state, [collection]: next };
    if (this.batch) this.batch.push({ collection, record });
    else this.commit([{ collection, record }]);
  }

  private commit(changes: Change[], enqueue = true) {
    if (!changes.length) return;
    this.emit();
    this.save = { ...this.save, pending: this.save.pending + 1 };
    this.writeChain = this.writeChain
      .then(() => this.db.putMany(changes, { enqueue }))
      .then(() => {
        this.save = { pending: this.save.pending - 1, lastSavedAt: new Date().toISOString() };
        this.emit();
        if (enqueue) this.onLocalChange?.();
      })
      .catch((e) => {
        console.error('Échec de sauvegarde locale', e);
        this.save = { ...this.save, pending: this.save.pending - 1, lastError: String(e?.message ?? e) };
        this.emit();
      });
  }

  /** Attend que toutes les écritures en cours soient confirmées par IndexedDB. */
  flushed() {
    return this.writeChain;
  }

  create<C extends CollectionName>(c: C, data: Omit<Collections[C], 'id' | 'createdAt' | 'updatedAt'> & { id?: ID; createdAt?: string }): Collections[C] {
    const now = stamp();
    const record = { ...data, id: data.id ?? uid(), createdAt: (data as { createdAt?: string }).createdAt ?? now, updatedAt: now } as Collections[C];
    this.putRaw(c, record);
    return record;
  }

  update<C extends CollectionName>(c: C, id: ID, patch: Partial<Collections[C]>): Collections[C] | undefined {
    const cur = this.state[c][id];
    if (!cur) return undefined;
    const record = { ...cur, ...patch, id, updatedAt: stamp() } as Collections[C];
    // retire les clés explicitement mises à undefined pour garder des enregistrements propres
    for (const k of Object.keys(record)) if ((record as any)[k] === undefined) delete (record as any)[k];
    this.putRaw(c, record);
    return record;
  }

  /**
   * Données de départ : écrit l'enregistrement tel quel (avec son horodatage) uniquement s'il n'existe pas encore,
   * même supprimé. Un horodatage ancien garantit qu'une modification faite sur un autre appareil gagne toujours.
   */
  seedIfAbsent<C extends CollectionName>(c: C, record: Collections[C]): boolean {
    if (this.state[c][record.id]) return false;
    this.putRaw(c, record);
    return true;
  }

  /** Suppression logique : conservée comme « tombstone » pour que la suppression se synchronise entre appareils. */
  remove(c: CollectionName, id: ID) {
    const cur = this.state[c][id];
    if (!cur || cur.deleted) return;
    this.putRaw(c, { ...cur, deleted: true, updatedAt: stamp() });
  }

  /** Applique des enregistrements venant du serveur (sans les remettre dans la file d'envoi). */
  applyRemote(changes: Change[]) {
    if (!changes.length) return;
    let state = this.state;
    for (const { collection, record } of changes) state = { ...state, [collection]: { ...state[collection], [record.id]: record } };
    this.state = state;
    this.commit(changes, false);
  }

  /**
   * Remplace toutes les données (restauration d'une sauvegarde).
   * L'appareil reste relié à son compte : sans cela, la synchronisation s'arrêtait en silence après une restauration.
   * Le curseur de récupération repart du début, donc ce qui a été créé dans le compte après la sauvegarde est
   * conservé (rien n'est supprimé) ; les fiches restaurées, plus récentes, l'emportent sur leurs anciennes versions.
   */
  async replaceAll(data: DataState) {
    await this.flushed();
    // conservés : le compte relié, et la sauvegarde de sécurité faite juste avant (pour pouvoir revenir en arrière)
    const kept: [string, unknown][] = [];
    for (const k of ['linkedUser', 'safetyBackups', 'safetyBackup', 'lastBackupAt']) {
      const v = await this.db.getMeta(k);
      if (v !== undefined && v !== null) kept.push([k, v]);
    }
    const conflicts = await this.db.conflicts(); // le journal des conflits de l'appareil n'est jamais effacé par une restauration
    await this.db.clearAll();
    for (const [k, v] of kept) await this.db.setMeta(k, v);
    for (const c of conflicts) await this.db.addConflict(c);
    this.state = emptyState();
    const changes: Change[] = [];
    for (const c of COLLECTIONS) for (const r of Object.values((data as any)[c] ?? {})) changes.push({ collection: c, record: r });
    for (const { collection, record } of changes) this.state[collection] = { ...this.state[collection], [record.id]: record };
    this.commit(changes, true);
    await this.flushed();
  }
}

// ---------- Instance de l'application ----------
let _store: Store | null = null;
export const getStore = () => {
  if (!_store) _store = new Store(new LocalDB());
  return _store;
};
export const setStore = (s: Store) => {
  _store = s;
};

/** Hook React : se ré-affiche à chaque modification des données. */
export function useData(): DataState {
  const s = getStore();
  return useSyncExternalStore(s.subscribe, s.getSnapshot).state;
}
export function useSaveStatus(): SaveStatus {
  const s = getStore();
  return useSyncExternalStore(s.subscribe, s.getSnapshot).save;
}
