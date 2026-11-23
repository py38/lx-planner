import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { LocalDB } from '../src/data/db';
import { Store, setStore } from '../src/data/store';

/** Crée un store neuf sur une base IndexedDB simulée (isolée par test). */
export async function freshStore(opts: { seed?: boolean; factory?: IDBFactory; name?: string } = {}) {
  const factory = opts.factory ?? new IDBFactory();
  const db = new LocalDB(opts.name ?? 'test', factory);
  const store = new Store(db);
  await store.init({ seed: opts.seed ?? true });
  setStore(store);
  return { store, factory, db };
}

/** Simule une fermeture puis réouverture de l'application sur la même base. */
export async function reopen(factory: IDBFactory, name = 'test') {
  const db = new LocalDB(name, factory);
  const store = new Store(db);
  await store.init({ seed: true });
  setStore(store);
  return store;
}
