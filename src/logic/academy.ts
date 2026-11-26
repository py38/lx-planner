// LX Academy Présentiel : règles pures (sans affichage), testées dans tests/academy.test.ts.
import { stamp, type Store } from '../data/store';
import type { AcModality, AcModule, AcModuleContent, AcModuleVersion, AcOffer, AcOfferTerms, AcTrainer, AcVenue, DataState } from '../data/types';
import { today } from '../lib/date';

export const ONSITE_KEYS = ['capacity', 'days', 'startTime', 'endTime', 'lunchMin', 'pedagogicalMinPerDay'] as const;
export const ONLINE_KEYS = ['accessDays', 'lessons', 'onlineMinutes', 'platform'] as const;
export const TERM_KEYS: (keyof AcOfferTerms)[] = ['priceCents', ...ONSITE_KEYS, ...ONLINE_KEYS];

export const FORMAT_LABEL = { solo: 'Solo', duo: 'Duo', group: 'Collectif' } as const;
export const TYPE_LABEL = {
  private_coaching: 'Coaching privé', initial: 'Formation initiale', advanced: 'Perfectionnement', masterclass: 'Masterclass',
  online_course: 'Formation en ligne (LX Academy Online)', mini_course: 'Mini-formation en ligne',
} as const;
export const MODALITY_LABEL: Record<AcModality, string> = { onsite: 'Présentiel', online: 'En ligne', hybrid: 'Mixte (présentiel + en ligne)' };
/** Types d'offre en ligne : la modalité « En ligne » est proposée par défaut. */
export const ONLINE_TYPES: AcOffer['type'][] = ['online_course', 'mini_course'];

/** Modalité d'une offre ; une offre créée avant (sans modalité) est en présentiel. */
export const modalityOf = (o: { modality?: AcModality }): AcModality => o.modality ?? 'onsite';
export const hasOnsite = (m: AcModality) => m !== 'online';
export const hasOnline = (m: AcModality) => m !== 'onsite';

/** 50000 → « 500 € » ; 35050 → « 350,50 € » */
export function euros(cents: number): string {
  const v = cents / 100;
  return `${v.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })} €`;
}
/** « 350,5 » ou « 350.50 » → 35050 ; texte invalide → null */
export function parseEuros(s: string): number | null {
  const n = Number(s.replace(/\s|€/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** 450 → « 7 h 30 » */
export const hours = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`;

/** Conditions d'une offre (les champs vides sont omis : l'historique des offres existantes garde exactement la même forme). */
export const termsOf = (o: AcOffer): AcOfferTerms => Object.fromEntries(TERM_KEYS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as unknown as AcOfferTerms;

/**
 * Modifie les conditions d'une offre. Si elles changent vraiment, l'ancienne version est archivée dans l'historique
 * et le numéro de version augmente. Les inscriptions existantes gardent leur copie : rien n'est rétroactif.
 */
export function updateOfferTerms(store: Store, id: string, patch: Partial<AcOfferTerms> & { title?: string; active?: boolean }) {
  const cur = store.get('acOffers', id);
  if (!cur) return undefined;
  const changed = TERM_KEYS.some((k) => patch[k] !== undefined && patch[k] !== cur[k]);
  if (!changed) return store.update('acOffers', id, { title: patch.title ?? cur.title, active: patch.active ?? cur.active });
  const now = stamp();
  const previousFrom = cur.history.length ? cur.history[cur.history.length - 1].validUntil : cur.createdAt;
  return store.update('acOffers', id, {
    ...patch,
    version: cur.version + 1,
    history: [...cur.history, { ...termsOf(cur), version: cur.version, validFrom: previousFrom, validUntil: now }],
  });
}

/** Champs dont la modification crée une nouvelle version d'un module. */
export const MODULE_KEYS: (keyof AcModuleContent)[] = ['title', 'objective', 'content', 'durationMin', 'prerequisites', 'material', 'evaluationCriteria'];

/** Contenu pédagogique d'un module (les champs vides sont omis). */
export function moduleContentOf(m: AcModuleContent): AcModuleContent {
  const out: Record<string, unknown> = {};
  for (const k of MODULE_KEYS) if (m[k] !== undefined && m[k] !== '') out[k] = m[k];
  return out as unknown as AcModuleContent;
}

/**
 * Modifie un module. Si son contenu pédagogique change, la version précédente est conservée EN ENTIER dans
 * l'historique (rien n'est perdu) et le numéro de version augmente. Le code, le statut et l'ordre ne créent pas de version.
 */
export function updateModule(store: Store, id: string, patch: Partial<AcModule>): { record?: AcModule; changed: boolean } {
  const cur = store.get('acModules', id);
  if (!cur) return { changed: false };
  const changed = MODULE_KEYS.some((k) => k in patch && (patch[k] ?? '') !== (cur[k] ?? ''));
  const { history: _h, version: _v, versionDate: _d, ...rest } = patch;
  if (!changed) return { record: store.update('acModules', id, rest), changed: false };
  const previous: AcModuleVersion = { ...moduleContentOf(cur), version: cur.version, versionDate: cur.versionDate, replacedAt: stamp() };
  const record = store.update('acModules', id, {
    ...rest,
    version: cur.version + 1,
    versionDate: today(),
    history: [...(cur.history ?? []), previous],
  });
  return { record, changed: true };
}

/**
 * Durée pédagogique totale d'une offre (minutes) : journées × durée par journée pour le présentiel,
 * durée totale estimée pour l'en ligne, la somme des deux pour le mixte. undefined si rien n'est renseigné.
 */
export function offerPedagogicalMin(o: Partial<AcOfferTerms> & { modality?: AcModality }): number | undefined {
  const m = modalityOf(o);
  const onsite = hasOnsite(m) && o.days !== undefined && o.pedagogicalMinPerDay !== undefined ? o.days * o.pedagogicalMinPerDay : undefined;
  const online = hasOnline(m) ? o.onlineMinutes : undefined;
  return onsite === undefined && online === undefined ? undefined : (onsite ?? 0) + (online ?? 0);
}

/** « 09:00 » → « 9 h » ; « 17:30 » → « 17 h 30 » */
export const clockLabel = (t: string) => { const [h, m] = t.split(':'); return `${Number(h)} h${m && m !== '00' ? ` ${m}` : ''}`; };

/** Résumé lisible des conditions (liste du catalogue et historique), selon la modalité. */
export function termsSummary(o: Partial<AcOfferTerms> & { modality?: AcModality }): string {
  const m = modalityOf(o);
  const parts: string[] = [];
  if (m !== 'onsite') parts.push(MODALITY_LABEL[m]);
  if (hasOnsite(m)) {
    if (o.capacity !== undefined) parts.push(`${o.capacity} stagiaire${o.capacity > 1 ? 's' : ''}`);
    if (o.days !== undefined) parts.push(`${o.days} j`);
    if (o.startTime && o.endTime) parts.push(`${clockLabel(o.startTime)}–${clockLabel(o.endTime)}`);
  }
  if (hasOnline(m)) {
    parts.push(o.accessDays ? `accès ${o.accessDays} j` : 'accès sans limite');
    if (o.lessons) parts.push(`${o.lessons} leçon${o.lessons > 1 ? 's' : ''}`);
    if (o.platform) parts.push(o.platform);
  }
  const total = offerPedagogicalMin(o);
  if (total) parts.push(`${hours(total)} au total`);
  return parts.join(' · ');
}

/** Contrôle de cohérence d'une journée : amplitude − pause = durée pédagogique. Renvoie un message ou null (rien à contrôler sans horaires). */
export function dayConsistency(t: Pick<AcOfferTerms, 'startTime' | 'endTime' | 'lunchMin' | 'pedagogicalMinPerDay'>): string | null {
  if (!t.startTime || !t.endTime || t.lunchMin === undefined || t.pedagogicalMinPerDay === undefined) return null;
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const span = toMin(t.endTime) - toMin(t.startTime) - t.lunchMin;
  if (span <= 0) return 'L’heure de fin doit être après l’heure de début (pause comprise).';
  if (span !== t.pedagogicalMinPerDay) return `Horaires : ${hours(span)} de formation par jour, mais la durée pédagogique indiquée est de ${hours(t.pedagogicalMinPerDay)}.`;
  return null;
}

/** Formatrice sélectionnée par défaut (la première active si aucune n'est marquée). */
export function defaultTrainer(state: DataState): AcTrainer | undefined {
  const list = Object.values(state.acTrainers).filter((t) => !t.deleted && t.active).sort((a, b) => a.order - b.order);
  return list.find((t) => t.isDefault) ?? list[0];
}
export function defaultVenue(state: DataState): AcVenue | undefined {
  const list = Object.values(state.acVenues).filter((v) => !v.deleted && v.active).sort((a, b) => a.order - b.order);
  return list.find((v) => v.isDefault) ?? list[0];
}

/** Une seule formatrice (ou un seul lieu) « par défaut » à la fois. */
export function setDefault(store: Store, collection: 'acTrainers' | 'acVenues', id: string) {
  store.transact(() => {
    for (const r of store.list(collection)) {
      const want = r.id === id;
      if (!!r.isDefault !== want) store.update(collection, r.id, { isDefault: want } as never);
    }
  });
}

/** Informations à compléter avant de pouvoir produire des documents (signalées, jamais inventées). */
export function missingSetup(state: DataState): string[] {
  const out: string[] = [];
  const t = defaultTrainer(state);
  if (!t || !t.name.trim()) out.push('Nom de la formatrice');
  const v = defaultVenue(state);
  if (!v || !v.address.trim()) out.push('Adresse du lieu de formation');
  const id = state.acSettings['ac-settings']?.identity ?? {};
  if (!id.legalName?.trim()) out.push('Nom de l’entrepreneur (identité administrative)');
  return out;
}
