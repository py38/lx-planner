import { useEffect, useState, useSyncExternalStore } from 'react';
import { getStore, useData } from '../data/store';
import { getSync, loadConfig, saveConfig, exportData, validateExport, type ExportFile } from '../data/sync';
import { useUI } from '../ui/UI';
import { Sheet } from '../ui/kit';
import { notificationsSupported } from '../logic/reminders';
import { IconDownload, IconUpload, IconCloud, IconTrash } from '../ui/Icons';
import type { Category, Settings } from '../data/types';

export function SettingsView() {
  return (
    <div>
      <div className="page-head"><div className="title-block"><div className="eyebrow">Réglages</div><h1>Paramètres</h1></div></div>
      <SyncSection />
      <BackupSection />
      <NotificationSection />
      <PreferencesSection />
      <CategoriesSection />
    </div>
  );
}

function useSync() {
  const s = getSync();
  return useSyncExternalStore(s.subscribe, s.getStatus);
}

function SyncSection() {
  const status = useSync();
  const ui = useUI();
  const sync = getSync();
  const cfg = loadConfig();
  const [url, setUrl] = useState(cfg?.url ?? '');
  const [key, setKey] = useState(cfg?.anonKey ?? '');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [backups, setBackups] = useState<{ id: number; created_at: string }[] | null>(null);
  const envConfigured = !!import.meta.env.VITE_SUPABASE_URL;

  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setErr('');
    try { await fn(); } catch (e: any) { setErr(translate(e?.message ?? String(e))); } finally { setBusy(false); }
  };

  const phaseLabel: Record<string, string> = {
    'not-configured': 'Non configurée — vos données sont enregistrées uniquement sur cet appareil.',
    'signed-out': 'Configurée — connectez-vous pour synchroniser.',
    idle: 'Synchronisée',
    syncing: 'Synchronisation en cours…',
    offline: 'Hors ligne — les modifications seront envoyées au retour du réseau.',
    error: 'Erreur de synchronisation',
  };

  return (
    <div className="card">
      <div className="card-head"><h3><IconCloud size={15} /> Compte & synchronisation</h3><span className={`tag ${status.phase === 'idle' ? 'ok' : status.phase === 'error' ? 'danger' : status.phase === 'offline' || status.phase === 'syncing' ? 'warn' : ''}`}>{status.phase === 'idle' ? 'Actif' : status.phase === 'not-configured' ? 'Local uniquement' : status.phase === 'signed-out' ? 'Déconnectée' : status.phase === 'error' ? 'Erreur' : status.phase === 'offline' ? 'Hors ligne' : '…'}</span></div>
      <p className="small" style={{ marginTop: 0 }}>{phaseLabel[status.phase]}</p>
      {status.error && <div className="banner danger small" style={{ marginBottom: 10 }}>{translate(status.error)}</div>}
      {err && <div className="banner danger small" style={{ marginBottom: 10 }}>{err}</div>}

      {status.phase === 'not-configured' && (
        <div className="col">
          <p className="small muted" style={{ margin: 0 }}>Pour retrouver vos données sur un autre appareil, reliez l’app à votre projet Supabase (gratuit). Le guide pas à pas est dans le fichier <code>SYNCHRONISATION.md</code>.</p>
          <div className="field"><label>URL du projet Supabase</label><input className="input" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value.trim())} /></div>
          <div className="field"><label>Clé publique « anon »</label><input className="input" value={key} onChange={(e) => setKey(e.target.value.trim())} /></div>
          <button className="btn primary" disabled={!url || !key} onClick={() => { saveConfig({ url, anonKey: key }); window.location.reload(); }}>Enregistrer et activer</button>
        </div>
      )}

      {status.phase === 'signed-out' && (
        <div className="col">
          <div className="form-grid">
            <div className="field"><label>E-mail</label><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field"><label>Mot de passe</label><input className="input" type="password" autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></div>
          </div>
          <div className="row wrap">
            <button className="btn primary" disabled={busy || !email || !pwd} onClick={() => run(() => sync.signIn(email, pwd))}>Se connecter</button>
            <button className="btn" disabled={busy || !email || pwd.length < 6} onClick={() => run(async () => {
              const r = await sync.signUp(email, pwd);
              if (r.needsConfirmation) ui.toast('Compte créé : confirmez via le mail reçu, puis connectez-vous.');
            })}>Créer mon compte</button>
          </div>
          {!envConfigured && <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => { saveConfig(null); window.location.reload(); }}>Changer de projet Supabase</button>}
        </div>
      )}

      {(status.phase === 'idle' || status.phase === 'syncing' || status.phase === 'error' || status.phase === 'offline') && status.email && (
        <div className="col">
          <div className="small">Connectée : <b>{status.email}</b></div>
          <div className="small muted">Dernière synchronisation : {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('fr-FR') : 'jamais'} · {status.pending} modification(s) en attente d’envoi</div>
          <div className="small muted">Dernière sauvegarde distante : {status.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString('fr-FR') : 'aucune'} (automatique chaque jour)</div>
          <div className="row wrap">
            <button className="btn primary" disabled={busy || status.phase === 'syncing'} onClick={() => run(() => sync.syncNow())}>Synchroniser maintenant</button>
            <button className="btn" disabled={busy} onClick={() => run(async () => { await sync.backupNow(); ui.toast('Sauvegarde envoyée'); })}>Sauvegarder maintenant</button>
            <button className="btn" disabled={busy} onClick={() => run(async () => setBackups(await sync.listBackups()))}>Restaurer une sauvegarde…</button>
            <button className="btn ghost" onClick={async () => { if (await ui.confirm('Se déconnecter ? Les données restent sur cet appareil.', { ok: 'Se déconnecter' })) run(() => sync.signOut()); }}>Se déconnecter</button>
          </div>
        </div>
      )}

      {status.needsFirstSyncChoice && (
        <Sheet title="Ce compte contient déjà des données" onClose={() => {}}>
          <p className="small">Votre compte contient déjà {status.needsFirstSyncChoice.remoteCount} élément(s). Que faire avec les données de cet appareil ?</p>
          <div className="col">
            <button className="btn primary" style={{ whiteSpace: 'normal' }} onClick={() => run(() => sync.linkDevice('download'))}>Récupérer les données du compte (recommandé pour un nouvel appareil)</button>
            <button className="btn" style={{ whiteSpace: 'normal' }} onClick={() => run(() => sync.linkDevice('merge'))}>Fusionner avec les données de cet appareil</button>
          </div>
          <p className="tiny faint">Conseil : exportez d’abord une sauvegarde de cet appareil si vous y avez saisi des choses importantes.</p>
        </Sheet>
      )}

      {backups && (
        <Sheet title="Sauvegardes distantes" onClose={() => setBackups(null)}>
          {backups.length ? backups.map((b) => (
            <div key={b.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{new Date(b.created_at).toLocaleString('fr-FR')}</span>
              <button className="btn small" onClick={async () => {
                if (!(await ui.confirm('Remplacer toutes les données actuelles par cette sauvegarde ? (Elle sera ensuite synchronisée sur vos autres appareils.)', { ok: 'Restaurer', danger: true }))) return;
                await run(async () => { const f = await sync.fetchBackup(b.id); await restore(f); setBackups(null); ui.toast('Sauvegarde restaurée'); });
              }}>Restaurer</button>
            </div>
          )) : <p className="small muted">Aucune sauvegarde.</p>}
        </Sheet>
      )}
    </div>
  );
}

/** Restaure un export : toutes les données sont réécrites avec un horodatage neuf pour qu'elles gagnent la synchronisation. */
async function restore(file: ExportFile) {
  const now = Date.now();
  const data: any = {};
  for (const [c, recs] of Object.entries(file.data)) {
    data[c] = {};
    Object.values(recs as any).forEach((r: any, i) => { data[c][r.id] = { ...r, updatedAt: new Date(now + i).toISOString() }; });
  }
  await getStore().replaceAll(data);
  getSync().schedule(200);
}

function BackupSection() {
  const ui = useUI();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null)); }, []);
  const download = () => {
    const blob = new Blob([JSON.stringify(exportData(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lx-planner-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (!validateExport(json)) throw new Error('Fichier non reconnu');
      if (!(await ui.confirm(`Remplacer toutes les données par la sauvegarde du ${new Date(json.exportedAt).toLocaleString('fr-FR')} ?`, { ok: 'Restaurer', danger: true }))) return;
      await restore(json);
      ui.toast('Sauvegarde restaurée');
    } catch (e: any) {
      ui.toast(`Import impossible : ${e?.message ?? e}`);
    }
  };
  return (
    <div className="card">
      <div className="card-head"><h3>Sauvegarde & export</h3></div>
      <div className="row wrap">
        <button className="btn" onClick={download}><IconDownload size={16} /> Exporter mes données (.json)</button>
        <label className="btn" style={{ cursor: 'pointer' }}><IconUpload size={16} /> Restaurer un fichier<input type="file" accept="application/json,.json" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Stockage de cet appareil : {persisted === true ? 'protégé contre l’effacement automatique ✓' : persisted === false ? 'non protégé' : 'statut inconnu'}.
        {persisted === false && <> <button className="btn small" onClick={async () => setPersisted(await navigator.storage.persist())}>Demander la protection</button></>}
        {' '}Sur iPhone, ajoutez l’app à l’écran d’accueil : Safari peut sinon effacer les données d’un site non utilisé pendant 7 jours.
      </p>
    </div>
  );
}

function NotificationSection() {
  const ui = useUI();
  const st = getStore().settings;
  const [perm, setPerm] = useState(notificationsSupported() ? Notification.permission : 'unsupported');
  return (
    <div className="card">
      <div className="card-head"><h3>Rappels & notifications</h3></div>
      <p className="small" style={{ marginTop: 0 }}>Les rappels sont toujours visibles dans l’application (bandeau et page « Alertes »).</p>
      {perm === 'unsupported' ? (
        <p className="small muted">Ce navigateur ne permet pas les notifications. Sur iPhone : ajoutez l’app à l’écran d’accueil (iOS 16.4 ou plus), puis ouvrez-la depuis l’icône.</p>
      ) : perm === 'granted' ? (
        <label className="check"><input type="checkbox" checked={st.notificationsEnabled ?? true} onChange={(e) => getStore().update('settings', 'settings', { notificationsEnabled: e.target.checked } as Partial<Settings>)} /> Notifications système activées</label>
      ) : (
        <button className="btn" onClick={async () => { const p = await Notification.requestPermission(); setPerm(p); if (p === 'granted') { getStore().update('settings', 'settings', { notificationsEnabled: true }); ui.toast('Notifications autorisées'); } }}>Autoriser les notifications</button>
      )}
      <p className="tiny faint" style={{ marginBottom: 0 }}>
        Limite actuelle : les notifications système partent lorsque l’app est ouverte ou récemment utilisée. Pour être prévenue application fermée, il faut un envoi programmé par un serveur (« Web Push ») — non activé à ce jour. Aucun rappel n’est promis s’il ne peut pas être envoyé.
      </p>
    </div>
  );
}

function PreferencesSection() {
  const state = useData();
  const s = Object.values(state.settings)[0];
  if (!s) return null;
  const set = (p: Partial<Settings>) => getStore().update('settings', s.id, p);
  return (
    <div className="card">
      <div className="card-head"><h3>Organisation</h3></div>
      <div className="form-grid">
        <div className="field"><label>Début des créneaux suggérés</label><input className="input" type="time" value={s.dayStart} onChange={(e) => set({ dayStart: e.target.value })} /></div>
        <div className="field"><label>Fin des créneaux suggérés</label><input className="input" type="time" value={s.dayEnd} onChange={(e) => set({ dayEnd: e.target.value })} /></div>
        <div className="field"><label>Marge entre deux activités (min)</label><input className="input" type="number" min={0} step={5} value={s.bufferMin} onChange={(e) => set({ bufferMin: +e.target.value })} /></div>
        <div className="field"><label>Charge pro max par jour (h)</label><input className="input" type="number" min={1} max={16} step={0.5} value={s.maxDailyWorkMin / 60} onChange={(e) => set({ maxDailyWorkMin: Math.round(+e.target.value * 60) })} /></div>
        <label className="check full"><input type="checkbox" checked={s.sundayProtected} onChange={(e) => set({ sundayProtected: e.target.checked })} /> Protéger le dimanche (aucune suggestion pro ; avertissement si j’ajoute une activité pro)</label>
        <div className="field"><label>🔴 Alerte rouge des contenus cochés : jours avant publication</label><input className="input" type="number" min={1} max={30} value={s.urgencyDays ?? 3} onChange={(e) => set({ urgencyDays: Math.max(1, Math.min(30, +e.target.value || 3)) })} /></div>
        <label className="check full"><input type="checkbox" checked={s.showContentInPlanning !== false} onChange={(e) => set({ showContentInPlanning: e.target.checked })} /> Afficher mes publications et tournages (calendrier de contenu) dans mon planning</label>
        <label className="check full"><input type="checkbox" checked={!!s.mealBlock?.enabled} onChange={(e) => set({ mealBlock: { start: '12:30', duration: 60, ...s.mealBlock, enabled: e.target.checked } })} /> Réserver un temps de repas dans les suggestions</label>
        {s.mealBlock?.enabled && <>
          <div className="field"><label>Heure du repas</label><input className="input" type="time" value={s.mealBlock.start} onChange={(e) => set({ mealBlock: { ...s.mealBlock!, start: e.target.value } })} /></div>
          <div className="field"><label>Durée (min)</label><input className="input" type="number" min={15} step={15} value={s.mealBlock.duration} onChange={(e) => set({ mealBlock: { ...s.mealBlock!, duration: +e.target.value } })} /></div>
        </>}
        <div className="field"><label>Rappel RDV clientes (min avant)</label><input className="input" value={s.defaultReminders.appointment.join(', ')} onChange={(e) => set({ defaultReminders: { ...s.defaultReminders, appointment: e.target.value.split(',').map((x) => +x.trim()).filter((x) => x > 0) } })} /></div>
        <div className="field"><label>Rappel échéances (jours avant)</label><input className="input" value={s.defaultReminders.deadline.map((m) => m / 1440).join(', ')} onChange={(e) => set({ defaultReminders: { ...s.defaultReminders, deadline: e.target.value.split(',').map((x) => Math.round(+x.trim() * 1440)).filter((x) => x > 0) } })} /></div>
      </div>
      <div className="divider" />
      <div className="field"><label>Alerte de préparation des contenus (jours avant publication)</label><input className="input" style={{ maxWidth: 160 }} type="number" min={1} value={s.contentLeadDays} onChange={(e) => set({ contentLeadDays: +e.target.value })} /></div>
      <div className="label" style={{ margin: '12px 0 6px' }}>Étapes d’un projet de contenu</div>
      {s.contentSteps.map((st, i) => (
        <div key={st.role} className="row wrap" style={{ marginBottom: 6 }}>
          <input className="input grow" style={{ minWidth: 160 }} value={st.title} onChange={(e) => set({ contentSteps: s.contentSteps.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} />
          <label className="small row">J<input className="input" type="number" style={{ width: 70 }} value={st.offsetDays} onChange={(e) => set({ contentSteps: s.contentSteps.map((x, j) => j === i ? { ...x, offsetDays: +e.target.value } : x) })} /></label>
          <label className="small row"><input className="input" type="number" style={{ width: 80 }} step={15} value={st.duration} onChange={(e) => set({ contentSteps: s.contentSteps.map((x, j) => j === i ? { ...x, duration: +e.target.value } : x) })} />min</label>
        </div>
      ))}
      <div className="tiny faint">J-3 = trois jours avant la date de publication.</div>
    </div>
  );
}

function CategoriesSection() {
  const state = useData();
  const ui = useUI();
  const cats = Object.values(state.categories).filter((c) => !c.deleted).sort((a, b) => a.order - b.order);
  const upd = (id: string, p: Partial<Category>) => getStore().update('categories', id, p);
  const move = (i: number, d: number) => {
    const a = cats[i], b = cats[i + d];
    if (!a || !b) return;
    getStore().transact(() => { upd(a.id, { order: b.order }); upd(b.id, { order: a.order }); });
  };
  return (
    <div className="card">
      <div className="card-head"><h3>Catégories</h3>
        <button className="btn small" onClick={() => getStore().create('categories', { name: 'Nouvelle catégorie', color: '#8C7B6B', kind: 'pro', order: cats.length } as Category)}>+ Ajouter</button>
      </div>
      {cats.map((c, i) => (
        <div key={c.id} className="row wrap" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', opacity: c.archived ? 0.5 : 1 }}>
          <input type="color" value={c.color} onChange={(e) => upd(c.id, { color: e.target.value })} style={{ width: 34, height: 34, border: 0, background: 'none', padding: 0 }} aria-label="Couleur" />
          <input className="input grow" style={{ minWidth: 150 }} defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && upd(c.id, { name: e.target.value.trim() })} />
          <select className="input" style={{ width: 130 }} value={c.kind} onChange={(e) => upd(c.id, { kind: e.target.value as Category['kind'] })}>
            <option value="pro">Pro (bilans)</option><option value="perso">Perso</option>
          </select>
          <button className="icon-btn small ghost" aria-label="Monter" onClick={() => move(i, -1)}>↑</button>
          <button className="icon-btn small ghost" aria-label="Descendre" onClick={() => move(i, 1)}>↓</button>
          <button className="btn small ghost" onClick={() => upd(c.id, { archived: !c.archived })}>{c.archived ? 'Réactiver' : 'Archiver'}</button>
          <button className="icon-btn small ghost" aria-label="Supprimer" onClick={async () => {
            const used = Object.values(state.items).some((it) => !it.deleted && it.categoryId === c.id);
            if (!(await ui.confirm(used ? `« ${c.name} » est utilisée par des éléments existants. Ils resteront dans l’historique sans catégorie. Préférez « Archiver » pour garder vos statistiques. Supprimer quand même ?` : `Supprimer « ${c.name} » ?`, { ok: 'Supprimer', danger: true }))) return;
            getStore().remove('categories', c.id);
          }}><IconTrash size={15} /></button>
        </div>
      ))}
      <p className="tiny faint" style={{ marginBottom: 0 }}>Les catégories « Pro » apparaissent dans les bilans hebdomadaires, mensuels et annuels. Les tâches du futur centre vont dans « Business & Gestion ».</p>
    </div>
  );
}

function translate(msg: string) {
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(msg)) return 'Adresse e-mail non confirmée : ouvrez le mail de confirmation.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Serveur injoignable (connexion internet ou URL Supabase incorrecte).';
  if (/relation .* does not exist|Could not find the table/i.test(msg)) return 'Les tables ne sont pas créées dans Supabase : exécutez le fichier supabase/schema.sql.';
  if (/User already registered/i.test(msg)) return 'Un compte existe déjà avec cet e-mail : connectez-vous.';
  return msg;
}
