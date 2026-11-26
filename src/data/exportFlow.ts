// Export « Exporter mes données (.json) » : création du fichier, fenêtre de partage sur iPhone, confirmation.
// La date du dernier export (rappel mensuel) n'est notée QUE si l'utilisatrice confirme avoir enregistré le fichier.
// Testé dans tests/exportFlow.test.ts.
import { getStore, type Store } from './store';
import { exportData } from './sync';

export type ExportOutcome =
  | { kind: 'shared'; fileName: string; exportedAt: string } // fenêtre de partage terminée (iPhone)
  | { kind: 'downloaded'; fileName: string; exportedAt: string } // fichier téléchargé (ordinateur)
  | { kind: 'cancelled'; fileName: string } // fenêtre de partage fermée sans rien faire
  | { kind: 'failed'; error: string }; // le fichier n'a pas pu être créé ni proposé

/** Ce dont l'export a besoin du navigateur (remplaçable dans les tests). */
export interface ExportEnv {
  /** true sur téléphone / tablette : on propose la fenêtre de partage Apple (« Enregistrer dans Fichiers »). */
  touch: boolean;
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[]; title?: string }) => Promise<void>;
  download: (blob: Blob, fileName: string) => void;
}

export function browserExportEnv(): ExportEnv {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    touch: typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
    canShare: nav?.canShare ? (d) => nav.canShare(d) : undefined,
    share: nav?.share ? (d) => nav.share(d) : undefined,
    download: (blob, fileName) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
  };
}

const errText = (e: unknown) => String((e as any)?.message ?? e);

/**
 * Crée le fichier et le propose. N'écrit RIEN dans les données (la date se note à part, après confirmation).
 * Doit être appelée directement depuis un clic (le partage iPhone l'exige).
 */
export async function produceExport(env: ExportEnv, store: Store = getStore()): Promise<ExportOutcome> {
  let file: File, blob: Blob, fileName: string, exportedAt: string;
  try {
    const data = exportData(store);
    exportedAt = data.exportedAt;
    fileName = `lx-planner-sauvegarde-${exportedAt.slice(0, 10)}.json`;
    blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    file = new File([blob], fileName, { type: 'application/json' });
  } catch (e) {
    return { kind: 'failed', error: `le fichier n’a pas pu être créé (${errText(e)})` };
  }
  if (env.touch && env.share && env.canShare?.({ files: [file] })) {
    try {
      await env.share({ files: [file], title: fileName });
      return { kind: 'shared', fileName, exportedAt };
    } catch (e: any) {
      if (e?.name === 'AbortError') return { kind: 'cancelled', fileName };
      // partage refusé par le navigateur : on essaie le téléchargement classique
    }
  }
  try {
    env.download(blob, fileName);
    return { kind: 'downloaded', fileName, exportedAt };
  } catch (e) {
    return { kind: 'failed', error: `le fichier n’a pas pu être proposé à l’enregistrement (${errText(e)})` };
  }
}

/** Note la date du dernier export (réglages synchronisés : le rappel disparaît sur tous les appareils). */
export function recordExport(at: string, store: Store = getStore()) {
  const s = store.settings;
  if (s) store.update('settings', s.id, { lastExportAt: at, exportReminderSnoozedUntil: undefined });
}

interface ExportUI {
  confirm: (text: string, opts?: { ok?: string; cancel?: string; title?: string }) => Promise<boolean>;
  toast: (text: string) => void;
}

/**
 * Export complet avec messages. Le navigateur ne peut pas savoir où le fichier a été rangé (ni même, sur ordinateur,
 * s'il a été gardé) : l'utilisatrice confirme donc elle-même, et la date n'est notée que sur « Oui ».
 */
export async function runExport(ui: ExportUI, env: ExportEnv = browserExportEnv(), store: Store = getStore()): Promise<ExportOutcome & { recorded: boolean }> {
  const r = await produceExport(env, store);
  if (r.kind === 'failed') {
    await ui.confirm(`L’export a échoué : ${r.error}. Aucune date n’a été modifiée et tes données ne sont pas touchées. Réessaie ; si le problème continue, préviens-moi.`, { title: 'Export impossible', ok: 'J’ai compris', cancel: '' });
    return { ...r, recorded: false };
  }
  if (r.kind === 'cancelled') {
    ui.toast('Export annulé : aucun fichier enregistré, la date du dernier export n’a pas changé.');
    return { ...r, recorded: false };
  }
  const where = r.kind === 'shared' ? 'dans Fichiers (iCloud Drive…) ou sur une clé USB' : 'dans un endroit sûr (iCloud Drive, clé USB…), pas seulement dans Téléchargements';
  const ok = await ui.confirm(`As-tu bien enregistré le fichier « ${r.fileName} » ${where} ?`, { title: 'Fichier enregistré ?', ok: 'Oui, il est enregistré', cancel: 'Non' });
  if (ok) {
    recordExport(r.exportedAt, store);
    ui.toast('Export noté ✓ Prochain rappel dans 30 jours.');
  } else {
    ui.toast('Date non notée : le rappel reste affiché. Tu peux refaire l’export quand tu veux.');
  }
  return { ...r, recorded: ok };
}
