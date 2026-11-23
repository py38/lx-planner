// Données de départ créées au tout premier lancement. Tout reste modifiable ensuite.
import { uid } from '../lib/id';
import { today } from '../lib/date';
import type { Category, Goal, Habit, Item, Objective, Project, Settings } from './types';

const t = () => new Date().toISOString();
const base = () => ({ id: uid(), createdAt: t(), updatedAt: t() });

export const DEFAULT_CATEGORY_KEYS = {
  clients: 'Rendez-vous clientes',
  business: 'Business & Gestion',
  online: 'LX Academy Online',
  presentiel: 'LX Academy Présentiel',
  content: 'Création de contenu',
};

export function buildDefaults() {
  const cat = (name: string, color: string, kind: 'pro' | 'perso', order: number, description?: string): Category => ({
    ...base(), name, color, kind, order, description,
  });
  const categories = [
    cat(DEFAULT_CATEGORY_KEYS.clients, '#F4A6B8', 'pro', 0, 'Prestations réalisées auprès des clientes'),
    cat(DEFAULT_CATEGORY_KEYS.business, '#B9A8E6', 'pro', 1, 'Administratif, compta, mails, commandes, stratégie, futur centre'),
    cat(DEFAULT_CATEGORY_KEYS.online, '#F6BFA0', 'pro', 2, 'Création des formations, vidéos, plateforme, élèves, ventes'),
    cat(DEFAULT_CATEGORY_KEYS.presentiel, '#9ED8C6', 'pro', 3, 'Sessions, préparation pédagogique, suivi des élèves'),
    cat(DEFAULT_CATEGORY_KEYS.content, '#A7C9EE', 'pro', 4, 'Idées, scripts, tournage, montage, publication'),
    cat('Vie personnelle', '#F3D98E', 'perso', 5, 'Église, couple, famille, sorties, rendez-vous perso'),
    cat('Sport & bien-être', '#D9B8E8', 'perso', 6, 'Séances, soins, temps pour soi'),
  ];
  const [, business, online] = categories;
  const sport = categories[6];

  let order = 0;
  const habit = (h: Omit<Habit, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Habit => ({ ...base(), order: order++, ...h });
  const habits: Habit[] = [
    habit({ name: 'Prière, lecture biblique ou méditation', group: 'Vie spirituelle', kind: 'check', target: 1, period: 'day', durationMin: 15 }),
    habit({ name: 'Étude biblique avec mon mari', group: 'Vie spirituelle', kind: 'check', target: 1, period: 'week', durationMin: 60 }),
    habit({ name: "Temps avec Dieu / rencontre de l'église", group: 'Vie spirituelle', kind: 'check', target: 1, period: 'week' }),
    habit({ name: 'Skincare du matin', group: 'Bien-être', kind: 'check', target: 1, period: 'day' }),
    habit({ name: 'Skincare du soir', group: 'Bien-être', kind: 'check', target: 1, period: 'day' }),
    habit({ name: 'Hydratation', group: 'Bien-être', kind: 'quantity', unit: 'L', target: 2.5, step: 0.25, period: 'day' }),
    habit({ name: 'Séance HYROX', group: 'Sport', kind: 'check', target: 2, period: 'week', durationMin: 60, isSport: true }),
    habit({ name: 'Running', group: 'Sport', kind: 'check', target: 2, period: 'week', durationMin: 60, isSport: true }),
    habit({ name: 'Petit-déjeuner pris', group: 'Alimentation', kind: 'check', target: 1, period: 'day' }),
    habit({ name: 'Déjeuner pris', group: 'Alimentation', kind: 'check', target: 1, period: 'day' }),
    habit({ name: 'Dîner pris', group: 'Alimentation', kind: 'check', target: 1, period: 'day' }),
    habit({ name: 'Collation prise', group: 'Alimentation', kind: 'check', target: 1, period: 'day', optional: true }),
    habit({ name: 'Cheveux', group: 'Soins personnels', kind: 'check', target: 1, period: 'interval', intervalDays: 3 }),
    habit({ name: 'Ongles', group: 'Soins personnels', kind: 'check', target: 1, period: 'interval', intervalDays: 25 }),
    habit({ name: 'Soirée de couple', group: 'Vie personnelle', kind: 'check', target: 1, period: 'week' }),
    habit({ name: 'Repas en famille', group: 'Vie personnelle', kind: 'check', target: 1, period: 'week' }),
    habit({ name: 'Ménage complet', group: 'Maison', kind: 'check', target: 1, period: 'week' }),
    habit({ name: 'Grosses courses', group: 'Maison', kind: 'check', target: 1, period: 'week' }),
  ];

  const settings: Settings = {
    ...base(),
    id: 'settings',
    dayStart: '08:30',
    dayEnd: '21:00',
    sundayProtected: true,
    bufferMin: 15,
    maxDailyWorkMin: 8 * 60,
    contentLeadDays: 14,
    contentSteps: [
      { role: 'script', title: 'Rédaction du script', offsetDays: -3, duration: 60 },
      { role: 'shooting', title: 'Tournage', offsetDays: -2, duration: 90 },
      { role: 'editing', title: 'Montage et légende', offsetDays: -1, duration: 120 },
      { role: 'publication', title: 'Programmation / publication', offsetDays: 0, duration: 15 },
    ],
    defaultReminders: { appointment: [10], deadline: [24 * 60] },
    mealBlock: { enabled: true, start: '12:30', duration: 60 },
  };

  // Les trois grandes priorités des prochains mois
  const obj = (title: string, extra: Partial<Objective>): Objective => ({ ...base(), title, level: 'year', ...extra });
  const launch = obj('Lancer LX Academy Online', { period: '2027', deadline: '2027-01-11', categoryId: online.id, description: 'Lancement cible le 11 janvier 2027' });
  const objectives: Objective[] = [
    launch,
    obj('Développer mon audience et ma création de contenu', { period: String(new Date().getFullYear() + 1), categoryId: categories[4].id }),
    obj("Préparer l'ouverture de mon futur centre", { period: String(new Date().getFullYear() + 1), categoryId: business.id }),
  ];

  const project: Project = {
    ...base(), title: 'Préparation du lancement LX Academy Online', objectiveId: launch.id, categoryId: online.id,
    deadline: '2027-01-11', status: 'active', type: 'standard',
  };
  const steps = [
    'Finaliser les formations', 'Enregistrer les vidéos', 'Monter les vidéos', 'Créer les supports',
    'Préparer la plateforme', 'Préparer la communication', 'Programmer les publications',
    "Vérifier le parcours d'achat", 'Effectuer les derniers tests',
  ];
  const items: Item[] = steps.map((title, i) => ({
    ...base(), kind: 'task', title, categoryId: online.id, projectId: project.id, priority: 'important',
    status: 'todo', order: i, deadline: '2027-01-10',
  }));

  const goal = (g: Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'startDate'>): Goal => ({ ...base(), startDate: today(), ...g });
  const goals: Goal[] = [
    goal({ title: 'Séances de sport', target: 4, unit: 'séances', period: 'week', type: 'frequency', source: 'sportSessions', categoryId: sport.id }),
    goal({ title: 'Heures sur LX Academy Online', target: 10, unit: 'h', period: 'week', type: 'duration', source: 'categoryHours', categoryId: online.id }),
    goal({ title: 'Reels publiés', target: 3, unit: 'Reels', period: 'week', type: 'number', source: 'manual' }),
  ];

  return { categories, habits, settings: [settings], objectives, projects: [project], items, goals };
}

/** Palette pastel (novembre 2026) : anciennes couleurs par défaut → nouvelles. */
export const PASTEL_REMAP: Record<string, string> = {
  '#b07d62': '#F4A6B8', // Rendez-vous clientes — rose poudré
  '#6e5d4e': '#B9A8E6', // Business & Gestion — lavande
  '#8a6a86': '#F6BFA0', // LX Academy Online — pêche
  '#b8954a': '#9ED8C6', // LX Academy Présentiel — menthe
  '#6f918a': '#A7C9EE', // Création de contenu — bleu ciel
  '#8c93a8': '#F3D98E', // Vie personnelle — vanille
  '#a48a9e': '#D9B8E8', // Sport & bien-être — lilas
};
