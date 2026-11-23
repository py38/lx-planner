import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { freshStore } from './helpers';
import { createItem, validateItem } from '../src/data/actions';
import { freeSlots, suggestSlots, proposeDayPlan, busyIntervals } from '../src/logic/planner';
import { convertIdeaToProject, setPublishDate, applyRecalc, contentAlerts } from '../src/logic/content';
import { parseBookingText } from '../src/logic/ocrParse';
import { findDuplicates } from '../src/logic/duplicates';
import { dueReminders, ackReminder, snoozeReminder } from '../src/logic/reminders';
import { challengeStatus, completionRate } from '../src/logic/habits';
import { computeAlerts } from '../src/logic/alerts';
import { projectSteps } from '../src/logic/progress';
import { minToTime } from '../src/lib/date';
import type { Item, Idea } from '../src/data/types';
import type { Store } from '../src/data/store';

let store: Store;
const cat = (n: string) => store.list('categories').find((c) => c.name === n)!.id;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T07:00:00')); // lundi matin
  ({ store } = await freshStore());
});
afterEach(() => vi.useRealTimers());

describe('Planification intelligente', () => {
  it('les créneaux libres tiennent compte des RDV, trajets, marges et du repas', () => {
    createItem({ kind: 'appointment', title: 'Cliente', date: '2026-11-24', start: '09:00', duration: 120, travelMin: 30, confirmed: true });
    const busy = busyIntervals(store.state, '2026-11-24', store.settings);
    expect(busy[0]).toMatchObject({ start: 8 * 60 + 30, end: 11 * 60 + 30 + 15 }); // trajet aller + retour + marge
    const free = freeSlots(store.state, '2026-11-24', store.settings).map((f) => [minToTime(f.start), minToTime(f.end)]);
    expect(free[0]).toEqual(['11:45', '12:30']); // jusqu'au repas
    expect(free[1]).toEqual(['13:30', '21:00']);
  });
  it('aucune suggestion pro le dimanche protégé, ni au-delà de la charge max', () => {
    const t = createItem({ title: 'Compta', duration: 60, categoryId: cat('Business & Gestion') }) as Item;
    const s = suggestSlots(store.state, t, store.settings, '2026-11-28', 3); // sam, dim, lun
    expect(s.map((x) => x.date)).toEqual(['2026-11-28', '2026-11-30']);
    store.update('settings', 'settings', { sundayProtected: false });
    expect(suggestSlots(store.state, t, store.settings, '2026-11-28', 3).map((x) => x.date)).toContain('2026-11-29');
  });
  it('la proposition de planning ne modifie rien tant qu’elle n’est pas appliquée', () => {
    const a = createItem({ title: 'A', duration: 60, priority: 'optional', categoryId: cat('Business & Gestion') }) as Item;
    const b = createItem({ title: 'B', duration: 60, priority: 'must', categoryId: cat('Business & Gestion') }) as Item;
    const p = proposeDayPlan(store.state, '2026-11-25', [a, b], store.settings);
    expect(p.placements[0].item.id).toBe(b.id); // l'obligatoire d'abord
    expect(store.get('items', a.id)!.date).toBeUndefined();
    expect(store.get('items', b.id)!.date).toBeUndefined();
  });
});

describe('Contenus', () => {
  it('idée → projet de contenu avec étapes datées reliées à l’idée', () => {
    const idea = store.create('ideas', { title: 'Reel manucure russe', type: 'reel', status: 'idea' } as Idea);
    const p = convertIdeaToProject(idea.id, '2026-12-31', { categoryId: cat('Création de contenu') });
    const steps = projectSteps(store.state, p.id);
    expect(steps.map((s) => s.date)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31']);
    expect(steps.every((s) => s.ideaId === idea.id && s.projectId === p.id)).toBe(true);
    expect(store.get('ideas', idea.id)!.status).toBe('converted');
  });
  it('changer la date de publication propose un recalcul sans rien appliquer', () => {
    const idea = store.create('ideas', { title: 'R', type: 'reel', status: 'idea' } as Idea);
    const p = convertIdeaToProject(idea.id, '2026-12-31');
    const proposal = setPublishDate(p.id, '2027-01-05');
    expect(proposal.map((c) => c.to)).toEqual(['2027-01-02', '2027-01-03', '2027-01-04']);
    expect(projectSteps(store.state, p.id).map((s) => s.date)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2027-01-05']);
    applyRecalc(proposal.slice(0, 1));
    expect(projectSteps(store.state, p.id).find((s) => s.contentRole === 'script')!.date).toBe('2027-01-02');
    expect(projectSteps(store.state, p.id).find((s) => s.contentRole === 'shooting')!.date).toBe('2026-12-29'); // non accepté → inchangé
  });
  it('alerte si la publication approche et que la préparation n’est pas finie', () => {
    const idea = store.create('ideas', { title: 'R', type: 'reel', status: 'idea' } as Idea);
    const p = convertIdeaToProject(idea.id, '2026-12-01');
    expect(contentAlerts(store.state, store.settings)[0].pending).toHaveLength(3);
    for (const s of projectSteps(store.state, p.id)) if (s.contentRole !== 'publication') validateItem(s.id, 30);
    expect(contentAlerts(store.state, store.settings)).toHaveLength(0);
  });
});

describe('Import de capture : analyse du texte', () => {
  it('format type Planity', () => {
    const r = parseBookingText('Sarah Martin\nPose gel\nSamedi 28 novembre à 9h30 - 11h00\n55,00 €');
    expect(r).toMatchObject({ date: '2026-11-28', start: '09:30', duration: 90, client: 'Sarah Martin' });
    expect(r.service).toContain('Pose gel');
    expect(r.extra).toContain('55,00');
  });
  it('date numérique, heure avec deux-points et durée explicite', () => {
    const r = parseBookingText('RDV le 02/12 à 14:15\nDurée : 2h\nCliente : Inès\nRemplissage');
    expect(r).toMatchObject({ date: '2026-12-02', start: '14:15', duration: 120, client: 'Inès', service: 'Remplissage' });
  });
  it('année suivante quand la date est passée depuis longtemps', () => {
    expect(parseBookingText('5 janvier 10h').date).toBe('2027-01-05');
  });
  it('signale ce qui n’a pas été trouvé', () => {
    const r = parseBookingText('Bonjour, merci pour votre message');
    expect(r.confidence).toEqual({ date: false, start: false, duration: false, service: false, client: false });
  });
});

describe('Doublons', () => {
  it('détecte une même cliente au même horaire', () => {
    createItem({ kind: 'appointment', title: 'Pose — Sarah', client: 'Sarah Martin', date: '2026-11-28', start: '09:30' });
    expect(findDuplicates(store.state, { date: '2026-11-28', start: '09:45', client: 'sarah martin' })[0].reason).toMatch(/Même cliente/);
    expect(findDuplicates(store.state, { date: '2026-11-28', start: '15:00', client: 'Léa' })).toHaveLength(0);
  });
});

describe('Rappels', () => {
  it('rappel 10 min avant un RDV : échu, validable, reportable', () => {
    const it = createItem({ kind: 'appointment', title: 'Cliente', date: '2026-11-23', start: '09:00' }) as Item;
    expect(it.reminders).toHaveLength(1);
    vi.setSystemTime(new Date('2026-11-23T08:49:00'));
    expect(dueReminders(store.state)).toHaveLength(0);
    vi.setSystemTime(new Date('2026-11-23T08:51:00'));
    expect(dueReminders(store.state)).toHaveLength(1);
    snoozeReminder(it.id, it.reminders![0].id, 5);
    expect(dueReminders(store.state)).toHaveLength(0);
    vi.setSystemTime(new Date('2026-11-23T08:57:00'));
    expect(dueReminders(store.state)).toHaveLength(1);
    ackReminder(it.id, it.reminders![0].id);
    expect(dueReminders(store.state)).toHaveLength(0);
  });
  it('échéance dépassée signalée sans report automatique', () => {
    const it = createItem({ title: 'Déclaration URSSAF', deadline: '2026-11-20' }) as Item;
    const a = computeAlerts(store.state, store.settings);
    expect(a.overdue.map((i) => i.id)).toContain(it.id);
    expect(store.get('items', it.id)!.date).toBeUndefined();
  });
});

describe('Habitudes et défis', () => {
  it('défi 7 jours consécutifs, interrompu par un jour manqué', () => {
    const c = { startDate: '2026-11-16', days: 7, checks: ['2026-11-16', '2026-11-17', '2026-11-18'] };
    expect(challengeStatus(c, '2026-11-18')).toMatchObject({ current: 3, broken: false, completed: false });
    expect(challengeStatus(c, '2026-11-20')).toMatchObject({ current: 0, broken: true });
    const ok = { ...c, checks: ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'] };
    expect(challengeStatus(ok, '2026-11-22')).toMatchObject({ completed: true, pct: 100 });
  });
  it('le taux de réalisation ne compte que les jours écoulés et validés', () => {
    const h = store.list('habits').find((x) => x.name === 'Skincare du matin')!;
    const logs = [{ habitId: h.id, date: '2026-11-23', value: 1 } as any];
    const r = completionRate({ ...h, createdAt: '2026-11-20T00:00:00Z' }, logs, '2026-11-01', '2026-11-30', '2026-11-23');
    expect(r).toEqual({ done: 1, expected: 4, pct: 25 }); // du 20 au 23 inclus
  });
});
