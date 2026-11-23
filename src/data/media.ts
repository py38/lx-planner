// Images (couvertures de contenus, vignettes du feed).
// Elles sont redimensionnées (1350 px max) puis stockées en Blob dans IndexedDB, sur l'appareil.
// Limite connue : elles ne passent pas encore par la synchronisation Supabase (les textes, dates et l'ordre, si).
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
    pending.set(id, getStore().db.getMedia(id).then((b) => {
      if (!b) return null;
      const u = URL.createObjectURL(b);
      cache.set(id, u);
      return u;
    }).finally(() => pending.delete(id)));
  }
  return pending.get(id)!;
}

/** URL affichable d'une image (null = absente de cet appareil). */
export function useMediaUrl(id?: string): { url: string | null; missing: boolean } {
  const [url, setUrl] = useState<string | null>(id ? cache.get(id) ?? null : null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    setMissing(false);
    if (!id) { setUrl(null); return; }
    mediaUrl(id).then((u) => { if (!alive) return; setUrl(u); setMissing(!u); });
    return () => { alive = false; };
  }, [id]);
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
