import { describe, expect, it } from 'vitest';
import { exportReminderDue, daysSinceExport, snoozeUntil, EXPORT_EVERY_DAYS } from '../src/logic/exportReminder';

const now = new Date('2026-12-26T10:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe('rappel mensuel d’export', () => {
  it('s’affiche si aucun export n’a encore été noté', () => {
    expect(exportReminderDue({}, now)).toBe(true);
    expect(daysSinceExport({}, now)).toBeUndefined();
  });
  it('ne s’affiche pas avant 30 jours, puis s’affiche', () => {
    expect(exportReminderDue({ lastExportAt: ago(EXPORT_EVERY_DAYS - 1) }, now)).toBe(false);
    expect(exportReminderDue({ lastExportAt: ago(EXPORT_EVERY_DAYS) }, now)).toBe(true);
    expect(daysSinceExport({ lastExportAt: ago(45) }, now)).toBe(45);
  });
  it('« Plus tard » le met de côté 7 jours, puis il revient', () => {
    const until = snoozeUntil(now);
    expect(exportReminderDue({ exportReminderSnoozedUntil: until }, now)).toBe(false);
    expect(exportReminderDue({ exportReminderSnoozedUntil: until }, new Date(now.getTime() + 8 * 86_400_000))).toBe(true);
  });
  it('rien sans réglages (app pas encore chargée)', () => {
    expect(exportReminderDue(undefined, now)).toBe(false);
  });
});
