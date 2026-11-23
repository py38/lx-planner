// Toutes les modifications passent par ici : une seule logique, quelle que soit la vue d'où elles viennent.
import { getStore } from './store';
import { uid } from '../lib/id';
import { addDays, today } from '../lib/date';
import { isVirtualId, parseVirtualId } from '../logic/recurrence';
import { isContentRef } from '../logic/contentPlan';
import type {
  DateStr, ID, Item, ItemTemplate, Priority, Project, RecurrenceRule, Reminder, Series, TimeStr,
} from './types';

export type Scope = 'one' | 'future' | 'all';
const s = () => getStore();

// ---------- Éléments venant du calendrier de contenu (publications « cp: », tournages « cs: ») ----------
// Ils ne sont pas copiés dans le planning : chaque action modifie directement la fiche contenu.
function contentRefPatch(id: ID, p: { date?: DateStr | null; start?: TimeStr | null; posted?: boolean }) {
  const store = s();
  store.transact(() => {
    if (id.startsWith('cp:')) {
      const c = store.get('contents', id.slice(3));
      if (!c) return;
      const patch: Partial<typeof c> = {};
      if (p.date !== undefined) patch.publishDate = p.date ?? undefined;
      if (p.start !== undefined) patch.publishTime = p.start ?? undefined;
      if (p.date === null) patch.publishTime = undefined;
      if (p.posted !== undefined) {
        const pls = c.platforms.length ? c.platforms : (['instagram'] as const);
        const checks = { ...c.checks };
        for (const pl of pls) checks[pl === 'instagram' ? 'posted_instagram' : 'posted_tiktok'] = p.posted;
        patch.checks = checks;
      }
      store.update('contents', c.id, patch);
    } else if (id.startsWith('cs:') && p.date) {
      // déplacer une journée de tournage = déplacer tous ses scripts
      const from = id.slice(3);
      for (const c of store.list('contents')) if (c.shootDate === from) store.update('contents', c.id, { shootDate: p.date });
    }
  });
}


export interface NewItem {
  kind?: Item['kind'];
  title: string;
  description?: string;
  notes?: string;
  links?: string[];
  categoryId?: ID;
  date?: DateStr;
  start?: TimeStr;
  duration?: number;
  deadline?: DateStr;
  priority?: Priority;
  status?: Item['status'];
  projectId?: ID;
  ideaId?: ID;
  contentRole?: Item['contentRole'];
  habitId?: ID;
  client?: string;
  service?: string;
  confirmed?: boolean;
  travelMin?: number;
  reminders?: Reminder[];
  order?: number;
}

export function defaultReminders(data: Pick<NewItem, 'kind' | 'deadline' | 'start'>): Reminder[] {
  const st = s().settings;
  const out: Reminder[] = [];
  if (data.kind === 'appointment' && data.start)
    for (const m of st?.defaultReminders.appointment ?? []) out.push({ id: uid(), offsetMin: m, anchor: 'start' });
  if (data.deadline) for (const m of st?.defaultReminders.deadline ?? []) out.push({ id: uid(), offsetMin: m, anchor: 'deadline' });
  return out;
}

const TEMPLATE_KEYS: (keyof ItemTemplate)[] = [
  'kind', 'title', 'description', 'notes', 'links', 'categoryId', 'start', 'duration', 'deadline', 'priority',
  'projectId', 'ideaId', 'contentRole', 'habitId', 'client', 'service', 'confirmed', 'travelMin', 'reminders', 'order',
];
const pickTemplate = (o: Partial<Item>): Partial<ItemTemplate> => {
  const t: any = {};
  for (const k of TEMPLATE_KEYS) if (k in o) t[k] = (o as any)[k];
  return t;
};

/** Crée un élément ponctuel, ou une série si une récurrence est fournie. */
export function createItem(data: NewItem, recurrence?: Omit<RecurrenceRule, 'start'> & { start?: DateStr }): Item | Series {
  const kind = data.kind ?? 'task';
  const reminders = data.reminders ?? defaultReminders({ ...data, kind });
  if (recurrence) {
    const template = { ...pickTemplate(data as Partial<Item>), kind, priority: data.priority ?? 'important', reminders } as ItemTemplate;
    return s().create('series', {
      template,
      rule: { ...recurrence, start: recurrence.start ?? data.date ?? today() },
      exdates: [],
    });
  }
  return s().create('items', {
    ...data,
    kind,
    priority: data.priority ?? 'important',
    status: data.status ?? 'todo',
    reminders,
  } as Item);
}

/** Transforme une occurrence virtuelle en élément réel (pour la modifier ou la valider) — sans jamais créer de doublon. */
export function materialize(id: ID): Item | undefined {
  if (!isVirtualId(id)) return s().get('items', id);
  const { seriesId, date } = parseVirtualId(id);
  const existing = Object.values(s().state.items).find((i) => i.seriesId === seriesId && i.occurrenceDate === date);
  if (existing) return existing.deleted ? undefined : existing;
  const series = s().get('series', seriesId);
  if (!series) return undefined;
  return s().create('items', {
    ...series.template,
    date,
    status: 'todo',
    seriesId,
    occurrenceDate: date,
    reminders: series.template.reminders?.map((r) => ({ ...r })),
  } as Item);
}

/** Modifie un élément. Pour une occurrence de série : scope one | future | all. */
export function updateItem(id: ID, patch: Partial<Item>, scope: Scope = 'one'): Item | undefined {
  const store = s();
  if (isContentRef(id)) {
    contentRefPatch(id, {
      date: 'date' in patch ? patch.date ?? null : undefined,
      start: 'start' in patch ? patch.start ?? null : undefined,
      posted: patch.status ? patch.status === 'done' : undefined,
    });
    return undefined;
  }
  return store.transact(() => {
    const item = isVirtualId(id) ? undefined : store.get('items', id);
    const seriesId = item?.seriesId ?? (isVirtualId(id) ? parseVirtualId(id).seriesId : undefined);
    const occDate = item?.occurrenceDate ?? (isVirtualId(id) ? parseVirtualId(id).date : undefined);

    if (seriesId && scope !== 'one') {
      editSeries(seriesId, occDate!, patch, scope);
      return store.get('items', id);
    }
    const real = materialize(id);
    if (!real) return undefined;
    const p: Partial<Item> = { ...patch };
    if (p.status === 'done' && real.status !== 'done') {
      p.completedAt = new Date().toISOString();
      if (p.actualMinutes == null) p.actualMinutes = p.duration ?? real.duration ?? 0;
    }
    if (p.status && p.status !== 'done' && real.status === 'done') {
      p.completedAt = undefined;
      p.actualMinutes = undefined;
    }
    return store.update('items', real.id, p);
  });
}

function editSeries(seriesId: ID, from: DateStr, patch: Partial<Item>, scope: 'future' | 'all') {
  const store = s();
  const series = store.get('series', seriesId);
  if (!series) return;
  // Le changement de date d'une occurrence ne s'applique pas à toute la série (seuls les champs « modèle » le sont).
  const tpl = pickTemplate(patch);
  const occurrences = store.list('items').filter((i) => i.seriesId === seriesId);
  if (scope === 'all') {
    store.update('series', seriesId, { template: { ...series.template, ...tpl } });
    // Les occurrences déjà réalisées gardent leur historique ; les autres suivent la série.
    for (const o of occurrences) if (o.status !== 'done') store.update('items', o.id, tpl);
    return;
  }
  // future : on coupe la série la veille et on démarre une nouvelle série à partir de cette date
  const newSeries = store.create('series', {
    template: { ...series.template, ...tpl },
    rule: { ...series.rule, start: from },
    exdates: series.exdates.filter((d) => d >= from),
  });
  store.update('series', seriesId, {
    rule: { ...series.rule, until: addDays(from, -1) },
    exdates: series.exdates.filter((d) => d < from),
  });
  for (const o of occurrences) {
    if (o.occurrenceDate && o.occurrenceDate >= from) {
      store.update('items', o.id, { seriesId: newSeries.id, ...(o.status !== 'done' ? tpl : {}) });
    }
  }
}

/** Modifie la règle de récurrence d'une série entière. */
export function updateSeriesRule(seriesId: ID, rule: RecurrenceRule) {
  s().update('series', seriesId, { rule });
}

/** Déplacer = changer date et/ou horaire. Ne touche jamais aux autres éléments. */
export function moveItem(id: ID, date: DateStr | undefined, start?: TimeStr | null) {
  if (isContentRef(id)) return contentRefPatch(id, { date: date ?? null, start: date ? start : null });
  const patch: Partial<Item> = { date };
  if (start !== undefined) patch.start = start ?? undefined;
  if (!date) patch.start = undefined;
  return updateItem(id, patch, 'one');
}

/** Validation manuelle — la SEULE façon de compter une tâche comme réalisée. */
export function validateItem(id: ID, actualMinutes: number, date?: DateStr) {
  const store = s();
  if (isContentRef(id)) { contentRefPatch(id, { posted: true }); return undefined; }
  return store.transact(() => {
    const real = materialize(id);
    if (!real) return undefined;
    const it = store.update('items', real.id, {
      status: 'done',
      actualMinutes: Math.max(0, Math.round(actualMinutes)),
      completedAt: new Date().toISOString(),
    });
    if (real.habitId) {
      const d = real.date ?? date ?? today();
      const already = store.list('habitLogs').find((l) => l.note === `item:${real.id}`);
      if (!already) store.create('habitLogs', { habitId: real.habitId, date: d, value: 1, note: `item:${real.id}` });
    }
    return it;
  });
}

export function unvalidateItem(id: ID) {
  const store = s();
  if (isContentRef(id)) return contentRefPatch(id, { posted: false });
  store.transact(() => {
    store.update('items', id, { status: 'todo', completedAt: undefined, actualMinutes: undefined });
    for (const l of store.list('habitLogs')) if (l.note === `item:${id}`) store.remove('habitLogs', l.id);
  });
}

/** Reporter : uniquement sur action explicite. `to` = null renvoie la tâche dans « À planifier ». */
export function postponeItem(id: ID, to: DateStr | null) {
  const store = s();
  if (isContentRef(id)) return contentRefPatch(id, { date: to });
  return store.transact(() => {
    const real = materialize(id);
    if (!real) return;
    const postponements = [...(real.postponements ?? []), { from: real.date ?? null, to, at: new Date().toISOString() }];
    const patch: Partial<Item> = { postponements, date: to ?? undefined };
    if (!to) patch.start = undefined;
    if (real.status === 'postponed' || real.status === 'blocked') patch.status = 'todo';
    store.update('items', real.id, patch);
  });
}

/** Suppression : pour une série, scope one n'efface que cette occurrence. Les occurrences réalisées sont conservées. */
export function deleteItem(id: ID, scope: Scope = 'one') {
  const store = s();
  // retirer une publication du planning = lui enlever sa date (la fiche reste dans la Banque d'idées)
  if (isContentRef(id)) return id.startsWith('cp:') ? contentRefPatch(id, { date: null }) : undefined;
  store.transact(() => {
    const item = isVirtualId(id) ? undefined : store.get('items', id);
    const seriesId = item?.seriesId ?? (isVirtualId(id) ? parseVirtualId(id).seriesId : undefined);
    const occDate = item?.occurrenceDate ?? (isVirtualId(id) ? parseVirtualId(id).date : undefined);
    const series = seriesId ? store.get('series', seriesId) : undefined;
    if (!series || !occDate) {
      if (item) store.remove('items', item.id);
      return;
    }
    if (scope === 'one') {
      store.update('series', series.id, { exdates: Array.from(new Set([...series.exdates, occDate])) });
      if (item) store.remove('items', item.id);
      return;
    }
    const occurrences = store.list('items').filter((i) => i.seriesId === series.id);
    if (scope === 'future') {
      store.update('series', series.id, { rule: { ...series.rule, until: addDays(occDate, -1) } });
      for (const o of occurrences) if (o.occurrenceDate! >= occDate && o.status !== 'done') store.remove('items', o.id);
    } else {
      store.remove('series', series.id);
      for (const o of occurrences) if (o.status !== 'done') store.remove('items', o.id);
    }
  });
}

export function duplicateItem(id: ID) {
  const it = materialize(id);
  if (!it) return;
  const { id: _i, createdAt: _c, updatedAt: _u, seriesId: _s, occurrenceDate: _o, completedAt: _d, actualMinutes: _a, ...rest } = it;
  return s().create('items', { ...rest, status: 'todo', title: `${it.title} (copie)` } as Item);
}

// ---------- Projets ----------
export function createProject(data: Partial<Project> & { title: string }) {
  return s().create('projects', { status: 'active', type: 'standard', ...data } as Project);
}
export function setProjectDone(id: ID, done: boolean) {
  s().update('projects', id, done ? { status: 'done', completedAt: new Date().toISOString() } : { status: 'active', completedAt: undefined });
}
export function deleteProject(id: ID, withTasks: boolean) {
  const store = s();
  store.transact(() => {
    for (const it of store.list('items').filter((i) => i.projectId === id)) {
      if (withTasks && it.status !== 'done') store.remove('items', it.id);
      else store.update('items', it.id, { projectId: undefined });
    }
    store.remove('projects', id);
  });
}

// ---------- Habitudes ----------
/** Coche / décoche une habitude « case » pour un jour donné. */
export function toggleHabit(habitId: ID, date: DateStr) {
  const store = s();
  const logs = store.list('habitLogs').filter((l) => l.habitId === habitId && l.date === date);
  if (logs.length) store.transact(() => logs.forEach((l) => store.remove('habitLogs', l.id)));
  else store.create('habitLogs', { habitId, date, value: 1 });
}
/** Ajoute une séance supplémentaire le même jour (ex : 2 séances de sport). */
export function addHabitCount(habitId: ID, date: DateStr, delta: number) {
  const store = s();
  const log = store.list('habitLogs').find((l) => l.habitId === habitId && l.date === date && !l.note);
  if (!log) {
    if (delta > 0) store.create('habitLogs', { habitId, date, value: delta });
    return;
  }
  const v = Math.max(0, Math.round((log.value + delta) * 100) / 100);
  if (v === 0) store.remove('habitLogs', log.id);
  else store.update('habitLogs', log.id, { value: v });
}
export function setHabitValue(habitId: ID, date: DateStr, value: number) {
  const store = s();
  const log = store.list('habitLogs').find((l) => l.habitId === habitId && l.date === date && !l.note);
  if (log) {
    if (value <= 0) store.remove('habitLogs', log.id);
    else store.update('habitLogs', log.id, { value });
  } else if (value > 0) store.create('habitLogs', { habitId, date, value });
}

export function toggleChallengeDay(id: ID, date: DateStr) {
  const c = s().get('challenges', id);
  if (!c) return;
  const checks = c.checks.includes(date) ? c.checks.filter((d) => d !== date) : [...c.checks, date].sort();
  s().update('challenges', id, { checks });
}

// ---------- Calendrier de contenu ----------
/**
 * Annuler une journée de tournage : les fiches contenu sont conservées (textes, couvertures, cases cochées),
 * seule la date de tournage est retirée. Option : retirer aussi leurs dates de publication (retour complet
 * dans la Banque d'idées). Le créneau « Journée de tournage » éventuellement bloqué dans le planning est retiré.
 */
export function cancelShootDay(date: DateStr, opts: { alsoPublishDates?: boolean } = {}) {
  const store = s();
  let n = 0;
  store.transact(() => {
    for (const c of store.list('contents')) {
      if (c.shootDate !== date) continue;
      store.update('contents', c.id, opts.alsoPublishDates ? { shootDate: undefined, publishDate: undefined, publishTime: undefined } : { shootDate: undefined });
      n++;
    }
    for (const it of store.list('items')) if (it.date === date && it.title.startsWith('Journée de tournage')) store.remove('items', it.id);
  });
  return n;
}
