# LX Planner : inventaire des fonctionnalités

Liste de référence de ce que fait l'application. À relire avant chaque publication pour vérifier que rien n'a régressé, et à mettre à jour après chaque évolution validée.

## Planning (onglet « Calendrier »)
- Vues **Jour, Semaine, Mois, Année**, façon Apple, avec navigation par date et bouton « Aujourd'hui ».
- **Tâches, rendez-vous clientes et événements** : catégorie, date, heure, durée, échéance, priorité, notes, liens, rappels, temps de déplacement.
- **Récurrences** (tous les jours, semaines, mois, ou tous les N jours) ; modification ou suppression d'une seule occurrence, des suivantes ou de toutes.
- **Validation manuelle** : une tâche n'est « faite » que lorsqu'on la valide, avec le temps réellement passé. Les heures prévues et réalisées restent séparées.
- **Report** : jamais automatique. L'historique des reports est conservé.
- **« À planifier »** (tâches sans date), créneaux libres, proposition de planning de la journée (à confirmer), glisser-déposer.
- **Dimanche protégé** (simple avertissement), pause repas suggérée, marge entre activités, charge maximale par jour.
- Les publications et tournages du **calendrier de contenu** s'affichent dans le planning **sans copie**.

## Instagram & Contenu
- **Banque d'idées** : une idée = une fiche contenu sans date.
- **Calendrier de contenu** : dates de tournage et de publication, étapes cochables (script, tourné, monté, légende, couverture, publié).
- **Journées de tournage** (scripts regroupés), **simulations de feed** (ordre des vignettes, recadrage).
- **Alerte rouge** : uniquement pour les fiches où la case est cochée (N jours avant publication si pas tourné et monté).

## Projets & Objectifs
- Objectifs annuels, mensuels, hebdomadaires ou ponctuels.
- Projets avec étapes, échéance, état (en cours, bloqué, en pause, terminé), santé du projet (retard, échéance proche).

## Habitudes
- Habitudes à cocher ou en quantité (ex. litres d'eau), par jour, semaine, mois ou tous les N jours ; facultatives ; séances de sport.
- Objectifs chiffrés (manuels ou calculés : habitudes, séances, heures par catégorie, projets terminés) ; défis sur N jours.

## Bilans & Statistiques
- Statistiques par période (heures prévues et réalisées, par catégorie), bilan hebdomadaire clôturé (copie figée).

## LX Academy Présentiel (en construction, phase 1)
- Onglet **Academy** dans la barre du bas sur iPhone (et dans le menu sur ordinateur), avec les 10 rubriques.
- **Bibliothèque pédagogique** : modules M01 à M15 (code, intitulé, objectif), à compléter ; ajout, modification avec numéro de version automatique et conservation de chaque version précédente EN ENTIER (intitulé, durée, objectif, contenu, prérequis, matériel, critères), consultable dans la fiche du module, archivage (jamais de suppression). Les supports manquants sont signalés.
- **Paramètres** :
  - catalogue et tarifs (4 coachings privés), avec l'historique des versions : un changement de tarif n'est jamais rétroactif ;
  - **modalité de chaque offre** : présentiel (journées, horaires, capacité), en ligne (durée d'accès, leçons, durée totale, plateforme : **sans journée ni session présentielle**) ou mixte ; types « Formation en ligne (LX Academy Online) » et « Mini-formation en ligne » prévus. Les offres existantes sont en présentiel sans aucune modification de leurs fiches ;
  - formatrices (une par défaut, d'autres peuvent être ajoutées) ;
  - lieux de formation (adresse et capacité) ;
  - identité administrative (champs vides tant qu'ils ne sont pas renseignés, rien d'inventé).
- Rubriques à venir : prospects et inscriptions, sessions, stagiaires, règlements (phase 2) ; documents (3) ; qualité (5) ; tableau de bord et statistiques (6). Les intégrations Stripe, Calendly et Gmail arrivent en phase 4.

## Alertes & rappels
- Écran Alertes : rappels arrivés, tâches en retard, contenus à préparer, projets en retard, tâches à valider.
- Notifications du navigateur quand l'app est ouverte (si autorisées).

## Import
- **Import de rendez-vous par photo** (lecture du texte, OCR), avec détection des doublons.
- **Import Notion** (idées de contenu).

## Données, synchronisation, sauvegardes
- Une seule source de données ; enregistrement immédiat sur l'appareil (fonctionne hors connexion).
- Synchronisation Supabase entre appareils : file d'envoi hors ligne, « la modification la plus récente gagne », version perdante archivée.
- Une mise à jour de l'app qui ajoute un type de données déclenche une récupération complète du compte, une seule fois.
- Images (couvertures, feed) dans un espace de stockage privé, téléchargées à l'affichage puis gardées hors connexion.
- Sauvegarde automatique quotidienne (30 gardées), export et restauration `.json` dans Réglages. Une sauvegarde faite avec une version précédente reste restaurable.
- **Interrupteur de retour en arrière** : `ACADEMY_VISIBLE` (`src/config.ts`) masque l’onglet Academy sans toucher à ses données.
- **Rappel mensuel d’export** : un bandeau « Pense à exporter tes données » s’affiche si aucun export n’a été fait depuis 30 jours (ou jamais noté), avec « Exporter maintenant » et « Plus tard » (revient 7 jours après). La date du dernier export est affichée dans Réglages › Sauvegarde & export et partagée entre appareils. Sur iPhone, l’export passe par la fenêtre de partage Apple (« Enregistrer dans Fichiers ») ; sur ordinateur, par un téléchargement. La date n’est notée qu’après confirmation « Oui, il est enregistré » ; une annulation ou un échec (message clair) ne change rien. Le fichier contient toutes les rubriques (éléments supprimés compris), sans mot de passe ; les images du feed n’y sont que référencées. Le fichier exporté est une copie complète à ranger hors Supabase (iCloud Drive, clé USB…).
- **Restauration protégée** : avant toute restauration (sauvegarde en ligne, fichier, ou retour en arrière), une « Sauvegarde de sécurité avant restauration » complète de l’appareil (modifications non synchronisées et historiques compris) est faite et relue ; si elle échoue, rien n’est restauré. Copie en ligne quand c’est possible (sinon envoyée au retour du réseau). L’appareil garde les 5 plus récentes et TOUTES celles pas encore en ligne (jamais supprimées ; avertissement, puis nouvelle restauration bloquée à 10 en attente) ; elles partent en ligne dans l’ordre au retour du réseau. Liste dans Réglages › Sauvegarde & export, avec « Revenir à l’état d’avant la restauration » (ou à n’importe laquelle), utilisable hors connexion. Les fiches créées depuis la sauvegarde, même pas encore envoyées, sont conservées.
- **Compteur « modifications en attente d’envoi »** (Réglages) : mis à jour juste après chaque modification, et toujours exact pendant une coupure ou après un échec de synchronisation.
- **Journal des conflits** (Réglages) : versions écartées par le serveur et par l’appareil, différences gardée / écartée et version écartée complète, consultation seule ; conservé lors d’une restauration.
- **Sauvegardes en ligne en deux listes** (classement par libellé exact, identique au serveur ; une copie de sécurité renvoyée après une coupure n’est jamais dupliquée) : quotidiennes et de sécurité avant restauration (30 + 30 gardées séparément une fois la règle serveur mise à jour, voir `supabase/schema.sql`).
- **Lien de confirmation e-mail** : n’entraîne jamais de connexion automatique ; l’adresse est nettoyée et un message s’affiche dans Réglages.
- Application installable sur l'iPhone (PWA), fonctionne hors connexion.
