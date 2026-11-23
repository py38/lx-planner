# LX Planner

Application personnelle de planning et de gestion : journées, semaines, mois, année, projets et objectifs, banque d'idées, habitudes, bilans. C'est une PWA : elle s'installe sur l'iPhone comme une application et fonctionne hors connexion.

## Lancer en local (ordinateur)
```bash
npm install
npm run dev        # ouvre http://localhost:5173 (accessible aussi depuis l'iPhone sur le même Wi-Fi)
npm test           # 39 tests automatisés
npm run build      # version de production dans dist/
```

## Mettre en ligne (pour l'utiliser sur iPhone)
Hébergement statique gratuit, au choix :
- **Netlify** : glissez-déposez le dossier `dist/` sur https://app.netlify.com/drop.
- **Vercel** : `npx vercel` à la racine du projet (commande de build `npm run build`, dossier de sortie `dist`).

Ensuite, sur l'iPhone : ouvrez l'adresse dans **Safari**, touchez **Partager**, puis **Sur l'écran d'accueil**.
C'est important : une app installée sur l'écran d'accueil garde ses données durablement et peut recevoir des notifications (iOS 16.4 ou plus récent).

## Synchronisation entre appareils
Voir [SYNCHRONISATION.md](SYNCHRONISATION.md) (Supabase, gratuit).

## Architecture
```
src/
  data/      types.ts (modèle unique), db.ts (IndexedDB), store.ts (source unique en mémoire + persistance),
             actions.ts (toutes les modifications), sync.ts (Supabase), defaults.ts (données de départ)
  logic/     recurrence, progress, habits, stats, planner, content, reminders, alerts, duplicates, ocrParse
  ui/        composants communs (éditeur, validation, planification, glisser-déposer)
  views/     Journée, Semaine, Mois, Année, Projets, Idées, Habitudes, Bilans, Réglages, Import, Alertes
supabase/schema.sql   tables, sécurité par compte, règle « dernière modification gagnante », sauvegardes
tests/                tests de la logique, de la persistance et de la synchronisation
```
Règles inscrites dans le code :
- une seule source de données pour toutes les vues ;
- « réalisé » uniquement après validation manuelle ;
- heures prévues et heures réalisées toujours séparées ;
- aucun déplacement ni report automatique.
