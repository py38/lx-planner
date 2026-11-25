// Images (couvertures de contenus, vignettes du feed).
// Elles sont redimensionnées (1350 px max) puis stockées en Blob dans IndexedDB, sur l'appareil.
// Avec un compte connecté, elles sont aussi envoyées dans l'espace de stockage privé du compte (Supabase Storage)
// et téléchargées automatiquement sur les autres appareils au moment où on les affiche.
import { useEffect, useState } from 'react';
import { getStore } from './store';
import { uid } from '../lib/id';

const MAX = 1350;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

/** Redimensionne et compresse une image (JPEG) — un écran iPhone n'a pas besoin de plus. */
export async function compressImage(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((res) => canvas.toBlob((b) => res(b ?? file), 'image/jpeg', 0.86));
}

/** Récupération d'une image depuis le compte (fournie par la synchronisation quand une session est ouverte). */
type RemoteFetcher = (id: string) => Promise<Blob | null>;
let remoteFetcher: RemoteFetcher | null = null;
const failedAt = new Map<string, number>();
const RETRY_MS = 30_000;
const listeners = new Set<() => void>();
export function setRemoteMediaFetcher(f: RemoteFetcher | null) {
  remoteFetcher = f;
  failedAt.clear();
  listeners.forEach((l) => l()); // les images manquantes retentent leur chargement
}
/** Après une synchronisation : réessayer les images encore introuvables. */
export function retryMissingMedia() {
  failedAt.clear();
  listeners.forEach((l) => l());
}

export async function saveMedia(file: Blob): Promise<string> {
  const id = uid();
  const blob = await compressImage(file);
  await getStore().db.putMedia(id, blob);
  cache.set(id, URL.createObjectURL(blob));
  return id;
}

export async function mediaUrl(id: string): Promise<string | null> {
  if (cache.has(id)) return cache.get(id)!;
  if (!pending.has(id)) {
    pending.set(id, (async () => {
      let b = await getStore().db.getMedia(id);
      // absente de cet appareil : on la télécharge depuis le compte, puis on la garde (fonctionne ensuite hors connexion)
      if (!b && remoteFetcher && Date.now() - (failedAt.get(id) ?? 0) > RETRY_MS) {
        try {
          const remote = await remoteFetcher(id);
          if (remote) {
            await getStore().db.putMedia(id, remote);
            b = remote;
          } else failedAt.set(id, Date.now());
        } catch {
          failedAt.set(id, Date.now());
        }
      }
      if (!b) return null;
      const u = URL.createObjectURL(b);
      cache.set(id, u);
      return u;
    })().finally(() => pending.delete(id)));
  }
  return pending.get(id)!;
}

/** URL affichable d'une image (null = absente de cet appareil et du compte). */
export function useMediaUrl(id?: string): { url: string | null; missing: boolean } {
  const [url, setUrl] = useState<string | null>(id ? cache.get(id) ?? null : null);
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => {
    let alive = true;
    setMissing(false);
    if (!id) { setUrl(null); return; }
    mediaUrl(id).then((u) => { if (!alive) return; setUrl(u); setMissing(!u); });
    return () => { alive = false; };
  }, [id, tick]);
  return { url, missing };
}

/** Choisir un ou plusieurs fichiers image (ouvre la pellicule sur iPhone). */
export function pickImages(multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}
