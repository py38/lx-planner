// Analyse du texte lu sur une capture d'écran de réservation (Planity, Instagram, SMS, agenda…).
// Le résultat n'est qu'une PROPOSITION : il est toujours affiché pour correction avant tout ajout.
import { addDays, toDateStr, today, weekday } from '../lib/date';
import type { DateStr, TimeStr } from '../data/types';

export interface ParsedBooking {
  date?: DateStr;
  start?: TimeStr;
  end?: TimeStr;
  duration?: number;
  service?: string;
  client?: string;
  extra?: string;
  confidence: { date: boolean; start: boolean; duration: boolean; service: boolean; client: boolean };
}

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, mar: 3, avril: 4, avr: 4, mai: 5, juin: 6,
  juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, sep: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12,
};
const DAYS: Record<string, number> = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };

const SERVICES = [
  'manucure russe', 'pose américaine', 'pose americaine', 'pose gel', 'pose capsule', 'pose chablon', 'capsules', 'chablon', 'gainage',
  'remplissage', 'dépose', 'depose', 'semi-permanent', 'semi permanent', 'vernis semi', 'gel x', 'gel-x', 'rallongement', 'nail art',
  'beauté des pieds', 'beaute des pieds', 'pédicure', 'pedicure', 'manucure', 'renforcement', 'baby boomer', 'french', 'ongle naturel', 'pose',
];

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad = (n: number) => String(n).padStart(2, '0');

/** Choisit l'année la plus plausible (la prochaine occurrence de cette date, en tolérant 2 mois dans le passé). */
function inferYear(month: number, day: number, ref: DateStr): number {
  const y = Number(ref.slice(0, 4));
  const candidate = `${y}-${pad(month)}-${pad(day)}`;
  return candidate < addDays(ref, -60) ? y + 1 : y;
}

function validDate(y: number, m: number, d: number) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function parseBookingText(raw: string, ref = today()): ParsedBooking {
  const text = raw.replace(/\r/g, '');
  const n = strip(text);
  const res: ParsedBooking = { confidence: { date: false, start: false, duration: false, service: false, client: false } };

  // ----- Date -----
  // 1) 24/11/2026, 24-11-26, 24.11
  let m = n.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : inferYear(mo, d, ref);
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && validDate(y, mo, d)) res.date = `${y}-${pad(mo)}-${pad(d)}`;
  }
  // 2) « lundi 24 novembre (2026) », « 24 nov. »
  if (!res.date) {
    const re = /\b(\d{1,2})(?:er)?\s+(janvier|janv|jan|fevrier|fevr|fev|mars|mar|avril|avr|mai|juin|juillet|juil|aout|septembre|sept|sep|octobre|oct|novembre|nov|decembre|dec)\.?(?:\s+(\d{4}))?/;
    m = n.match(re);
    if (m) {
      const d = +m[1], mo = MONTHS[m[2]];
      const y = m[3] ? +m[3] : inferYear(mo, d, ref);
      if (validDate(y, mo, d)) res.date = `${y}-${pad(mo)}-${pad(d)}`;
    }
  }
  // 3) « aujourd'hui », « demain », « lundi » seul
  if (!res.date) {
    if (/\baujourd'?hui\b/.test(n)) res.date = ref;
    else if (/\bapres-demain\b/.test(n)) res.date = addDays(ref, 2);
    else if (/\bdemain\b/.test(n)) res.date = addDays(ref, 1);
    else {
      const dm = n.match(/\b(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\b/);
      if (dm) {
        const target = DAYS[dm[1]];
        let delta = (target - weekday(ref) + 7) % 7;
        res.date = addDays(ref, delta);
      }
    }
  }
  res.confidence.date = !!res.date;

  // ----- Heures : 9h, 9h30, 09:30, 9 h 30, plage « 9h30 - 11h » -----
  const times: { t: TimeStr; idx: number }[] = [];
  const tre = /\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\b/g;
  let tm: RegExpExecArray | null;
  while ((tm = tre.exec(n))) {
    // ignore les durées du type « 1h30 » précédées de « durée »
    const before = n.slice(Math.max(0, tm.index - 10), tm.index);
    if (/duree|dure|\(/.test(before)) continue;
    times.push({ t: `${pad(+tm[1])}:${tm[2] ?? '00'}`, idx: tm.index });
  }
  if (times.length) {
    res.start = times[0].t;
    res.confidence.start = true;
    const range = n.slice(times[0].idx).match(/^\s*([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?\s*(?:-|–|—|a|à|>)\s*([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?/);
    if (range) {
      res.end = `${pad(+range[3])}:${range[4] ?? '00'}`;
      const d = (+range[3] * 60 + +(range[4] ?? 0)) - (+range[1] * 60 + +(range[2] ?? 0));
      if (d > 0) { res.duration = d; res.confidence.duration = true; }
    }
  }

  // ----- Durée explicite : « 1h30 », « 90 min », « durée : 2 h » -----
  if (!res.duration) {
    const dm = n.match(/(?:duree|dure|\()\s*:?\s*(\d{1,2})\s*h\s*(\d{2})?/) ?? n.match(/\b(\d{1,3})\s*(?:min|mn|minutes)\b/);
    if (dm) {
      res.duration = dm[0].includes('h') ? +dm[1] * 60 + +(dm[2] ?? 0) : +dm[1];
      res.confidence.duration = res.duration > 0 && res.duration < 600;
    }
  }

  // ----- Prestation -----
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const svc of SERVICES) {
    const idx = n.indexOf(strip(svc));
    if (idx >= 0) {
      const line = lines.find((l) => strip(l).includes(strip(svc)));
      res.service = line ? line.replace(/^\s*(prestation|service|soin|rdv|rendez-vous)\s*:?\s*/i, '').replace(/\s{2,}/g, ' ').slice(0, 80) : svc;
      res.confidence.service = true;
      break;
    }
  }

  // ----- Cliente -----
  const labelled = text.match(/(?:[Cc]lient(?:e)?|[Nn]om|[Rr]éservé par|[Rr]eserve par|[Aa]vec)[ \t]*:?[ \t]*([A-ZÀ-Ý][\p{L}'-]+(?:[ \t]+[A-ZÀ-Ý][\p{L}'.-]*)?)/u);
  if (labelled) {
    res.client = labelled[1].trim();
    res.confidence.client = true;
  } else {
    // une ligne courte composée d'un prénom (+ nom) capitalisé, qui n'est ni une date ni une prestation
    const cand = lines.find((l) => /^[A-ZÀ-Ý][\p{L}'-]+(?:[ \t]+[A-ZÀ-Ý][\p{L}'.-]*){0,2}$/u.test(l) && !DAYS[strip(l).split(' ')[0]] && !MONTHS[strip(l).split(' ')[0]] && !SERVICES.some((s) => strip(l).includes(strip(s))) && l.length <= 30);
    if (cand) res.client = cand;
  }

  // ----- Infos complémentaires : prix, téléphone, notes -----
  const extras: string[] = [];
  const price = text.match(/(\d{1,4}(?:[.,]\d{2})?)\s*€/);
  if (price) extras.push(`Prix : ${price[1]} €`);
  const phone = text.match(/(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}/);
  if (phone) extras.push(`Tél : ${phone[0]}`);
  const note = text.match(/(?:note|commentaire|remarque)\s*:?\s*(.+)/i);
  if (note) extras.push(note[1].trim());
  if (extras.length) res.extra = extras.join(' · ');

  return res;
}

export const isPlausibleDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= toDateStr(new Date(2000, 0, 1));
