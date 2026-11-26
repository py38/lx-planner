# LX Planner — contexte pour Claude

Application personnelle de planning et de gestion d'une entrepreneuse (prothésiste ongulaire, **LX Beauty**, et formatrice, **LX Academy** en présentiel et en ligne, Reims). Elle l'utilise au quotidien sur iPhone et sur ordinateur. **Toujours répondre en français**, simplement, sans jargon. L'utilisatrice n'est pas développeuse.

## En ligne
- App : https://py38.github.io/lx-planner/ — publiée automatiquement par GitHub Actions (`.github/workflows/deploy.yml`) à chaque `git push` sur `main` (tests + build ; les tests tournent à l'heure de Paris).
- Code : https://github.com/py38/lx-planner (dépôt **public** : ne jamais y mettre de mot de passe, clé secrète ni donnée personnelle de clientes).
- Données : Supabase, projet **lx-planner** (réf. `dkyknlssuuldepxptrpg`). Un seul compte utilisateur (celui de l'utilisatrice).
  - Le projet est dans l'organisation Supabase **« LX Beauty »** (depuis le 25/11/2026), séparée de celle de son mari.
  - ⚠️ Un autre projet existe dans l'ancienne organisation (`ntybsfcciudyegvwzfcp`, app « saas reservation ») : **ne jamais y toucher**.
  - La clé « publishable » dans `src/data/sync.ts` est publique par conception (sécurité par compte = RLS). Ne jamais utiliser ni committer la clé `service_role` / secrète.

## Lancer en local
```bash
npm install
npm run dev     # http://localhost:5173
npm test        # tests automatisés (vitest) — doivent tous passer avant un push
npm run build
```
Attention : les données d'un navigateur sur `localhost` sont séparées de celles du site en ligne. Pour tester avec les vraies données, se connecter au compte dans l'app.

## Architecture (Vite + React 18 + TypeScript, PWA)
- `src/data/types.ts` : modèle de données unique (tâches, séries récurrentes, catégories, projets, objectifs, habitudes, objectifs chiffrés, défis, bilans, fiches contenu, simulations de feed, réglages).
- `src/data/store.ts` : source de données unique en mémoire + IndexedDB (`db.ts`) + file d'envoi. **Toutes** les modifications passent par `store` / `actions.ts` ; ne jamais créer un second système de stockage.
- `src/data/sync.ts` : synchronisation Supabase (table générique `records`, « dernière modification gagnante », sauvegarde quotidienne `backups`, images dans le stockage privé `media/<compte>/<image>`). Toute restauration passe par `makeSafetyBackup` (copie vérifiée, gardée dans la méta `safetyBackups` : 5 plus récentes + toutes celles non envoyées, jamais supprimées si non envoyées, restauration bloquée à 10 en attente, voir `pruneSafety` ; conservée par `replaceAll`) puis `restoreExport(file, store, safety)`, qui refuse sans elle. Export : `data/exportFlow.ts` (`runExport` : partage Apple sur iPhone ou téléchargement, message si échec, date `settings.lastExportAt` notée seulement après confirmation) ; rappel mensuel `logic/exportReminder.ts`, bandeau dans `App.tsx`. Retour en arrière de la phase 1 : `ACADEMY_VISIBLE` dans `src/config.ts` (masque l’onglet, ne touche pas aux données). `supabase/schema.sql` = schéma complet, relançable.
- `src/data/migrations.ts` : migrations au démarrage, **idempotentes**.
- `src/logic/` : règles métier pures et testées (récurrences, progression, bilans, planification, contenu, urgence, rappels, import OCR).
- `src/views/` : Calendrier (Jour/Semaine/Mois/Année façon Apple), Instagram & Contenu (`views/content/` : Idées, Calendrier de contenu, Tournages, Feed), Projets, Habitudes, Bilans, Réglages, Import RDV, Alertes.
- `src/views/academy/` + `src/logic/academy.ts` + `src/data/academyDefaults.ts` : espace **LX Academy Présentiel** (en construction par phases ; plan complet validé par l'utilisatrice). Collections préfixées `ac` (`acTrainers`, `acVenues`, `acOffers`, `acModules`, `acSettings`). Données de départ créées par `seedAcademy` (migrations) avec **identifiants fixes et horodatage ancien** : pas de doublon entre appareils, et une modification de l'utilisatrice gagne toujours. Les tarifs sont versionnés (`history`) et ne sont jamais rétroactifs. Les offres ont une modalité (`modality` : onsite / online / hybrid, absente = présentiel, lire avec `modalityOf`) ; seul le prix est obligatoire, les champs présentiel et en ligne sont facultatifs (exigence E10 : futures offres en ligne sans journées ni session). Les modules aussi : `updateModule` garde chaque version précédente complète dans `history` (traçabilité pédagogique). Aucune donnée personnelle (nom, adresse, SIRET…) dans le code : elles se saisissent dans Academy › Paramètres.
- `tests/` : tests vitest (persistance, récurrences, bilans, synchro simulée entre deux appareils, import Notion, contenu, urgence, LX Academy).
- `FONCTIONNALITES.md` : inventaire des fonctionnalités, à vérifier avant chaque publication et à mettre à jour après chaque évolution validée.
- Ajouter une collection = l'ajouter à `COLLECTIONS` **et** augmenter `DB_VERSION` dans `db.ts`. La signature des collections déclenche alors une récupération complète une fois par appareil, et les anciennes sauvegardes restent restaurables (`validateExport`).

## Règles à ne jamais casser
1. Une tâche n'est comptée « faite » que si l'utilisatrice la valide. Heures **prévues** et heures **réalisées** toujours séparées.
2. Rien n'est déplacé, reporté ni supprimé automatiquement : l'app propose, elle confirme.
3. Le calendrier de contenu est séparé du planning, mais ses publications et tournages s'affichent dans le planning **sans copie** (ids `cp:` / `cs:`, voir `contentPlanningItems`).
4. Une idée de contenu = une fiche contenu sans date (Banque d'idées). La planifier = lui donner une date, jamais la dupliquer.
5. Le rouge (« Alerte rouge ») ne concerne **que** les fiches contenu où la case est cochée (3 jours avant publication si pas tourné + monté).
6. Le dimanche est protégé par défaut (simple avertissement, jamais un blocage).
7. Toute nouvelle donnée doit passer par la synchronisation existante (nouvelle collection = l'ajouter à `COLLECTIONS` dans `types.ts`).
8. Avant chaque `git push` : `npm test` et `npx tsc --noEmit -p .` sans erreur.

## Style
Marque « Quiet Luxury » : fond crème `#F2EFEA`, brun `#33251A`, police Poppins, catégories pastel. Interface épurée, pensée d'abord pour iPhone (vérifier à 375 px de large, sans défilement horizontal).

## Idées en attente
- Envoi d'e-mails depuis l'app (connexion à sa boîte mail) : nécessite une partie serveur (ex. Supabase Edge Function + API Gmail ou service d'envoi) — **ne jamais mettre de clé secrète dans le code de l'app**.
- Notifications téléphone app fermée (Web Push) : nécessite un envoi programmé côté serveur.
- Supabase › Authentication › URL Configuration : mettre l'adresse de l'app comme « Site URL » (le lien de confirmation e-mail pointe encore vers localhost).
