# Rappels — configuration manuelle après validation

## Système réutilisé et périmètre

Le dépôt possède déjà `push_notification_events` (clé unique `event_key`), `push_subscriptions`, `lib/pushNotifications.js`, le service worker et les routes `first-player`, `next-player`, `scheduled`. La cloche/activation push et son interface restent inchangées. Aucun stockage parallèle ni boîte de réception in-app supplémentaire. Aucun envoi réel pendant les tests.

La notification « c’est ton tour » et son ordonnanceur quotidien ne changent pas. Leur cron reste `30 12 * * *` UTC. Le worker historique exclut seulement les quatre nouveaux types, pour qu’il ne contourne pas leur réservation atomique.

## Règles

- Régulier : copie en lecture seule de l’ordre de `/matchs` (ordre nominatif semaine 1, scores précédents croissants puis nom). Le premier joueur sans choix QB est le joueur courant, exactement comme cette page. Aucun score/choix/ordre n’est écrit.
- Horloge d’admissibilité : maximum du début réel `qb_selection_weeks.started_at`, des dates `qb_picks.created_at` et des dates `picks.updated_at` (sinon `created_at`) des soumissions complètes précédentes. Cela ne part ni du cron ni de la réception push. Pour le premier joueur : début de semaine. S’il manque une date fiable ou des picks du précédent, aucun rappel n’est inventé. Le régulier est non atomique; un QB enregistré sans tous ses picks ne produit pas artificiellement une fin de soumission.
- Échéance : +5 heures écoulées, puis report à 08:30 si elle tombe dans [22:00,08:30[. Si le cron lui-même arrive en heures silencieuses, il attend également 08:30. Relecture : joueur courant, semaine/cycle inchangés, aucune sélection QB, matchs éligibles pas commencés. Une clé par joueur/semaine, indépendamment du cycle : jamais un deuxième rappel de cette semaine.
- Séries : un trigger sur la transition effective `draft -> open`, utilisée par préparer/passer dans le RPC Admin existant, capture `reminder_opened_at` et inscrit une notification d’ouverture par participant dans la même transaction. Aucune consultation/recalculation n’en crée. Aucun rattrapage pour les rondes déjà ouvertes lors de l’installation. Les rondes TEST ne génèrent pas d’annonce d’ouverture.
- H-24 : premier kickoff officiel numérique de la ronde entière moins 24 heures écoulées.
- Dernier rappel : 08:30 Toronto à la date locale de ce même kickoff (samedi/dimanche/lundi identiques). Aucun H-12, aucun +5 heures en séries.
- H-24/08:30 : QB + parcours + tous les matchs (et total au SB) présents = aucun rappel. Relecture avant réservation; ronde ouverte, premier kickoff futur, aucun match LIVE/FINAL. Une échéance passée avant l’ouverture n’est pas envoyée rétroactivement. Un kickoff modifié recalcule les échéances non encore tentées. Les IDs TEST sont ignorés pour le kickoff officiel et ne déclenchent aucun appel ESPN.
- « Participants concernés » = utilisateurs de `public.users`, comme le pool actuel; aucun registre distinct d’inscription aux Séries n’existe dans ce dépôt. Une future restriction de participation devra être branchée explicitement.

## Concurrence et livraison

Les clés déterministes sont uniques dans la file existante. `queue_pool_reminder` ne réinitialise jamais une tentative. `claim_pool_reminder` verrouille la ligne, contrôle les données réelles, puis inscrit `reminder_attempted_at` **avant** l’appel push. Le worker relit aussi tout le contexte, notamment l’ordre régulier, juste avant cette réservation. Deux workers ne peuvent pas obtenir la même réservation. La vérification correspond à cet instant; aucun réseau externe ne peut partager la transaction des choix.

Le transport existant envoie vers chaque abonnement du joueur (plusieurs appareils possibles). Il n’offre aucune clé d’idempotence côté fournisseur. Garantie : **au plus une tentative de transport par événement**, pas une livraison garantie. Une panne après réservation, une erreur réseau ambiguë ou aucun abonnement n’entraînent pas de relance automatique, pour éviter les doublons. Les erreurs sont renvoyées dans les résultats du job. Une tentative dont le statut n’a pas pu être enregistré conserve son marqueur et ne repart pas. Les anciennes échéances devenues inéligibles restent non envoyées; pas de suppression d’historique automatique.

## Migration séparée et précontrôle obligatoire

`supabase/migrations/202609300001_notification_reminders.sql` étend la file existante : contexte JSON, tentative et annulation facultatives, index d’échéance; `week` devient nullable pour ne pas inventer une semaine régulière aux Séries. Elle ajoute l’heure d’ouverture à `playoff_rounds`, deux RPC privées (propriétaire/service_role) et les triggers d’ouverture. Pas de nouvelle table. Aucune politique RLS existante ni permission de lecture de l’interface n’est remplacée; aucun droit ordinaire d’écriture n’est ajouté.

La création historique de `push_notification_events` n’est pas versionnée. **Avant application**, contrôler en lecture seule dans le projet cible :

```sql
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public'
and table_name in ('push_notification_events','qb_selection_weeks','qb_picks','picks')
order by table_name,ordinal_position;
select conname,pg_get_constraintdef(oid) from pg_constraint
where conrelid='public.push_notification_events'::regclass;
select * from pg_policies where tablename='push_notification_events';
select grantee,privilege_type from information_schema.table_privileges
where table_schema='public' and table_name='push_notification_events';
```

Attendus : `event_key` unique, `user_id` UUID, `notification_type` texte acceptant les quatre nouveaux types, `week` entier, `scheduled_for`/`sent_at` timestamptz, `status` acceptant pending/sent/no_subscription; tout autre champ obligatoire possède un défaut. Utilisateurs ordinaires sans droit effectif de créer/modifier ces événements; le service dispose des droits habituels de la file. Vérifier les horodatages réguliers mentionnés plus haut. Si un enum/CHECK, une politique ou une colonne diffère, arrêter et adapter la migration avant toute installation. Les tests utilisent ce contrat minimal et ne prétendent pas avoir inspecté la base distante.

Ordre manuel, uniquement après approbation, depuis la racine du dépôt :

```sh
# URL propriétaire fournie de façon privée par l’opérateur.
psql "$PLAYOFFS_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609290001_playoff_scoring.sql
psql "$PLAYOFFS_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/202609300001_notification_reminders.sql
```

Ou exécuter chacun de ces deux nouveaux fichiers finaux dans le SQL Editor, dans cet ordre, en conservant BEGIN/COMMIT. **Ne pas rejouer 202609250001_playoff_round_admin.sql, ni les seeds, ni lancer supabase db push.** Aucune de ces opérations distantes n’a été effectuée ici.

Après application : vérifier colonnes/index/triggers, et `has_function_privilege` pour queue/claim : anon/authenticated faux, service_role vrai. Recontrôler RLS/permissions de la file, restées identiques. Tester sur une base de développement et des abonnements de test avant activation.

## Vercel, fréquence et fuseau

Nouveau chemin `/api/push/reminders`, cron déclaré `*/5 * * * *` : une vérification toutes les cinq minutes. L’envoi se fait au premier passage après l’échéance; pas de promesse à la seconde/minute exacte ni de garantie de ponctualité en cas d’indisponibilité. Vercel exécute les cron de production, pas les Preview. À ce stade le cron est seulement configuré dans le code de branche : aucun déploiement ni job nouveau activé.

Configuration à vérifier plus tard dans Vercel :

- Plan autorisant les cron toutes les cinq minutes (Pro ou supérieur; Hobby limité à une exécution quotidienne).
- `CRON_SECRET` existant, secret fort : Vercel transmet `Authorization: Bearer ...`; sans correspondance la route répond 401.
- `POOL_REMINDERS_ENABLED=true` **uniquement après migrations et validation**. Absent/autre valeur : route inactive, aucune lecture/écriture/envoi de rappels.
- Variables déjà utilisées par le push : `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Ne pas remplacer les clés VAPID existantes.
- Déployer uniquement lorsque l’opérateur l’autorisera. L’absence du flag protège l’ancien schéma, même si le nouveau cron est déclaré.

Le cron est en UTC; les échéances sont des instants UTC dérivés de `America/Toronto` via Intl/IANA (et `AT TIME ZONE` côté PostgreSQL). Aucune conversion -4/-5 fixe : 08:30 suit automatiquement les changements d’heure. +5h et H-24 sont des durées réelles, pas des heures murales. Tests aux deux transitions DST.

Documentation Vercel : https://vercel.com/docs/cron-jobs/usage-and-pricing et https://vercel.com/docs/cron-jobs/manage-cron-jobs.

## Validation locale

Les tests JS couvrent échéances, heures silencieuses, changement d’heure, tour/semaine, soumissions, kickoffs samedi/dimanche/lundi, replanification, relecture et concurrence. Les tests PostgreSQL PGlite couvrent migration/rejeu, ACL, ouverture unique, claim unique, invalidation et TEST. Le cycle complet scoring 4 rondes/13 matchs s’exécute aussi avec cette migration installée localement. Aucun appel push/ESPN réel dans ces tests.
