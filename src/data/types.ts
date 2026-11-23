// Modèle de données unique de l'application.
// Toutes les vues (Journée, Semaine, Mois, Année, Projets, Bilans…) lisent ces mêmes collections.

export type ID = string;
/** Date locale au format AAAA-MM-JJ */
export type DateStr = string;
/** Heure locale au format HH:mm */
export type TimeStr = string;

export interface BaseRecord {
  id: ID;
  createdAt: string; // ISO
  updatedAt: string; // ISO — sert à la résolution des conflits de synchronisation
  deleted?: boolean; // suppression « logique » (tombstone) pour que la suppression se synchronise
}

export type Priority = 'must' | 'important' | 'optional';
export type Status = 'todo' | 'in_progress' | 'done' | 'blocked' | 'postponed';
/** task = tâche ; appointment = rendez-vous cliente ; event = événement (perso ou pro) */
export type ItemKind = 'task' | 'appointment' | 'event';

export interface Reminder {
  id: ID;
  /** minutes avant l'ancre */
  offsetMin: number;
  anchor: 'start' | 'deadline';
  done?: boolean;
  disabled?: boolean;
  snoozedUntil?: string; // ISO
}

export interface Postponement {
  from: DateStr | null;
  to: DateStr | null; // null = renvoyée dans « À planifier »
  at: string; // ISO
}

export interface Item extends BaseRecord {
  kind: ItemKind;
  title: string;
  description?: string;
  notes?: string;
  links?: string[];
  categoryId?: ID;
  /** date de réalisation souhaitée ; absente = « À planifier » */
  date?: DateStr;
  start?: TimeStr;
  /** durée estimée en minutes */
  duration?: number;
  /** échéance finale */
  deadline?: DateStr;
  priority: Priority;
  status: Status;
  /** temps réellement passé, saisi à la validation — seule source des heures « réalisées » */
  actualMinutes?: number;
  completedAt?: string; // ISO — uniquement posé par une validation manuelle
  projectId?: ID;
  ideaId?: ID;
  /** rôle d'une étape de contenu (script, tournage…) */
  contentRole?: ContentRole;
  habitId?: ID; // valider l'élément enregistre aussi l'habitude
  // Rendez-vous clientes
  client?: string;
  service?: string;
  confirmed?: boolean;
  /** temps de déplacement avant l'activité (minutes) */
  travelMin?: number;
  reminders?: Reminder[];
  postponements?: Postponement[];
  order?: number;
  // Récurrences : une occurrence « matérialisée » garde le lien vers sa série
  seriesId?: ID;
  occurrenceDate?: DateStr;
}

export type ContentRole = 'script' | 'shooting' | 'editing' | 'publication' | 'other';

export type Freq = 'daily' | 'weekly' | 'monthly' | 'interval';
export interface RecurrenceRule {
  freq: Freq;
  /** tous les N jours / semaines / mois */
  interval: number;
  /** jours de la semaine (0 = dimanche … 6 = samedi) pour freq weekly */
  weekdays?: number[];
  start: DateStr;
  until?: DateStr;
}

export type ItemTemplate = Omit<
  Item,
  keyof BaseRecord | 'date' | 'seriesId' | 'occurrenceDate' | 'status' | 'actualMinutes' | 'completedAt' | 'postponements'
>;

export interface Series extends BaseRecord {
  template: ItemTemplate;
  rule: RecurrenceRule;
  /** dates d'occurrences supprimées individuellement */
  exdates: DateStr[];
}

export interface Category extends BaseRecord {
  name: string;
  color: string;
  kind: 'pro' | 'perso';
  order: number;
  archived?: boolean;
  description?: string;
}

export type ObjectiveLevel = 'year' | 'month' | 'week' | 'oneoff';
export interface Objective extends BaseRecord {
  title: string;
  description?: string;
  level: ObjectiveLevel;
  /** 2027 | 2027-01 | 2027-W02 | date AAAA-MM-JJ selon le niveau */
  period?: string;
  deadline?: DateStr;
  categoryId?: ID;
  done?: boolean;
  completedAt?: string;
}

export type ProjectStatus = 'active' | 'done' | 'blocked' | 'paused';
export interface Project extends BaseRecord {
  title: string;
  description?: string;
  objectiveId?: ID;
  categoryId?: ID;
  deadline?: DateStr;
  status: ProjectStatus;
  completedAt?: string;
  type: 'standard' | 'content';
  ideaId?: ID;
  /** pour les projets de contenu */
  publishDate?: DateStr;
  notes?: string;
}

export type IdeaType = 'reel' | 'post' | 'formation' | 'communication' | 'script' | 'note' | 'inspiration' | 'future';
export interface Idea extends BaseRecord {
  title: string;
  type: IdeaType;
  content?: string;
  tags?: string[];
  status: 'idea' | 'converted' | 'archived';
  projectId?: ID;
  categoryId?: ID;
}

export type HabitPeriod = 'day' | 'week' | 'month' | 'interval';
export interface Habit extends BaseRecord {
  name: string;
  group: string;
  /** check = case à cocher ; quantity = valeur saisie (ex : litres d'eau) */
  kind: 'check' | 'quantity';
  unit?: string;
  /** check : nombre de fois par période ; quantity : quantité par jour */
  target: number;
  period: HabitPeriod;
  /** pour period = interval : tous les N jours (ex : cheveux tous les 3 jours) */
  intervalDays?: number;
  /** pas d'incrément pour les quantités */
  step?: number;
  durationMin?: number;
  /** facultative : suivie mais sans objectif (ex : collation) */
  optional?: boolean;
  isSport?: boolean;
  order: number;
  archived?: boolean;
}

export interface HabitLog extends BaseRecord {
  habitId: ID;
  date: DateStr;
  value: number;
  note?: string;
}

export type GoalPeriod = 'day' | 'week' | 'month' | 'year' | 'once';
export type GoalType = 'number' | 'duration' | 'quantity' | 'frequency' | 'oneoff';
export type GoalSource = 'manual' | 'habit' | 'sportSessions' | 'categoryHours' | 'categoryCount' | 'projectsDone';
export interface Goal extends BaseRecord {
  title: string;
  target: number;
  unit: string;
  period: GoalPeriod;
  type: GoalType;
  startDate: DateStr;
  endDate?: DateStr;
  source: GoalSource;
  habitId?: ID;
  categoryId?: ID;
  archived?: boolean;
}

export interface GoalLog extends BaseRecord {
  goalId: ID;
  date: DateStr;
  value: number;
  note?: string;
}

export interface Challenge extends BaseRecord {
  title: string;
  description?: string;
  days: number;
  startDate: DateStr;
  /** jours validés */
  checks: DateStr[];
  archived?: boolean;
}

export interface WeeklyReview extends BaseRecord {
  weekStart: DateStr;
  closedAt: string;
  notes?: string;
  snapshot: unknown; // copie figée des statistiques au moment de la clôture
}

export interface ContentStepTemplate {
  role: ContentRole;
  title: string;
  offsetDays: number; // par rapport à la date de publication (négatif = avant)
  duration: number;
}

export interface Settings extends BaseRecord {
  dayStart: TimeStr;
  dayEnd: TimeStr;
  /** dimanche protégé : aucune suggestion pro ce jour-là (préférence, pas un blocage) */
  sundayProtected: boolean;
  /** marge entre deux activités (minutes) */
  bufferMin: number;
  /** charge max de travail suggérée par jour (minutes) */
  maxDailyWorkMin: number;
  /** alerte de préparation de contenu N jours avant publication */
  contentLeadDays: number;
  contentSteps: ContentStepTemplate[];
  /** rappels ajoutés par défaut */
  defaultReminders: { appointment: number[]; deadline: number[] };
  notificationsEnabled?: boolean;
  /** délai par défaut de l'« alerte rouge » des contenus cochés (jours avant publication, 3 par défaut) */
  urgencyDays?: number;
  /** afficher publications et tournages du calendrier de contenu dans le planning du quotidien */
  showContentInPlanning?: boolean;
  /** pause repas suggérée */
  mealBlock?: { enabled: boolean; start: TimeStr; duration: number };
}

// ---------- Instagram & Développement ----------
export type ContentFormat = 'reel' | 'carousel' | 'photo' | 'story' | 'live';
export type ContentGoal = 'visibility' | 'trust' | 'conversion';
export type ContentPillar = 'education' | 'social_proof' | 'lifestyle' | 'behind' | 'sales' | 'community';
export type Platform = 'instagram' | 'tiktok';
/** Étapes cochables d'un contenu (de l'écriture à la publication) */
export type ContentCheck = 'script' | 'shot' | 'edited' | 'caption' | 'cover' | 'posted_instagram' | 'posted_tiktok';

/** Recadrage non destructif : zoom ≥ 1, décalage en % du cadre */
export interface Crop { zoom: number; x: number; y: number }

/**
 * Une fiche contenu. Sans date de tournage ni de publication, c'est une idée de la Banque d'idées ;
 * dès qu'on lui donne une date, elle apparaît dans le calendrier de contenu (c'est la même fiche).
 */
export interface ContentPiece extends BaseRecord {
  title: string;
  format: ContentFormat;
  goal?: ContentGoal;
  pillar?: ContentPillar;
  hook?: string; // accroche
  script?: string; // corps du script
  cta?: string; // call to action
  caption?: string; // légende
  notes?: string;
  /** mots-clés libres (ex : Formation en ligne, Pré-lancement) */
  tags?: string[];
  platforms: Platform[];
  /** jour de tournage : tous les scripts d'une même journée y sont regroupés */
  shootDate?: DateStr;
  publishDate?: DateStr;
  publishTime?: TimeStr;
  checks: Partial<Record<ContentCheck, boolean>>;
  /** « Alerte rouge » (ex : collab avec une marque) : rouge si pas tourné ET monté N jours avant la publication */
  redAlert?: boolean;
  /** délai de l'alerte pour ce contenu (sinon : réglage général, 3 jours par défaut) */
  redAlertDays?: number;
  coverMediaId?: ID;
  coverCrop?: Crop;
  ideaId?: ID;
  order?: number;
}

export type FeedAspect = '3:4' | '4:5' | '1:1';
export interface FeedTile { id: ID; mediaId?: ID; contentId?: ID; crop?: Crop; label?: string }
/** Simulation de feed : un ordre de vignettes, conservé et comparable */
export interface FeedSim extends BaseRecord {
  name: string;
  aspect: FeedAspect;
  tiles: FeedTile[]; // ordre d'affichage : la 1re vignette = en haut à gauche (publication la plus récente)
}

export interface Collections {
  items: Item;
  series: Series;
  categories: Category;
  objectives: Objective;
  projects: Project;
  ideas: Idea;
  habits: Habit;
  habitLogs: HabitLog;
  goals: Goal;
  goalLogs: GoalLog;
  challenges: Challenge;
  reviews: WeeklyReview;
  settings: Settings;
  contents: ContentPiece;
  feeds: FeedSim;
}
export type CollectionName = keyof Collections;
export const COLLECTIONS: CollectionName[] = [
  'items', 'series', 'categories', 'objectives', 'projects', 'ideas',
  'habits', 'habitLogs', 'goals', 'goalLogs', 'challenges', 'reviews', 'settings', 'contents', 'feeds',
];

export type DataState = { [K in CollectionName]: Record<ID, Collections[K]> };

/** Élément tel qu'affiché : un Item réel ou une occurrence virtuelle d'une série */
export interface ViewItem extends Item {
  virtual?: boolean;
  /** élément affiché dans le planning mais qui vient du calendrier de contenu (aucune copie : on lit la fiche) */
  contentRef?: { kind: 'publish'; contentId: ID } | { kind: 'shoot'; date: DateStr; count: number; shot: number };
}
