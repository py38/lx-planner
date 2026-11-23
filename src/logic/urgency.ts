// Repère « alerte rouge » — uniquement pour les contenus où l'option est cochée (ex : collab avec une marque).
//  - 'soon' : il reste N jours ou moins (3 par défaut) avant la publication et la vidéo n'est pas encore tournée ET montée
//  - 'late' : la date de publication (ou de tournage) est passée sans que ce soit fait
// Le reste du planning (rendez-vous, tâches, repas…) n'est jamais mis en rouge.
import { diffDays, today } from '../lib/date';
import { isPosted } from './contentPlan';
import type { ContentPiece, DataState, ViewItem } from '../data/types';

export type Urgency = 'late' | 'soon' | undefined;
export const DEFAULT_URGENCY_DAYS = 3;
export const URGENT_RED = '#C62828';

export const urgencyDays = (state: DataState) => Object.values(state.settings)[0]?.urgencyDays ?? DEFAULT_URGENCY_DAYS;
const worst = (a: Urgency, b: Urgency): Urgency => (a === 'late' || b === 'late' ? 'late' : a ?? b);

/** Prêt à publier = tourné et monté (pour une photo ou un live : tourné suffit). */
export const readyToPost = (c: ContentPiece) => !!c.checks.shot && (c.format === 'photo' || c.format === 'live' || !!c.checks.edited);

/** Urgence d'une fiche contenu (côté publication et côté tournage). Rien si l'alerte rouge n'est pas cochée. */
export function contentUrgency(c: ContentPiece, ref = today(), defaultDays = DEFAULT_URGENCY_DAYS): { publish: Urgency; shoot: Urgency; any: Urgency; daysLeft?: number } {
  const none = { publish: undefined, shoot: undefined, any: undefined };
  if (c.deleted || !c.redAlert || isPosted(c)) return none;
  const days = c.redAlertDays ?? defaultDays;
  let publish: Urgency;
  let shoot: Urgency;
  let daysLeft: number | undefined;
  if (c.publishDate) {
    daysLeft = diffDays(c.publishDate, ref);
    if (daysLeft < 0) publish = 'late';
    else if (daysLeft <= days && !readyToPost(c)) publish = 'soon';
  }
  if (c.shootDate && !c.checks.shot && diffDays(c.shootDate, ref) < 0) shoot = 'late';
  if (!c.checks.shot && publish) shoot = worst(shoot, publish); // pas encore tourné alors que la publication approche
  return { publish, shoot, any: worst(publish, shoot), daysLeft };
}

/** Urgence d'un élément du planning : seulement les publications / tournages de contenus en alerte rouge. */
export function itemUrgency(state: DataState, i: ViewItem, ref = today()): Urgency {
  const days = urgencyDays(state);
  if (i.contentRef?.kind === 'publish') {
    const c = state.contents[i.contentRef.contentId];
    return c ? contentUrgency(c, ref, days).publish : undefined;
  }
  if (i.contentRef?.kind === 'shoot') {
    const date = i.contentRef.date;
    let u: Urgency;
    for (const c of Object.values(state.contents)) if (!c.deleted && c.shootDate === date) u = worst(u, contentUrgency(c, ref, days).shoot);
    return u;
  }
  return undefined;
}

export const urgencyLabel = (u: Urgency, daysLeft?: number) =>
  u === 'late' ? 'En retard' : u === 'soon' ? (daysLeft == null ? 'Bientôt' : daysLeft === 0 ? "Aujourd'hui" : `J-${daysLeft}`) : '';
