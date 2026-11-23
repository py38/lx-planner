// Synchronisation entre appareils via Supabase (Postgres + authentification).
// Principe : l'app fonctionne d'abord en local (IndexedDB) ; chaque modification est mise en file d'envoi,
// puis poussée au serveur. Les modifications des autres appareils sont récupérées régulièrement.
// Conflits : la version la plus récente gagne ; la version perdante est archivée (jamais perdue en silence).
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { getStore, type Store } from './store';
import { COLLECTIONS, type CollectionName, type DataState } from './types';
import type { OutboxEntry } from './db';
import { runMigrations } from './migrations';

const CONFIG_KEY = 'lx-supabase-config';
const PULL_OVERLAP_MS = 5 * 60 * 1000;
const CHUNK = 400;

export interface SyncConfig { url: string; anonKey: string }
export type SyncPhase = 'not-configured' | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error';
export interface SyncStatus {
  phase: SyncPhase;
  email?: string;
  lastSyncAt?: string;
  lastBackupAt?: string;
  error?: string;
  pending: number;
  needsFirstSyncChoice?: { remoteCount: number };
}

interface RemoteRow {
  user_id: string;
  collection: CollectionName;
  id: string;
  data: any;
  updated_at: string;
  deleted: boolean;
  server_updated_at: string;
}

/**
 * Projet Supabase de l'application. La clé « publishable » est faite pour être publique :
 * sans connexion à un compte, elle ne donne accès à aucune donnée (sécurité par compte = RLS, voir supabase/schema.sql).
 */
export const DEFAULT_CONFIG: SyncConfig = {
  url: 'https://dkyknlssuuldepxptrpg.supabase.co',
  anonKey: 'sb_publishable_Vf6Qzy3SZ3dp3YIUuObwSg_4y4thn5X',
};

export function loadConfig(): SyncConfig | null {
  const envUrl = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
  const envKey = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (envUrl && envKey) return { url: envUrl, anonKey: envKey };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}
export function saveConfig(c: SyncConfig | null) {
  try {
    if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    else localStorage.removeItem(CONFIG_KEY);
  } catch { /* stockage indisponible */ }
}

export class SyncEngine {
  client: SupabaseClient | null = null;
  session: Session | null = null;
  status: SyncStatus = { phase: 'not-configured', pending: 0 };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer?: number;
  private debounce?: ReturnType<typeof setTimeout>;

  constructor(private store: Store) {}

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getStatus = () => this.status;
  private set(p: Partial<SyncStatus>) {
    this.status = { ...this.status, ...p };
    this.listeners.forEach((l) => l());
  }

  async start() {
    const cfg = loadConfig();
    const last = await this.store.db.getMeta<string>('lastSyncAt');
    const lastBackupAt = await this.store.db.getMeta<string>('lastBackupAt');
    this.set({ lastSyncAt: last, lastBackupAt, pending: (await this.store.db.outbox()).length });
    if (!cfg) { this.set({ phase: 'not-configured' }); return; }
    this.client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lx-planner-auth' } });
    const { data } = await this.client.auth.getSession();
    this.session = data.session;
    this.client.auth.onAuthStateChange((_e, s) => {
      this.session = s;
      this.set({ phase: s ? 'idle' : 'signed-out', email: s?.user.email });
    });
    this.set({ phase: this.session ? 'idle' : 'signed-out', email: this.session?.user.email });
    this.store.onLocalChange = () => this.schedule(2000);
    window.addEventListener('online', () => this.schedule(500));
    window.addEventListener('offline', () => this.set({ phase: 'offline' }));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.schedule(300));
    this.timer = window.setInterval(() => this.schedule(0), 60_000);
    if (this.session) await this.syncNow();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  schedule(ms: number) {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = globalThis.setTimeout(() => this.syncNow().catch(() => {}), ms);
  }

  // ---------- Compte ----------
  async signUp(email: string, password: string) {
    if (!this.client) throw new Error('Synchronisation non configurée');
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    this.session = data.session;
    if (data.session) await this.afterLogin();
    return { needsConfirmation: !data.session };
  }
  async signIn(email: string, password: string) {
    if (!this.client) throw new Error('Synchronisation non configurée');
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.session = data.session;
    await this.afterLogin();
  }
  async signOut() {
    await this.client?.auth.signOut();
    this.session = null;
    await this.store.db.setMeta('linkedUser', null);
    this.set({ phase: 'signed-out', email: undefined });
  }

  /** Premier lien entre cet appareil et le compte : on ne mélange jamais deux jeux de données sans demander. */
  private async afterLogin() {
    this.set({ phase: 'idle', email: this.session?.user.email });
    const linked = await this.store.db.getMeta<string>('linkedUser');
    if (linked === this.session!.user.id) return this.syncNow();
    const { count, error } = await this.client!.from('records').select('id', { count: 'exact', head: true });
    if (error) return this.fail(error);
    if (count && count > 0) {
      this.set({ needsFirstSyncChoice: { remoteCount: count } });
      return;
    }
    await this.linkDevice('upload');
  }

  /**
   * upload  : le compte est vide → on envoie toutes les données de cet appareil.
   * download: le compte a déjà des données → on remplace celles de cet appareil (nouvel appareil).
   * merge   : on garde les deux (la version la plus récente de chaque élément gagne).
   */
  async linkDevice(mode: 'upload' | 'download' | 'merge') {
    const userId = this.session!.user.id;
    this.set({ needsFirstSyncChoice: undefined });
    if (mode === 'download') {
      await this.store.db.clearAll();
      this.store.state = Object.fromEntries(COLLECTIONS.map((c) => [c, {}])) as unknown as DataState;
    } else {
      const all = COLLECTIONS.flatMap((c) => Object.values(this.store.state[c]).map((r: any) => ({ collection: c, record: r })));
      await this.store.db.putMany(all, { enqueue: true });
    }
    await this.store.db.setMeta('lastPull', null);
    await this.store.db.setMeta('linkedUser', userId);
    await this.syncNow();
    if (mode === 'download' && !this.store.settings) {
      // compte sans réglages (cas improbable) : on recrée les valeurs par défaut
      await this.store.init({ seed: true });
    }
  }

  // ---------- Synchronisation ----------
  async syncNow(): Promise<void> {
    if (!this.client || !this.session || this.status.needsFirstSyncChoice) return;
    if (await this.store.db.getMeta<string>('linkedUser') !== this.session.user.id) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.set({ phase: 'offline' }); return; }
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      this.set({ phase: 'syncing', error: undefined });
      try {
        await this.store.flushed();
        await this.push();
        await this.pull();
        // d'anciennes « idées » venant d'un autre appareil deviennent des fiches contenu (mêmes identifiants → sans doublon)
        runMigrations(this.store);
        const now = new Date().toISOString();
        await this.store.db.setMeta('lastSyncAt', now);
        await this.maybeBackup();
        this.set({ phase: 'idle', lastSyncAt: now, pending: (await this.store.db.outbox()).length });
      } catch (e) {
        this.fail(e);
      } finally {
        this.running = null;
        if (this.again) { this.again = false; this.schedule(100); }
      }
    })();
    return this.running;
  }

  private fail(e: any) {
    const msg = e?.message ?? String(e);
    console.error('Synchronisation', e);
    this.set({ phase: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error', error: msg });
  }

  private async push() {
    const userId = this.session!.user.id;
    const outbox = await this.store.db.outbox();
    for (let i = 0; i < outbox.length; i += CHUNK) {
      const batch = outbox.slice(i, i + CHUNK);
      const rows = batch
        .map((e) => ({ e, r: (this.store.state[e.collection] as any)[e.id] }))
        .filter(({ r }) => r)
        .map(({ e, r }) => ({ user_id: userId, collection: e.collection, id: e.id, data: r, updated_at: r.updatedAt, deleted: !!r.deleted }));
      if (rows.length) {
        const { error } = await this.client!.from('records').upsert(rows, { onConflict: 'user_id,collection,id' });
        if (error) throw error;
      }
      await this.store.db.ackOutbox(batch);
    }
  }

  private async pull() {
    const last = await this.store.db.getMeta<string>('lastPull');
    const since = last ? new Date(new Date(last).getTime() - PULL_OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
    let cursor = since;
    let maxSeen = last ?? since;
    for (;;) {
      const { data, error } = await this.client!.from('records').select('*').gt('server_updated_at', cursor).order('server_updated_at', { ascending: true }).limit(1000);
      if (error) throw error;
      const rows = (data ?? []) as RemoteRow[];
      if (!rows.length) break;
      await this.merge(rows);
      cursor = rows[rows.length - 1].server_updated_at;
      if (cursor > maxSeen) maxSeen = cursor;
      if (rows.length < 1000) break;
    }
    await this.store.db.setMeta('lastPull', maxSeen);
  }

  /** Fusion « dernière modification gagnante » ; la version locale écrasée est archivée. */
  async merge(rows: RemoteRow[]) {
    const pending = new Map<string, OutboxEntry>((await this.store.db.outbox()).map((e) => [e.key, e]));
    const apply: { collection: CollectionName; record: any }[] = [];
    const ack: OutboxEntry[] = [];
    for (const row of rows) {
      if (!COLLECTIONS.includes(row.collection)) continue;
      const local = (this.store.state[row.collection] as any)[row.id];
      const remote = { ...row.data, deleted: row.deleted || row.data?.deleted || undefined, updatedAt: row.updated_at };
      if (!local || remote.updatedAt > local.updatedAt) {
        const key = `${row.collection}:${row.id}`;
        const p = pending.get(key);
        if (local && p) {
          await this.store.db.addConflict({ key: `${key}:${Date.now()}`, collection: row.collection, id: row.id, lost: local, kept: remote, at: new Date().toISOString() });
          ack.push(p);
        }
        apply.push({ collection: row.collection, record: remote });
      }
    }
    if (ack.length) await this.store.db.ackOutbox(ack);
    if (apply.length) {
      this.store.applyRemote(apply);
      await this.store.flushed();
    }
  }

  // ---------- Sauvegardes distantes ----------
  private async maybeBackup() {
    const last = await this.store.db.getMeta<string>('lastBackupAt');
    if (last && Date.now() - new Date(last).getTime() < 24 * 3600 * 1000) return;
    await this.backupNow();
  }
  async backupNow() {
    if (!this.client || !this.session) throw new Error('Non connectée');
    const { error } = await this.client.from('backups').insert({ user_id: this.session.user.id, data: exportData(this.store) });
    if (error) throw error;
    const now = new Date().toISOString();
    await this.store.db.setMeta('lastBackupAt', now);
    this.set({ lastBackupAt: now });
  }
  async listBackups(): Promise<{ id: number; created_at: string }[]> {
    if (!this.client) return [];
    const { data, error } = await this.client.from('backups').select('id, created_at').order('created_at', { ascending: false }).limit(30);
    if (error) throw error;
    return data ?? [];
  }
  async fetchBackup(id: number): Promise<ExportFile> {
    const { data, error } = await this.client!.from('backups').select('data').eq('id', id).single();
    if (error) throw error;
    return data.data as ExportFile;
  }
}

// ---------- Export / import ----------
export interface ExportFile { app: 'lx-planner'; version: 1; exportedAt: string; data: DataState }
export function exportData(store = getStore()): ExportFile {
  return { app: 'lx-planner', version: 1, exportedAt: new Date().toISOString(), data: store.state };
}
export function validateExport(x: any): x is ExportFile {
  return x && x.app === 'lx-planner' && x.data && typeof x.data === 'object' && COLLECTIONS.every((c) => typeof x.data[c] === 'object');
}

let _engine: SyncEngine | null = null;
export const getSync = () => (_engine ??= new SyncEngine(getStore()));
