import {
  addDays as fnsAddDays,
  addMonths as fnsAddMonths,
  differenceInCalendarDays,
  format,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfISOWeek,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import type { DateStr, TimeStr } from '../data/types';

/** Toutes les dates « jour » sont manipulées en chaînes AAAA-MM-JJ locales pour éviter les décalages de fuseau. */
export const toDateStr = (d: Date): DateStr => format(d, 'yyyy-MM-dd');
export const parseDate = (s: DateStr): Date => parseISO(s);
export const today = (): DateStr => toDateStr(new Date());
export const addDays = (s: DateStr, n: number): DateStr => toDateStr(fnsAddDays(parseDate(s), n));
export const addMonths = (s: DateStr, n: number): DateStr => toDateStr(fnsAddMonths(parseDate(s), n));
export const diffDays = (a: DateStr, b: DateStr): number => differenceInCalendarDays(parseDate(a), parseDate(b));
export const weekday = (s: DateStr): number => parseDate(s).getDay(); // 0 = dimanche
export const isSunday = (s: DateStr) => weekday(s) === 0;

/** Les semaines commencent le lundi */
export const weekStart = (s: DateStr): DateStr => toDateStr(startOfISOWeek(parseDate(s)));
export const weekDays = (s: DateStr): DateStr[] => {
  const st = weekStart(s);
  return Array.from({ length: 7 }, (_, i) => addDays(st, i));
};
export const monthStart = (s: DateStr): DateStr => toDateStr(startOfMonth(parseDate(s)));
export const monthEnd = (s: DateStr): DateStr => toDateStr(endOfMonth(parseDate(s)));
export const yearStart = (s: DateStr): DateStr => `${s.slice(0, 4)}-01-01`;
export const yearEnd = (s: DateStr): DateStr => `${s.slice(0, 4)}-12-31`;
export const isoWeekKey = (s: DateStr) => {
  const d = parseDate(s);
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, '0')}`;
};
export const isoWeekNumber = (s: DateStr) => getISOWeek(parseDate(s));

/** Grille de mois (lundi → dimanche), 5 ou 6 semaines */
export const monthGrid = (s: DateStr): DateStr[] => {
  const first = weekStart(monthStart(s));
  const last = monthEnd(s);
  const days: DateStr[] = [];
  let d = first;
  while (d <= last || days.length % 7 !== 0) {
    days.push(d);
    d = addDays(d, 1);
  }
  return days;
};

export const inRange = (d: DateStr | undefined, start: DateStr, end: DateStr) => !!d && d >= start && d <= end;

export const daysBetween = (start: DateStr, end: DateStr): DateStr[] => {
  const out: DateStr[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
};

// ---- Heures ----
export const timeToMin = (t: TimeStr): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};
export const minToTime = (m: number): TimeStr => {
  const c = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
};
export const nowMin = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};

// ---- Affichage (français) ----
export const fmt = (s: DateStr, pattern: string) => format(parseDate(s), pattern, { locale: fr });
export const fmtLong = (s: DateStr) => cap(fmt(s, 'EEEE d MMMM yyyy'));
export const fmtDay = (s: DateStr) => cap(fmt(s, 'EEEE d MMMM'));
export const fmtShort = (s: DateStr) => fmt(s, 'd MMM');
export const fmtMonth = (s: DateStr) => cap(fmt(s, 'MMMM yyyy'));
export const fmtDuration = (min: number) => {
  if (!min) return '0 min';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
};
export const fmtHours = (min: number) => `${(Math.round((min / 60) * 10) / 10).toLocaleString('fr-FR')} h`;
export const fmtTime = (t: TimeStr) => {
  const [h, m] = t.split(':');
  return `${+h}h${m}`;
};
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const WEEKDAYS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
