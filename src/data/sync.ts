// Synchronisation entre appareils via Supabase (Postgres + authentification).
// Principe : l'app fonctionne d'abord en local (IndexedDB) ; chaque modification est mise en file d'envoi,
// puis poussée au serveur. Les modifications des autres appareils sont récupérées régulièrement.
// Conflits : la version la plus récente gagne ; la version perdante est archivée (jamais perdue en silence).
import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { getStore, stamp, type Store } from './store';
import { COLLECTIONS, type CollectionName, type DataState } from './types';
import type { OutboxEntry } from './db';
import { runMigrations } from './migrations';
import { retryMissingMedia, setRemoteMediaFetcher } from './media';

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
  /** images envoyées dans le compte pendant cette session */
  mediaSent?: number;
  /** message ponctuel à afficher dans Réglages (ex. retour depuis un lien de confirmation e-mail) */
  notice?: { kind: 'ok' | 'error'; text: string };
}

/**
 * Retour depuis un lien reçu par e-mail (confirmation d'adresse…). Supabase a DÉJÀ confirmé l'adresse avant de
 * renvoyer vers l'app. Par sécurité, l'appareil n'est PAS connecté automatiquement (il peut être relié à un autre
 * compte) : les informations de connexion contenues dans l'adresse sont ignorées et effacées, puis on affiche un
 * message dans Réglages. À appeler avant le premier affichage.
 */
export function consumeAuthRedirect(loc: Pick<Location, 'hash' | 'search' | 'pathname'> = window.location, hist: Pick<History, 'replaceState'> = window.history): SyncStatus['notice'] | null {
  const params = new URLSearchParams(`${loc.search.replace(/^\?/, '')}&${loc.hash.replace(/^#\/?/, '')}`);
  const isAuth = ['access_token', 'refresh_token', 'error_description', 'error_code', 'code', 'token_hash'].some((k) => params.has(k));
  if (!isAuth) return null;
  hist.replaceState(null, '', `${loc.pathname}#/reglages`); // efface les jetons de l'adresse (historique compris)
  if (params.has('error') || params.has('error_code') || params.has('error_description')) {
    return { kind: 'error', text: 'Ce lien n’est plus valide (il a peut-être déjà servi ou expiré). Si votre adresse est déjà confirmée, connectez-vous normalement ci-dessous.' };
  }
  if (params.get('type') === 'recovery') {
    return { kind: 'error', text: 'La réinitialisation du mot de passe n’est pas encore disponible dans l’app. Rien n’a été modifié.' };
  }
  return { kind: 'ok', text: 'Adresse e-mail confirmée. Vous pouvez maintenant vous connecter avec votre e-mail et votre mot de passe.' };
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
    // detectSessionInUrl: false → un lien reçu par e-mail ne connecte jamais l'appareil tout seul (voir consumeAuthRedirect)
    this.client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'lx-planner-auth' } });
    const { data } = await this.client.auth.getSession();
    this.session = data.session;
    this.client.auth.onAuthStateChange((_e, s) => {
      this.session = s;
      this.installMediaFetcher();
      this.set({ phase: s ? 'idle' : 'signed-out', email: s?.user.email });
    });
    this.set({ phase: this.session ? 'idle' : 'signed-out', email: this.session?.user.email });
    this.installMediaFetcher();
    this.store.onLocalChange = this.onLocalChange;
    window.addEventListener('online', () => this.schedule(500));
    window.addEventListener('offline', () => this.set({ phase: 'offline' }));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.schedule(300));
    this.timer = window.setInterval(() => this.schedule(0), 60_000);
    if (this.session) await this.syncNow();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  setNotice(notice?: SyncStatus['notice']) {
    this.set({ notice });
  }

  /** Après chaque modification locale : compteur « en attente d'envoi » à jour tout de suite, puis envoi. */
  onLocalChange = () => {
    void this.refreshPending();
    this.schedule(2000);
  };

  /** Recalcule le nombre de modifications en attente d'envoi (y compris hors connexion ou après un échec). */
  async refreshPending() {
    try { this.set({ pending: (await this.store.db.outbox()).length }); } catch { /* base indisponible : on garde l'ancien chiffre */ }
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
  async linkDevice(mode: 'upload' | 'download' | 'merge' | 'replace') {
    const userId = this.session!.user.id;
    this.set({ needsFirstSyncChoice: undefined });
    if (mode === 'replace') {
      await this.replaceAccountWithThisDevice(userId);
    } else if (mode === 'download') {
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

  /**
   * « Remplacer le contenu du compte par celui de cet appareil » :
   *  1. toutes les données de cet appareil reçoivent un horodatage neuf (elles l'emportent sur le compte) ;
   *  2. ce qui n'existe que dans le compte est marqué supprimé (et donc retiré aussi sur les autres appareils au prochain passage).
   * Rien n'est effacé définitivement : les lignes du compte restent en base avec deleted = true.
   */
  private async replaceAccountWithThisDevice(userId: string) {
    const local = new Set<string>();
    const changes: { collection: CollectionName; record: any }[] = [];
    let t = Date.now();
    for (const c of COLLECTIONS) {
      for (const r of Object.values(this.store.state[c]) as any[]) {
        local.add(`${c}:${r.id}`);
        changes.push({ collection: c, record: { ...r, updatedAt: new Date(t++).toISOString() } });
      }
    }
    // horodatage neuf en local aussi, pour que l'état mémoire et la base locale restent identiques
    this.store.applyRemote(changes);
    await this.store.flushed();
    await this.store.db.putMany(changes, { enqueue: true });
    const { data, error } = await this.client!.from('records').select('collection,id,data').eq('deleted', false);
    if (error) throw error;
    const tombstones = ((data ?? []) as { collection: CollectionName; id: string; data: any }[])
      // une collection inconnue de cette version (créée par une version plus récente) n'est jamais touchée
      .filter((r) => COLLECTIONS.includes(r.collection) && !local.has(`${r.collection}:${r.id}`))
      .map((r) => {
        const updated = new Date(t++).toISOString();
        return { user_id: userId, collection: r.collection, id: r.id, data: { ...r.data, deleted: true, updatedAt: updated }, updated_at: updated, deleted: true };
      });
    for (let i = 0; i < tombstones.length; i += CHUNK) {
      const { error: e } = await this.client!.from('records').upsert(tombstones.slice(i, i + CHUNK), { onConflict: 'user_id,collection,id' });
      if (e) throw e;
    }
  }

  // ---------- Synchronisation ----------
  async syncNow(): Promise<void> {
    if (!this.client || !this.session || this.status.needsFirstSyncChoice) return;
    if (await this.store.db.getMeta<string>('linkedUser') !== this.session.user.id) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { this.set({ phase: 'offline' }); await this.refreshPending(); return; }
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      this.set({ phase: 'syncing', error: undefined });
      try {
        await this.store.flushed();
        await this.push();
        await this.pull();
        // d'anciennes « idées » venant d'un autre appareil deviennent des fiches contenu (mêmes identifiants → sans doublon)
        runMigrations(this.store);
        // images : non bloquant (une image non envoyée est retentée au prochain passage)
        let mediaError: string | undefined;
        try { await this.syncMedia(); } catch (e: any) { mediaError = `Images pas encore envoyées : ${e?.message ?? e}`; console.warn(mediaError); }
        const now = new Date().toISOString();
        await this.store.db.setMeta('lastSyncAt', now);
        await this.uploadPendingSafety();
        await this.maybeBackup();
        this.set({ phase: 'idle', lastSyncAt: now, pending: (await this.store.db.outbox()).length, error: mediaError });
      } catch (e) {
        this.fail(e);
        await this.refreshPending();
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
    // Nouvelles collections depuis la dernière synchro (mise à jour de l'app) : une ancienne version a pu ignorer
    // leurs fiches tout en avançant son curseur. On repart donc du début une fois — la fusion est sans risque (la plus récente gagne).
    if ((await this.store.db.getMeta<string>('collectionsSignature')) !== COLLECTIONS_SIGNATURE) {
      await this.store.db.setMeta('lastPull', null);
      await this.store.db.setMeta('collectionsSignature', COLLECTIONS_SIGNATURE);
    }
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

  // ---------- Images (Supabase Storage, espace privé « media/<compte>/<image>.jpg ») ----------
  private mediaPath = (id: string) => `${this.session!.user.id}/${id}`;

  /** Images utilisées par les fiches (couvertures) et les simulations de feed. */
  private referencedMedia(): string[] {
    const ids = new Set<string>();
    for (const c of Object.values(this.store.state.contents)) if (!c.deleted && c.coverMediaId) ids.add(c.coverMediaId);
    for (const f of Object.values(this.store.state.feeds)) if (!f.deleted) for (const t of f.tiles) if (t.mediaId) ids.add(t.mediaId);
    return [...ids];
  }

  /** Envoie les images présentes sur cet appareil et pas encore dans le compte (y compris celles d'avant la synchronisation). */
  async syncMedia(): Promise<number> {
    if (!this.client || !this.session) return 0;
    const key = `mediaUploaded:${this.session.user.id}`;
    const done = new Set(await this.store.db.getMeta<string[]>(key) ?? []);
    let sent = 0;
    for (const id of this.referencedMedia()) {
      if (done.has(id)) continue;
      const blob = await this.store.db.getMedia(id);
      if (!blob) continue; // image ajoutée sur un autre appareil : elle sera téléchargée à l'affichage
      const { error } = await this.client.storage.from('media').upload(this.mediaPath(id), blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
      if (error) throw error;
      done.add(id);
      sent++;
      await this.store.db.setMeta(key, [...done]);
    }
    if (sent) this.set({ mediaSent: (this.status.mediaSent ?? 0) + sent });
    retryMissingMedia();
    return sent;
  }

  private installMediaFetcher() {
    if (!this.client || !this.session) { setRemoteMediaFetcher(null); return; }
    setRemoteMediaFetcher(async (id) => {
      if (!this.client || !this.session) return null;
      const { data, error } = await this.client.storage.from('media').download(this.mediaPath(id));
      if (error || !data) return null;
      return data;
    });
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
  /** Sauvegardes en ligne : quotidiennes (sans libellé) et de sécurité (libellé), 30 de chaque gardées par le serveur. */
  async listBackups(): Promise<{ id: number; created_at: string; label?: string | null; made_at?: string | null }[]> {
    if (!this.client) return [];
    const { data, error } = await this.client.from('backups').select('id, created_at, label:data->>label, made_at:data->>exportedAt').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data ?? [];
  }

  /** Envoie une sauvegarde en ligne puis la relit pour vérifier qu'elle est complète. Renvoie son numéro. */
  async uploadVerifiedBackup(file: ExportFile): Promise<number> {
    if (!this.client || !this.session) throw new Error('Non connectée');
    // déjà envoyée (ex. réponse perdue lors d'une coupure) ? on la réutilise au lieu d'en créer une seconde
    let id: number | undefined;
    if (file.label) {
      const { data: found, error: findError } = await this.client.from('backups').select('id').eq('data->>label', file.label).eq('data->>exportedAt', file.exportedAt).order('id', { ascending: true }).limit(1);
      if (findError) throw findError;
      id = (found as { id: number }[] | null)?.[0]?.id;
    }
    if (id === undefined) {
      const { data, error } = await this.client.from('backups').insert({ user_id: this.session.user.id, data: file }).select('id').single();
      if (error) throw error;
      id = (data as { id: number }).id;
    }
    const back = await this.fetchBackup(id);
    if (!back || fingerprint(back.data) !== fingerprint(file.data)) throw new Error('La copie en ligne relue ne correspond pas');
    return id;
  }

  /** Les sauvegardes de sécurité faites hors connexion partent en ligne dès le retour du réseau, de la plus ancienne à la plus récente (non bloquant). */
  private async uploadPendingSafety() {
    for (const s of await safetyBackups(this.store)) {
      if (s.remoteId) continue;
      try {
        const remoteId = await this.uploadVerifiedBackup(s.file);
        await markSafetyUploaded(this.store, s.madeAt, remoteId);
      } catch (e) {
        console.warn('Sauvegarde de sécurité pas encore envoyée', e);
        return; // on réessaiera à la prochaine synchronisation
      }
    }
  }
  /**
   * Journal des conflits (lecture seule) : versions écartées par le serveur (modification plus ancienne refusée)
   * et par cet appareil (modification locale remplacée par une version plus récente). Le plus récent en premier.
   */
  async listConflicts(): Promise<{ entries: ConflictView[]; serverError?: string }> {
    const entries: ConflictView[] = (await this.store.db.conflicts()).map((c) => ({ source: 'device', collection: c.collection, id: c.id, lost: c.lost, kept: c.kept, at: c.at }));
    let serverError: string | undefined;
    if (this.client && this.session) {
      const { data, error } = await this.client.from('record_conflicts').select('collection, id, lost, kept, at').order('at', { ascending: false }).limit(200);
      if (error) serverError = error.message;
      else for (const r of (data ?? []) as any[]) entries.push({ source: 'server', collection: r.collection, id: r.id, lost: r.lost, kept: r.kept, at: r.at });
    }
    entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { entries, serverError };
  }

  async fetchBackup(id: number): Promise<ExportFile> {
    const { data, error } = await this.client!.from('backups').select('data').eq('id', id).single();
    if (error) throw error;
    return data.data as ExportFile;
  }
}

// ---------- Export / import ----------
/** Une entrée du journal des conflits : la version gardée et la version écartée (jamais perdue). */
export interface ConflictView { source: 'server' | 'device'; collection: string; id: string; lost: any; kept: any; at: string }

export interface ExportFile { app: 'lx-planner'; version: 1; exportedAt: string; data: DataState; label?: string }

/**
 * Libellé EXACT qui identifie une sauvegarde de sécurité. Le serveur (supabase/schema.sql, backups_prune) classe une
 * sauvegarde « sécurité » uniquement si data->>'label' vaut exactement ce texte ; tout le reste est « quotidienne ».
 * Ne jamais modifier ce texte sans mettre à jour la règle serveur.
 */
export const SAFETY_LABEL = 'Sauvegarde de sécurité avant restauration';
/** Même règle de classement que le serveur. */
export const isSafetyLabel = (label: string | null | undefined) => label === SAFETY_LABEL;
/** Sauvegarde de sécurité gardée sur l'appareil (et en ligne quand c'est possible). */
export interface SafetyBackup { file: ExportFile; madeAt: string; remoteId?: number }
/** Résultat de la sauvegarde de sécurité : la copie locale est toujours faite et vérifiée ; la copie en ligne quand c'est possible. */
export interface SafetyResult { madeAt: string; remote: 'ok' | 'none' | 'failed'; remoteError?: string }

/**
 * Sauvegardes de sécurité gardées sur l'appareil : les 5 plus récentes, et TOUTES celles pas encore en ligne
 * (jamais supprimées tant qu'elles ne sont pas en ligne). Au-delà de 10 en attente, une nouvelle restauration est bloquée.
 */
export const SAFETY_KEEP = 5;
export const SAFETY_MAX = 10;
/** À partir de ce nombre de copies en attente, l'avertissement est renforcé. */
export const SAFETY_WARN = 8;
const SAFETY_KEY = 'safetyBackups';

/** Sauvegardes de sécurité gardées sur l'appareil, de la plus ancienne à la plus récente. */
export async function safetyBackups(store = getStore()): Promise<SafetyBackup[]> {
  const list = await store.db.getMeta<SafetyBackup[]>(SAFETY_KEY);
  if (Array.isArray(list)) return list;
  const old = await store.db.getMeta<SafetyBackup>('safetyBackup'); // format d'avant (une seule copie)
  return old ? [old] : [];
}

/** Ne retire une copie ancienne que si elle est déjà en ligne ; une copie pas encore en ligne n'est JAMAIS retirée. */
export function pruneSafety(list: SafetyBackup[]): SafetyBackup[] {
  const sorted = [...list].sort((a, b) => a.madeAt.localeCompare(b.madeAt));
  const recent = new Set(sorted.slice(-SAFETY_KEEP).map((s) => s.madeAt));
  return sorted.filter((s) => recent.has(s.madeAt) || !s.remoteId);
}

/** Nombre de sauvegardes de sécurité de cet appareil qui attendent d'être envoyées en ligne. */
export const safetyWaiting = async (store = getStore()) => (await safetyBackups(store)).filter((s) => !s.remoteId).length;

async function writeSafety(store: Store, list: SafetyBackup[]) {
  await store.db.setMeta(SAFETY_KEY, pruneSafety(list));
  if (await store.db.getMeta('safetyBackup')) await store.db.setMeta('safetyBackup', null); // ancien format : repris dans la liste
}

async function markSafetyUploaded(store: Store, madeAt: string, remoteId: number) {
  const list = await safetyBackups(store);
  await writeSafety(store, list.map((s) => (s.madeAt === madeAt ? { ...s, remoteId } : s)));
}

/** Empreinte d'un jeu de données (identifiants + dates de modification) pour vérifier une copie relue. */
export function fingerprint(data: Partial<Record<string, Record<string, any>>>): string {
  return COLLECTIONS.map((c) => `${c}:${Object.values(data[c] ?? {}).map((r: any) => `${r.id}@${new Date(r.updatedAt).getTime()}${r.deleted ? 'x' : ''}`).sort().join(',')}`).join('|');
}

/**
 * Sauvegarde de sécurité AVANT une restauration : copie complète de l'état actuel de l'appareil, y compris les
 * modifications pas encore synchronisées et les historiques (tarifs, modules). Elle est enregistrée sur l'appareil
 * puis relue et vérifiée ; en cas d'échec, une erreur est levée et la restauration ne doit pas avoir lieu.
 * Si l'appareil est connecté à un compte, une copie en ligne est aussi faite et vérifiée.
 */
export async function makeSafetyBackup(store = getStore(), engine?: SyncEngine | null): Promise<SafetyResult> {
  await store.flushed();
  const madeAt = new Date().toISOString();
  const file: ExportFile = { ...structuredClone(exportData(store)), exportedAt: madeAt, label: SAFETY_LABEL };
  const expected = fingerprint(file.data);
  const before = await safetyBackups(store);
  const waiting = before.filter((s) => !s.remoteId).length;
  if (waiting >= SAFETY_MAX) {
    throw new Error(`Restauration bloquée : ${waiting} sauvegardes de sécurité attendent déjà d’être envoyées en ligne et aucune copie supplémentaire ne peut être conservée. Reconnectez-vous à Internet et attendez leur envoi (Réglages › Sauvegarde & export), puis recommencez. Rien n’a été modifié.`);
  }
  try {
    await writeSafety(store, [...before, { file, madeAt }]);
    const after = await safetyBackups(store);
    const back = after.find((s) => s.madeAt === madeAt);
    if (!back || fingerprint(back.file.data) !== expected) throw new Error('copie relue incomplète');
    // contrôle : aucune copie pas encore en ligne n'a disparu
    if (before.some((s) => !s.remoteId && !after.some((a) => a.madeAt === s.madeAt))) throw new Error('une copie non envoyée a disparu');
  } catch (e: any) {
    throw new Error(`Sauvegarde de sécurité impossible (${e?.message ?? e}) : la restauration est annulée, rien n’a été modifié.`);
  }
  if (!engine?.client || !engine.session) return { madeAt, remote: 'none' };
  try {
    const remoteId = await engine.uploadVerifiedBackup(file);
    await markSafetyUploaded(store, madeAt, remoteId);
    return { madeAt, remote: 'ok' };
  } catch (e: any) {
    return { madeAt, remote: 'failed', remoteError: String(e?.message ?? e) };
  }
}

/** Dernière sauvegarde de sécurité gardée sur cet appareil (pour revenir à l'état d'avant la restauration). */
export const lastSafetyBackup = async (store = getStore()) => { const l = await safetyBackups(store); return l[l.length - 1]; };
export function exportData(store = getStore()): ExportFile {
  return { app: 'lx-planner', version: 1, exportedAt: new Date().toISOString(), data: store.state };
}
/**
 * Collections présentes dans toutes les versions de l'app. Une sauvegarde faite avant l'ajout d'une collection
 * (ex. LX Academy) reste restaurable : les collections absentes sont simplement considérées comme vides.
 */
const CORE_COLLECTIONS: CollectionName[] = ['items', 'series', 'categories', 'objectives', 'projects', 'ideas', 'habits', 'habitLogs', 'goals', 'goalLogs', 'challenges', 'reviews', 'settings'];
export function validateExport(x: any): x is ExportFile {
  if (!(x && x.app === 'lx-planner' && x.data && typeof x.data === 'object')) return false;
  if (!CORE_COLLECTIONS.every((c) => typeof x.data[c] === 'object')) return false;
  for (const c of COLLECTIONS) x.data[c] ??= {};
  return true;
}

/**
 * Restaure un export. Exige une sauvegarde de sécurité faite juste avant (makeSafetyBackup) : sans elle, rien n'est fait.
 * Les fiches de la sauvegarde sont réécrites avec un horodatage neuf pour qu'elles gagnent la synchronisation ;
 * les fiches absentes de la sauvegarde (créées depuis, même pas encore envoyées) sont conservées telles quelles.
 */
export async function restoreExport(file: ExportFile, store: Store, safety: SafetyResult) {
  const s = await lastSafetyBackup(store);
  if (!safety || !s || s.madeAt !== safety.madeAt) throw new Error('Restauration refusée : aucune sauvegarde de sécurité vérifiée.');
  await store.flushed();
  const current = store.state;
  const data: any = {};
  for (const c of COLLECTIONS) {
    data[c] = { ...(current[c] ?? {}) };
    // horodatage neuf et strictement croissant (même horloge que les modifications) : une modification faite juste après gagne
    for (const r of Object.values((file.data as any)[c] ?? {}) as any[]) data[c][r.id] = { ...r, updatedAt: stamp() };
  }
  await store.replaceAll(data);
  if (store === getStore()) getSync().schedule(200);
}

/** Signature de la liste des collections : quand elle change (nouvelle version de l'app), on récupère tout le compte une fois. */
export const COLLECTIONS_SIGNATURE = COLLECTIONS.join(',');

let _engine: SyncEngine | null = null;
export const getSync = () => (_engine ??= new SyncEngine(getStore()));
