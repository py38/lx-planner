// Rappels visibles dans l'application (et notifications natives si autorisées et l'app ouverte).
import { expandRange } from './recurrence';
import { addDays, parseDate, today } from '../lib/date';
import { getStore } from '../data/store';
import { materialize } from '../data/actions';
import type { DataState, ID, Item, Reminder, ViewItem } from '../data/types';

export function reminderTime(item: Item, r: Reminder): Date | null {
  let base: Date | null = null;
  if (r.anchor === 'start' && item.date) {
    base = parseDate(item.date);
    const [h, m] = (item.start ?? '09:00').split(':').map(Number);
    base.setHours(h, m, 0, 0);
  } else if (r.anchor === 'deadline' && item.deadline) {
    base = parseDate(item.deadline);
    base.setHours(9, 0, 0, 0);
  }
  if (!base) return null;
  return new Date(base.getTime() - r.offsetMin * 60000);
}

export interface DueReminder { item: ViewItem; reminder: Reminder; at: Date }

/** Rappels arrivés à échéance et non traités. */
export function dueReminders(state: DataState, now = new Date(), horizonMin = 0): DueReminder[] {
  const limit = new Date(now.getTime() + horizonMin * 60000);
  const out: DueReminder[] = [];
  const pool: ViewItem[] = [
    ...Object.values(state.items).filter((i) => !i.deleted && !i.seriesId),
    ...expandRange(state, addDays(today(), -7), addDays(today(), 30)).filter((i) => i.seriesId),
  ];
  for (const it of pool) {
    if (it.status === 'done' || !it.reminders?.length) continue;
    for (const r of it.reminders) {
      if (r.done || r.disabled) continue;
      if (r.snoozedUntil && new Date(r.snoozedUntil) > now) continue;
      const at = reminderTime(it, r);
      if (at && at <= limit) out.push({ item: it, reminder: r, at });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function patchReminder(itemId: ID, rid: ID, patch: Partial<Reminder>) {
  const store = getStore();
  store.transact(() => {
    const it = materialize(itemId);
    if (!it) return;
    // une occurrence matérialisée conserve les identifiants de rappel de sa série
    const reminders = (it.reminders ?? []).map((r) => (r.id === rid ? { ...r, ...patch } : r));
    store.update('items', it.id, { reminders });
  });
}
export const ackReminder = (itemId: ID, rid: ID) => patchReminder(itemId, rid, { done: true });
export const disableReminder = (itemId: ID, rid: ID) => patchReminder(itemId, rid, { disabled: true });
export const snoozeReminder = (itemId: ID, rid: ID, minutes: number) =>
  patchReminder(itemId, rid, { snoozedUntil: new Date(Date.now() + minutes * 60000).toISOString() });

export const REMINDER_PRESETS: { label: string; offsetMin: number; anchor: Reminder['anchor'] }[] = [
  { label: '10 min avant', offsetMin: 10, anchor: 'start' },
  { label: '1 h avant', offsetMin: 60, anchor: 'start' },
  { label: '1 jour avant', offsetMin: 24 * 60, anchor: 'start' },
  { label: '1 semaine avant', offsetMin: 7 * 24 * 60, anchor: 'start' },
  { label: "1 jour avant l'échéance", offsetMin: 24 * 60, anchor: 'deadline' },
  { label: "1 semaine avant l'échéance", offsetMin: 7 * 24 * 60, anchor: 'deadline' },
  { label: "2 semaines avant l'échéance", offsetMin: 14 * 24 * 60, anchor: 'deadline' },
];

export function describeReminder(r: Reminder) {
  const p = REMINDER_PRESETS.find((x) => x.offsetMin === r.offsetMin && x.anchor === r.anchor);
  if (p) return p.label;
  const m = r.offsetMin;
  const txt = m % 1440 === 0 ? `${m / 1440} j` : m % 60 === 0 ? `${m / 60} h` : `${m} min`;
  return `${txt} avant ${r.anchor === 'deadline' ? "l'échéance" : 'le début'}`;
}

// ---------- Notifications natives ----------
const NOTIFIED_KEY = 'lx-notified';
export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** Envoie une notification système pour les rappels échus — fonctionne seulement si l'app est ouverte (ou en arrière-plan récent). */
export async function notifyDue(state: DataState) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  let sent: string[] = [];
  try { sent = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '[]'); } catch { /* stockage indisponible */ }
  const due = dueReminders(state);
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  for (const d of due) {
    const key = `${d.item.id}:${d.reminder.id}:${d.reminder.snoozedUntil ?? ''}`;
    if (sent.includes(key)) continue;
    const body = `${d.item.start ? d.item.start.replace(':', 'h') + ' · ' : ''}${describeReminder(d.reminder)}`;
    try {
      if (reg) await reg.showNotification(d.item.title, { body, tag: key, icon: `${import.meta.env.BASE_URL}icon-512.png` });
      else new Notification(d.item.title, { body, tag: key });
      sent.push(key);
    } catch (e) {
      console.warn('Notification impossible', e);
    }
  }
  try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(sent.slice(-300))); } catch { /* ignore */ }
}
