import { timeToMin } from '../lib/date';
import type { DataState, DateStr, Item, TimeStr } from '../data/types';

export const normalizeName = (s?: string) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Rendez-vous déjà enregistrés qui ressemblent au rendez-vous à importer. */
export function findDuplicates(state: DataState, c: { date?: DateStr; start?: TimeStr; client?: string }): { item: Item; reason: string }[] {
  if (!c.date) return [];
  const name = normalizeName(c.client);
  const out: { item: Item; reason: string }[] = [];
  for (const it of Object.values(state.items)) {
    if (it.deleted || it.date !== c.date) continue;
    const sameClient = !!name && !!it.client && (normalizeName(it.client) === name || normalizeName(it.client).split(' ')[0] === name.split(' ')[0]);
    const closeTime = !!c.start && !!it.start && Math.abs(timeToMin(it.start) - timeToMin(c.start)) <= 30;
    if (it.kind === 'appointment' && sameClient && closeTime) out.push({ item: it, reason: 'Même cliente, même date et même horaire' });
    else if (sameClient) out.push({ item: it, reason: 'Même cliente le même jour' });
    else if (it.kind === 'appointment' && closeTime) out.push({ item: it, reason: 'Un rendez-vous existe déjà à cet horaire' });
  }
  return out;
}
