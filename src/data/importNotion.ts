// Import de la Banque d'idées depuis Notion (base « Contenus Instagram ») → fiches contenu complètes.
// Règles :
//  - l'identifiant de chaque fiche = celui de la page Notion → ré-importer, ou importer sur un 2e appareil,
//    ne crée JAMAIS de doublon ;
//  - rien n'est écrasé : une fiche déjà présente (même supprimée depuis) est ignorée ;
//  - les cases cochées reflètent uniquement ce qui était indiqué dans Notion (statut, textes déjà rédigés).
import { getStore } from './store';
import { toDateStr } from '../lib/date';
import type { ContentCheck, ContentFormat, ContentGoal, ContentPiece, ContentPillar, DataState } from './types';

export interface NotionEntry {
  notionId: string;
  title: string;
  status?: string | null;
  format?: string | null;
  projet?: string | null;
  pilier?: string | null;
  objectif?: string | null;
  phase?: string | null;
  publishDate?: string | null; // ISO (date ou date-heure UTC)
  shootDate?: string | null;
  accroche?: string | null;
  script?: string | null;
  legende?: string | null;
  cta?: string | null;
  materiel?: string[] | null;
  links?: string[] | null;
  body?: string | null;
  createdTime?: string | null;
}
export interface NotionBundle { app: 'lx-planner-import'; version: 1; source: 'notion'; exportedAt: string; entries: NotionEntry[] }

export const isNotionBundle = (x: any): x is NotionBundle => x?.app === 'lx-planner-import' && x?.source === 'notion' && Array.isArray(x?.entries);

/** UUID stable dérivé d'une chaîne (même entrée → même identifiant, sur tous les appareils). */
export function stableId(seed: string): string {
  const h = (salt: number) => {
    let x = 0x811c9dc5 ^ salt;
    for (let i = 0; i < seed.length; i++) {
      x ^= seed.charCodeAt(i);
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    return x.toString(16).padStart(8, '0');
  };
  const hex = h(1) + h(2) + h(3) + h(4);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** Identifiant Notion (32 hex) → UUID avec tirets */
export const notionUuid = (id: string) => {
  const h = id.replace(/-/g, '').toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const FORMAT: Record<string, ContentFormat> = { Reel: 'reel', Carrousel: 'carousel', 'Post photo': 'photo', Story: 'story', Live: 'live' };
const GOAL: Record<string, ContentGoal> = { Visibilité: 'visibility', Confiance: 'trust', Conversion: 'conversion' };
const PILLAR: Record<string, ContentPillar> = {
  'Éducation': 'education', 'Preuve et témoignages': 'social_proof', Coulisses: 'behind', 'Vente et lancement': 'sales', 'Communauté': 'community',
};
/** Étapes faites selon le statut Notion (pipeline Idée → À rédiger → À tourner → À monter → Prêt → Programmé → Publié) */
const DONE_BY_STATUS: Record<string, ContentCheck[]> = {
  '🎬 À tourner': ['script'],
  '✂️ À monter': ['script', 'shot'],
  '✅ Prêt': ['script', 'shot', 'edited'],
  '📅 Programmé': ['script', 'shot', 'edited', 'caption', 'cover'],
  '🚀 Publié': ['script', 'shot', 'edited', 'caption', 'cover', 'posted_instagram'],
};
const clean = (s?: string | null) => (s ?? '').replace(/\r/g, '').trim();

/** Date ISO Notion → jour local (+ heure locale si une heure est précisée) */
function localDate(iso: string): { date: string; time?: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { date: iso };
  const d = new Date(iso.replace(' ', 'T'));
  return { date: toDateStr(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
}

function notesOf(e: NotionEntry): string | undefined {
  const parts: string[] = [];
  if (clean(e.body)) parts.push(clean(e.body));
  if (e.materiel?.length) parts.push(`Matériel : ${e.materiel.join(', ')}`);
  if (e.links?.length) parts.push(`Liens :\n${e.links.join('\n')}`);
  return parts.join('\n\n') || undefined;
}

export function contentFromNotion(e: NotionEntry, now = new Date().toISOString()): ContentPiece {
  const done = new Set<ContentCheck>(DONE_BY_STATUS[e.status ?? ''] ?? []);
  if (clean(e.script)) done.add('script');
  if (clean(e.legende)) done.add('caption');
  const pub = e.publishDate ? localDate(e.publishDate) : undefined;
  const format = FORMAT[e.format ?? ''] ?? 'reel';
  return {
    id: notionUuid(e.notionId),
    createdAt: e.createdTime ? new Date(e.createdTime.replace(' ', 'T')).toISOString() : now,
    updatedAt: now,
    title: clean(e.title) || 'Idée sans titre',
    format,
    goal: GOAL[e.objectif ?? ''],
    pillar: PILLAR[e.pilier ?? ''],
    hook: clean(e.accroche) || undefined,
    script: clean(e.script) || undefined,
    cta: clean(e.cta) || undefined,
    caption: clean(e.legende) || undefined,
    notes: notesOf(e),
    tags: [e.projet, e.phase].filter(Boolean) as string[],
    platforms: ['instagram'],
    shootDate: e.shootDate ? localDate(e.shootDate).date : undefined,
    publishDate: pub?.date,
    publishTime: pub?.time,
    checks: Object.fromEntries([...done].map((c) => [c, true])),
  };
}

export interface ImportPlan { contents: ContentPiece[]; skipped: { title: string; reason: string }[] }

/** Calcule ce qui sera créé (sans rien écrire) — sert à l'aperçu avant confirmation. */
export function planNotionImport(state: DataState, bundle: NotionBundle, now = new Date().toISOString()): ImportPlan {
  const plan: ImportPlan = { contents: [], skipped: [] };
  for (const e of bundle.entries) {
    const c = contentFromNotion(e, now);
    // déjà présente : comme fiche contenu, ou comme ancienne « idée » (convertie au démarrage avec le même identifiant)
    if (state.contents[c.id] || state.ideas[c.id]) { plan.skipped.push({ title: c.title, reason: 'déjà importée' }); continue; }
    plan.contents.push(c);
  }
  return plan;
}

/** Écrit le plan d'import en une seule transaction. */
export function applyNotionImport(plan: ImportPlan) {
  const store = getStore();
  store.transact(() => { for (const c of plan.contents) store.create('contents', c); });
  return { contents: plan.contents.length, skipped: plan.skipped.length };
}
