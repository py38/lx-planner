// Calendrier de contenu (distinct du planning) : tournages groupés, publications, feed Instagram.
import { addDays, weekday } from '../lib/date';
import { uid } from '../lib/id';
import type {
  ViewItem, ContentCheck, ContentFormat, ContentGoal, ContentPiece, ContentPillar, DataState, DateStr, FeedTile, Idea, Platform,
} from '../data/types';

export const FORMAT_LABEL: Record<ContentFormat, string> = { reel: 'Réel', carousel: 'Carrousel', photo: 'Photo', story: 'Story', live: 'Live' };
export const GOAL_LABEL: Record<ContentGoal, string> = { visibility: 'Visibilité', trust: 'Confiance', conversion: 'Conversion' };
export const PILLAR_LABEL: Record<ContentPillar, string> = {
  education: 'Éducatif', social_proof: 'Social proof', lifestyle: 'Lifestyle', behind: 'Coulisses', sales: 'Vente & marketing', community: 'Communauté',
};
export const PLATFORM_LABEL: Record<Platform, string> = { instagram: 'Instagram', tiktok: 'TikTok' };
export const CHECK_LABEL: Record<ContentCheck, string> = {
  script: 'Script écrit', shot: 'Tourné', edited: 'Monté', caption: 'Légende prête', cover: 'Couverture prête',
  posted_instagram: 'Posté sur Instagram', posted_tiktok: 'Posté sur TikTok',
};
export const FORMAT_COLOR: Record<ContentFormat, string> = { reel: '#B07D62', carousel: '#6F918A', photo: '#8A6A86', story: '#B8954A', live: '#6E5D4E' };

/** Étapes pertinentes pour un contenu, dans l'ordre de production. */
export function checksFor(p: Pick<ContentPiece, 'format' | 'platforms'>): ContentCheck[] {
  const out: ContentCheck[] = [];
  if (p.format !== 'photo') out.push('script');
  out.push('shot');
  if (p.format !== 'live') out.push('edited');
  if (p.format !== 'story' && p.format !== 'live') out.push('caption');
  if (p.format === 'reel' || p.format === 'carousel') out.push('cover');
  for (const pl of p.platforms) out.push(pl === 'instagram' ? 'posted_instagram' : 'posted_tiktok');
  return out;
}
export function contentProgress(p: ContentPiece) {
  const list = checksFor(p);
  const done = list.filter((c) => p.checks[c]).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}
export const isPosted = (p: ContentPiece) => p.platforms.length > 0 && p.platforms.every((pl) => p.checks[pl === 'instagram' ? 'posted_instagram' : 'posted_tiktok']);

export interface Rhythm { mode: 'daily' | 'every' | 'weekdays'; every?: number; weekdays?: number[]; skipSundays?: boolean }

/** Répartit N publications à partir d'une date selon un rythme (ex : 1 par jour, tous les 2 jours, lun-mer-ven). */
export function distributeDates(start: DateStr, count: number, r: Rhythm): DateStr[] {
  const out: DateStr[] = [];
  let d = start;
  let guard = 0;
  while (out.length < count && guard++ < 2000) {
    const wd = weekday(d);
    const okDay = r.mode === 'weekdays' ? (r.weekdays ?? []).includes(wd) : !(r.skipSundays && wd === 0);
    if (okDay) {
      out.push(d);
      d = addDays(d, r.mode === 'every' ? Math.max(1, r.every ?? 1) : 1);
    } else d = addDays(d, 1);
  }
  return out;
}

/** Récupère accroche / script / légende / CTA d'une idée (format de la Banque d'idées et de l'import Notion). */
export function parseIdeaContent(text = ''): { hook?: string; script?: string; caption?: string; cta?: string; notes?: string } {
  const sections: Record<string, string[]> = {};
  let cur = 'NOTES';
  const known: Record<string, string> = { ACCROCHE: 'hook', SCRIPT: 'script', 'LÉGENDE': 'caption', LEGENDE: 'caption', CTA: 'cta', NOTES: 'notes' };
  let prevBlank = false;
  for (const line of text.split('\n')) {
    const key = line.trim().toUpperCase();
    if (known[key]) { cur = key; prevBlank = false; continue; }
    // bloc d'informations ajouté par l'ancien import Notion (statut, dates, matériel, liens) → notes
    if (prevBlank && /^(Statut dans Notion|Tournage prévu|Publication prévue|Matériel|Liens)\s*:/.test(line.trim())) cur = 'NOTES';
    (sections[cur] ??= []).push(line);
    prevBlank = line.trim() === '';
  }
  const get = (k: string) => {
    const keys = Object.keys(known).filter((x) => known[x] === k);
    const v = keys.flatMap((x) => sections[x] ?? []).join('\n').trim();
    return v || undefined;
  };
  return { hook: get('hook'), script: get('script'), caption: get('caption'), cta: get('cta'), notes: get('notes') };
}

const TYPE_TO_FORMAT: Record<string, ContentFormat> = { reel: 'reel', post: 'photo' };
const TYPE_TAG: Record<string, string> = { formation: 'Sujet de formation', communication: 'Communication', script: 'Script', note: 'Note', inspiration: 'Inspiration', future: 'Projet futur' };
const TAG_GOAL: Record<string, ContentGoal> = { Visibilité: 'visibility', Confiance: 'trust', Conversion: 'conversion' };
const TAG_PILLAR: Record<string, ContentPillar> = {
  'Éducation': 'education', 'Preuve et témoignages': 'social_proof', Coulisses: 'behind', 'Vente et lancement': 'sales', 'Communauté': 'community',
};

/** Transforme une idée en contenu (les champs sont pré-remplis, tout reste modifiable). */
export function contentFromIdea(idea: Idea): Omit<ContentPiece, 'id' | 'createdAt' | 'updatedAt'> {
  const f = parseIdeaContent(idea.content);
  const tags = idea.tags ?? [];
  return {
    title: idea.title, format: TYPE_TO_FORMAT[idea.type] ?? 'reel',
    goal: tags.map((t) => TAG_GOAL[t]).find(Boolean), pillar: tags.map((t) => TAG_PILLAR[t]).find(Boolean),
    hook: f.hook, script: f.script, caption: f.caption, cta: f.cta, notes: f.notes,
    tags: [...(TYPE_TAG[idea.type] ? [TYPE_TAG[idea.type]] : []), ...tags.filter((t) => !TAG_GOAL[t] && !TAG_PILLAR[t])],
    platforms: ['instagram'], checks: { script: !!f.script, caption: !!f.caption }, ideaId: idea.id,
  };
}

/** Contenus regroupés par jour de tournage. */
export function shootDays(state: DataState): Map<DateStr, ContentPiece[]> {
  const m = new Map<DateStr, ContentPiece[]>();
  for (const c of Object.values(state.contents)) {
    if (c.deleted || !c.shootDate) continue;
    m.set(c.shootDate, [...(m.get(c.shootDate) ?? []), c]);
  }
  for (const [, l] of m) l.sort((a, b) => (a.publishDate ?? '9999').localeCompare(b.publishDate ?? '9999') || (a.order ?? 0) - (b.order ?? 0));
  return m;
}

// ---------- Feed ----------
export function moveTile<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}

/** Feed prévu à partir des contenus ayant une couverture : la publication la plus récente en haut à gauche. */
export function feedFromContents(contents: ContentPiece[]): FeedTile[] {
  return contents
    .filter((c) => !c.deleted && c.coverMediaId && c.format !== 'story' && c.format !== 'live')
    .sort((a, b) => (b.publishDate ?? '0000').localeCompare(a.publishDate ?? '0000') || (b.publishTime ?? '').localeCompare(a.publishTime ?? ''))
    .map((c) => ({ id: uid(), contentId: c.id, mediaId: c.coverMediaId, crop: c.coverCrop, label: c.title }));
}

/**
 * Proposer de nouvelles dates de publication pour respecter l'ordre choisi dans une simulation :
 * on réutilise les mêmes dates, redistribuées (vignette 1 = date la plus récente). Rien n'est appliqué ici.
 */
export function datesFromFeedOrder(tiles: FeedTile[], contents: Record<string, ContentPiece>): { id: string; title: string; from?: DateStr; to: DateStr }[] {
  const linked = tiles.map((t) => (t.contentId ? contents[t.contentId] : undefined)).filter((c): c is ContentPiece => !!c && !c.deleted && !!c.publishDate);
  const dates = linked.map((c) => c.publishDate!).sort().reverse();
  return linked.map((c, i) => ({ id: c.id, title: c.title, from: c.publishDate, to: dates[i] })).filter((x) => x.from !== x.to);
}

// ---------- Banque d'idées ----------
/** Une fiche sans date de tournage ni de publication est une idée « à planifier ». */
export const isBankIdea = (c: ContentPiece) => !c.shootDate && !c.publishDate;
export type BankFilter = 'todo' | 'planned' | 'posted' | 'all';
export function bankFilter(c: ContentPiece, f: BankFilter) {
  if (f === 'all') return true;
  if (f === 'posted') return isPosted(c);
  if (f === 'planned') return !isBankIdea(c) && !isPosted(c);
  return isBankIdea(c) && !isPosted(c);
}

/** Contenus à publier bientôt dont la préparation n'est pas terminée (tournage, montage, légende, couverture). */
export function contentPrepAlerts(contents: ContentPiece[], ref: DateStr, leadDays: number) {
  const out: { piece: ContentPiece; daysLeft: number; missing: ContentCheck[] }[] = [];
  for (const c of contents) {
    if (c.deleted || !c.publishDate || isPosted(c)) continue;
    const daysLeft = Math.round((new Date(c.publishDate).getTime() - new Date(ref).getTime()) / 86400000);
    if (daysLeft < 0 || daysLeft > leadDays) continue;
    const missing = checksFor(c).filter((k) => !k.startsWith('posted') && !c.checks[k]);
    if (missing.length) out.push({ piece: c, daysLeft, missing });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// ---------- Contenu dans le planning du quotidien ----------
export const isContentRef = (id: string) => id.startsWith('cp:') || id.startsWith('cs:');
export const publishRefId = (contentId: string) => `cp:${contentId}`;
export const shootRefId = (date: DateStr) => `cs:${date}`;
const PUBLISH_MIN = 30;

/**
 * Publications et journées de tournage du calendrier de contenu, présentées comme des éléments du planning.
 * Ce ne sont pas des copies : modifier l'un modifie l'autre.
 */
export function contentPlanningItems(state: DataState, start: DateStr, end: DateStr, opts: { always?: boolean } = {}): ViewItem[] {
  const settings = Object.values(state.settings)[0];
  if (!opts.always && settings?.showContentInPlanning === false) return [];
  const cat = Object.values(state.categories).find((c) => !c.deleted && c.name === 'Création de contenu');
  const out: ViewItem[] = [];
  const base = { createdAt: '', updatedAt: '', virtual: true, categoryId: cat?.id } as const;
  const shoots = new Map<DateStr, ContentPiece[]>();
  for (const c of Object.values(state.contents)) {
    if (c.deleted) continue;
    if (c.publishDate && c.publishDate >= start && c.publishDate <= end) {
      const posted = isPosted(c);
      out.push({
        ...base, id: publishRefId(c.id), kind: 'task',
        title: `📲 Publier · ${c.title}`,
        description: [FORMAT_LABEL[c.format], c.platforms.map((p) => PLATFORM_LABEL[p]).join(' + ')].filter(Boolean).join(' · '),
        date: c.publishDate, start: c.publishTime, duration: PUBLISH_MIN,
        priority: 'important', status: posted ? 'done' : 'todo',
        contentRef: { kind: 'publish', contentId: c.id },
      });
    }
    if (c.shootDate && c.shootDate >= start && c.shootDate <= end) shoots.set(c.shootDate, [...(shoots.get(c.shootDate) ?? []), c]);
  }
  // une journée de tournage déjà bloquée à la main dans le planning n'est pas affichée en double
  const blocked = new Set(Object.values(state.items).filter((i) => !i.deleted && i.date && i.title.startsWith('Journée de tournage')).map((i) => i.date));
  for (const [date, list] of shoots) {
    if (blocked.has(date)) continue;
    const shot = list.filter((c) => c.checks.shot).length;
    out.push({
      ...base, id: shootRefId(date), kind: 'event',
      title: `🎬 Tournage · ${list.length} contenu${list.length > 1 ? 's' : ''} (${shot}/${list.length})`,
      date, priority: 'important', status: shot === list.length ? 'done' : 'todo',
      contentRef: { kind: 'shoot', date, count: list.length, shot },
    });
  }
  return out;
}
