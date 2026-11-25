# LX Planner — contexte pour Claude

Application personnelle de planning et de gestion d'une entrepreneuse (prothésiste ongulaire, **LX Beauty**, et formatrice, **LX Academy** en présentiel et en ligne, Reims). Elle l'utilise au quotidien sur iPhone et sur ordinateur. **Toujours répondre en français**, simplement, sans jargon. L'utilisatrice n'est pas développeuse.

## En ligne
- App : https://py38.github.io/lx-planner/ — publiée automatiquement par GitHub Actions (`.github/workflows/deploy.yml`) à chaque `git push` sur `main` (tests + build ; les tests tournent à l'heure de Paris).
- Code : https://github.com/py38/lx-planner (dépôt **public** : ne jamais y mettre de mot de passe, clé secrète ni donnée personnelle de clientes).
- Données : Supabase, projet **lx-planner** (réf. `dkyknlssuuldepxptrpg`). Un seul compte utilisateur (celui de l'utilisatrice).
  - ⚠️ La même organisation Supabase contient un autre projet (`ntybsfcciudyegvwzfcp`, app « saas reservation ») : **ne jamais y toucher**.
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
- `src/data/sync.ts` : synchronisation Supabase (table générique `records`, « dernière modification gagnante », sauvegarde quotidienne `backups`, images dans le stockage privé `media/<compte>/<image>`). `supabase/schema.sql` = schéma complet, relançable.
- `src/data/migrations.ts` : migrations au démarrage, **idempotentes**.
- `src/logic/` : règles métier pures et testées (récurrences, progression, bilans, planification, contenu, urgence, rappels, import OCR).
- `src/views/` : Calendrier (Jour/Semaine/Mois/Année façon Apple), Instagram & Contenu (`views/content/` : Idées, Calendrier de contenu, Tournages, Feed), Projets, Habitudes, Bilans, Réglages, Import RDV, Alertes.
- `tests/` : tests vitest (persistance, récurrences, bilans, synchro simulée entre deux appareils, import Notion, contenu, urgence).

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
