// Rappel mensuel d'export : une copie de toutes les données, rangée par l'utilisatrice en dehors de Supabase.
// Règle pure (sans affichage), testée dans tests/exportReminder.test.ts.
import type { Settings } from '../data/types';

/** Un export tous les 30 jours. */
export const EXPORT_EVERY_DAYS = 30;
/** « Plus tard » : le rappel revient 7 jours après. */
export const EXPORT_SNOOZE_DAYS = 7;

const DAY = 86_400_000;

/** Nombre de jours entiers depuis le dernier export (undefined si jamais exporté depuis l'arrivée du rappel). */
export function daysSinceExport(s: Pick<Settings, 'lastExportAt'> | undefined, now = new Date()): number | undefined {
  if (!s?.lastExportAt) return undefined;
  return Math.floor((now.getTime() - new Date(s.lastExportAt).getTime()) / DAY);
}

/** Le rappel s'affiche si aucun export n'a été fait depuis 30 jours (ou jamais), sauf pendant un « Plus tard ». */
export function exportReminderDue(s: Pick<Settings, 'lastExportAt' | 'exportReminderSnoozedUntil'> | undefined, now = new Date()): boolean {
  if (!s) return false;
  if (s.exportReminderSnoozedUntil && new Date(s.exportReminderSnoozedUntil).getTime() > now.getTime()) return false;
  const d = daysSinceExport(s, now);
  return d === undefined || d >= EXPORT_EVERY_DAYS;
}

/** Date jusqu'à laquelle le rappel est mis de côté après « Plus tard ». */
export const snoozeUntil = (now = new Date()) => new Date(now.getTime() + EXPORT_SNOOZE_DAYS * DAY).toISOString();
