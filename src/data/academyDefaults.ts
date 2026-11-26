// Données de départ de l'espace LX Academy Présentiel (catalogue, modules, formatrice et lieu par défaut).
// Identifiants FIXES : chaque appareil crée les mêmes fiches, donc aucun doublon après synchronisation.
// Horodatage ANCIEN : toute modification faite par l'utilisatrice, sur n'importe quel appareil, l'emporte.
//
// ⚠️ Dépôt public : aucune donnée personnelle ici (ni nom, ni adresse, ni numéros administratifs).
// Ces informations sont saisies dans l'app (Academy › Paramètres) et restent dans les données du compte.
import type { AcModule, AcOffer, AcSettings, AcTrainer, AcVenue } from './types';

export const ACADEMY_SEED_STAMP = '2026-01-01T00:00:00.000Z';
export const AC_SETTINGS_ID = 'ac-settings';
export const AC_DEFAULT_TRAINER_ID = 'ac-trainer-1';
export const AC_DEFAULT_VENUE_ID = 'ac-venue-1';

const base = (id: string) => ({ id, createdAt: ACADEMY_SEED_STAMP, updatedAt: ACADEMY_SEED_STAMP });

/** Journée type des coachings privés : 9 h – 17 h, 30 min de pause, 7 h 30 pédagogiques. */
const DAY = { startTime: '09:00', endTime: '17:00', lunchMin: 30, pedagogicalMinPerDay: 450 } as const;

export function academyOffers(): AcOffer[] {
  const offer = (code: string, title: string, format: 'solo' | 'duo', days: number, priceCents: number, order: number): AcOffer => ({
    ...base(`ac-offer-${code}`),
    code, title, type: 'private_coaching', format, days, priceCents,
    capacity: format === 'solo' ? 1 : 2,
    ...DAY,
    active: true, order, version: 1, history: [],
  });
  return [
    offer('solo-1j', 'Coaching privé Solo — 1 journée', 'solo', 1, 50000, 0),
    offer('solo-2j', 'Coaching privé Solo — 2 journées', 'solo', 2, 95000, 1),
    offer('duo-1j', 'Coaching privé Duo — 1 journée', 'duo', 1, 35000, 2),
    offer('duo-2j', 'Coaching privé Duo — 2 journées', 'duo', 2, 65000, 3),
  ];
}

/** Modules initiaux : code, intitulé et objectif uniquement. Le contenu détaillé sera saisi par l'utilisatrice. */
export const ACADEMY_MODULES: [string, string, string][] = [
  ['M01', 'Hygiène, désinfection et stérilisation', 'Appliquer un protocole d’hygiène adapté.'],
  ['M02', 'Anatomie de l’ongle naturel', 'Identifier les différentes structures de l’ongle.'],
  ['M03', 'Choix du matériel et des produits', 'Sélectionner le matériel adapté à chaque prestation.'],
  ['M04', 'Manucure russe', 'Réaliser une manucure précise et sécurisée.'],
  ['M05', 'Préparation de la plaque naturelle', 'Optimiser l’adhérence des produits.'],
  ['M06', 'Renforcement de l’ongle naturel', 'Réaliser un renforcement adapté à la morphologie de l’ongle.'],
  ['M07', 'Extensions avec capsules', 'Réaliser des extensions solides et harmonieuses.'],
  ['M08', 'Architecture et construction en gel', 'Maîtriser la structure et l’équilibre d’une construction.'],
  ['M09', 'Maîtrise du limage', 'Obtenir une forme régulière et symétrique.'],
  ['M10', 'Application de la couleur', 'Réaliser une application uniforme et précise.'],
  ['M11', 'French et baby-boomer', 'Maîtriser les techniques de French et de dégradé.'],
  ['M12', 'Dépose et remplissage', 'Réaliser une dépose et un remplissage sécurisés.'],
  ['M13', 'Correction des décollements et des casses', 'Identifier et corriger les causes des défauts de tenue.'],
  ['M14', 'Optimisation du temps de prestation', 'Réduire son temps de prestation sans compromettre la qualité.'],
  ['M15', 'Organisation du poste de travail', 'Organiser un environnement de travail efficace.'],
];

export function academyModules(): AcModule[] {
  return ACADEMY_MODULES.map(([code, title, objective], i) => ({
    ...base(`ac-module-${code.toLowerCase()}`),
    code, title, objective, version: 1, versionDate: ACADEMY_SEED_STAMP.slice(0, 10), status: 'active', order: i,
  }));
}

export function academyTrainer(): AcTrainer {
  return { ...base(AC_DEFAULT_TRAINER_ID), name: '', isDefault: true, active: true, order: 0 };
}

export function academyVenue(): AcVenue {
  return { ...base(AC_DEFAULT_VENUE_ID), name: 'Lieu principal', address: '', isDefault: true, active: true, order: 0 };
}

export function academySettings(): AcSettings {
  return {
    ...base(AC_SETTINGS_ID),
    identity: { legalForm: 'Entrepreneur individuel', tradeName: 'Lx Beauty', trainingBrand: 'LX Academy' },
  };
}
