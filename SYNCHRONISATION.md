# Activer la synchronisation entre appareils (Supabase)

Sans cette étape, l'application fonctionne déjà. Vos données sont enregistrées sur l'appareil (IndexedDB) et restent après fermeture ou redémarrage. Mais elles ne passent pas d'un appareil à l'autre. Comptez environ 10 minutes, une seule fois.

## 1. Créer le projet (gratuit)
1. Allez sur https://supabase.com, puis **Start your project**, et créez un compte.
2. Cliquez sur **New project**. Donnez-lui un nom (par ex. `lx-planner`) et un mot de passe de base de données (à conserver). Choisissez la région **West EU (Paris)** ou **Central EU (Frankfurt)**.
3. Attendez environ 2 minutes que le projet soit prêt.

## 2. Créer les tables
1. Dans le menu de gauche, ouvrez **SQL Editor** puis **New query**.
2. Copiez tout le contenu du fichier `supabase/schema.sql`, collez-le, puis cliquez sur **Run**.
3. Le message « Success. No rows returned » doit s'afficher.

## 3. Récupérer les deux clés
Ouvrez **Project Settings**, puis **API** (ou **Data API**) :
- **Project URL**, de la forme `https://xxxx.supabase.co`
- la clé **anon public**, une longue chaîne. N'utilisez jamais la clé `service_role`.

## 4. Relier l'application
Deux possibilités :
- **Dans l'app** : ouvrez **Réglages**, puis **Compte & synchronisation**, collez l'URL et la clé, puis cliquez sur **Enregistrer et activer**. Il faut le faire une fois sur chaque appareil.
- **Une fois pour toutes, au déploiement** : créez un fichier `.env` à la racine avec ces deux lignes, puis redéployez :
  ```
  VITE_SUPABASE_URL=https://xxxx.supabase.co
  VITE_SUPABASE_ANON_KEY=la_cle_anon
  ```

Ensuite, cliquez sur **Créer mon compte**. Supabase envoie un e-mail de confirmation : cliquez sur le lien, puis revenez sur **Se connecter**.
Pour désactiver la confirmation par e-mail, allez dans **Authentication**, puis **Sign In / Providers**, puis **Email**, et décochez « Confirm email ».

## 5. Sur un nouvel appareil
Ouvrez l'app, connectez-vous, puis choisissez **« Récupérer les données du compte »**.

## Ce qui est garanti
- Toute modification est d'abord enregistrée sur l'appareil, puis envoyée au serveur. Hors ligne, elle attend dans une file et part au retour du réseau.
- Le compteur « modification(s) en attente d'envoi » s'affiche dans Réglages.
- Si deux appareils modifient le même élément, la version la plus récente gagne. L'autre est archivée dans la table `record_conflicts` : rien n'est perdu sans trace.
- Une sauvegarde complète est envoyée automatiquement une fois par jour, dans la table `backups`. Les 30 dernières sont gardées et peuvent être restaurées depuis Réglages.
- Vous pouvez aussi exporter un fichier `.json` à tout moment depuis Réglages.

## Coûts et limites de l'offre gratuite
- 0 €. Base de 500 Mo, ce qui suffit très largement pour un usage personnel.
- Un projet gratuit **est mis en pause après 7 jours sans aucune activité**. Vos données ne sont pas perdues : il suffit de le relancer depuis le tableau de bord Supabase. Si vous utilisez l'app régulièrement, cela n'arrivera pas.
- Les sauvegardes automatiques de Supabase lui-même ne sont pas incluses dans l'offre gratuite. C'est pour ça que l'app envoie ses propres sauvegardes quotidiennes (table `backups`).
- L'offre Pro (25 $/mois) supprime la mise en pause et ajoute des sauvegardes gérées par Supabase. Elle n'est pas nécessaire au départ.
