# Veille et menu hebdomadaire des QB

L’Admin régulier affiche les différences entre les QB indiqués par nflverse et les titulaires proposés dans le pool. Il peut confirmer un signal après vérification, l’écarter, retirer un QB indisponible ou sélectionner un QB du catalogue par nom et identifiant ESPN. Une correction confirmée s’applique seulement à la semaine régulière visée.

## État vérifié le 12 novembre 2026

La policy `Admins can insert qbs` existe en Production. Elle a été appliquée manuellement et figure dans l’historique sous `20261109091053_admin_insert_qbs_rls`. C’est une policy permissive `INSERT` pour `authenticated`, avec le prédicat suivant.

```sql
exists (
  select 1 from public.users u
  where u.id = (select auth.uid()) and u.is_admin is true
)
```

Cette policy autorise l’ajout d’un remplaçant absent du catalogue depuis l’Admin actuel, qui utilise la session authentifiée du navigateur. L’essai réel d’ajout depuis l’interface reste à valider avec autorisation. RLS reste active sur `qbs`. Le trigger `lifecycle_user_admin_flag` est actif et `guard_user_admin_flag()` réserve les changements de `is_admin` à `postgres` et `service_role`. Les deux migrations QB de cette branche conservent cette policy et ces protections. Lors d’une reconstruction complète de la base, reprendre aussi la migration manuelle consignée dans l’historique.

Le worker Lambda ne possède aucun identifiant de base et utilise HMAC. Le tick planifié s’exécute comme `postgres`. Les RPC Admin contrôlent `auth.uid()` et `users.is_admin`, puis utilisent les droits de leur propriétaire `postgres` pour leurs écritures contrôlées. La clé `service_role` reste réservée aux traitements serveur existants.

À cette date, les deux migrations QB sont absentes de Production, comme le schéma `qb_observation`. `pg_cron` et `pg_net` sont disponibles et préchargés, avec leurs extensions encore à installer. Vault et pgcrypto sont installés. Aucun des deux secrets dédiés à l’observation n’existe. Le rôle serveur `service_role` peut lire Vault. Les rôles `anon`, `authenticated` et `authenticator` ne le peuvent pas.

La semaine active est la semaine 10 de 2026, ouverte le 10 novembre et comportant déjà 12 choix QB au moment de la lecture. L’activation du menu doit attendre une semaine vierge de choix. Le remplacement Sam Darnold → Drew Lock de semaine 9 est enregistré, et le catalogue contient Drew Lock comme QB actif non titulaire. Ces données servent au contrôle de compatibilité et doivent être conservées.

## Vérification préalable à l’automatisation simplifiée — 14 novembre 2026

**Décision : arrêt avant implémentation de l’application automatique.** Le flux
actuellement retenu ne permet pas de distinguer suffisamment une projection,
une titularisation confirmée et une absence confirmée avant le premier kickoff.
Il reste utilisable pour proposer des changements soumis à confirmation Admin.

Le worker `observe.mjs` appelle uniquement le calendrier et les effectifs
nflverse. Dans `nflverse.mjs`, chaque écart rapproché à un identifiant ESPN est
explicitement émis avec `status: 'ambiguous'` et `reason: 'nflverse_projection'`.
Le rapprochement d’identité ne constitue pas une preuve de disponibilité.

Vérifications des sources primaires :

- Le [dictionnaire du calendrier](https://raw.githubusercontent.com/nflverse/nflreadr/main/data-raw/dictionary_schedules.csv)
  décrit les identités des QB titulaires, sans statut de confirmation, motif
  d’absence, annonce officielle ou date de publication de cette annonce.
- Le [dictionnaire des effectifs](https://raw.githubusercontent.com/nflverse/nflreadr/main/data-raw/dictionary_rosters.csv)
  permet le rapprochement des identités. Le statut d’effectif ne prouve pas la
  titularisation pour le prochain match; la position au depth chart peut être inexacte.
- Le [calendrier de mise à jour](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html)
  annonce une actualisation du calendrier toutes les cinq minutes, mais des
  effectifs, depth charts et blessures quotidiennement vers 07:00 UTC. Une
  vérification locale toutes les deux heures ne supprime pas cette latence amont.
- Les [depth charts](https://nflreadr.nflverse.com/articles/dictionary_depth_charts.html)
  donnent un rang et une date de chargement, pas une annonce de titularisation.
  Les [blessures](https://nflreadr.nflverse.com/articles/dictionary_injuries.html)
  peuvent donner le statut officiel de match et sa date de modification, mais ne
  désignent pas le remplaçant confirmé. Ces deux flux ne sont pas lus par le
  worker actuel; leur présence dans la documentation ne démontre pas la fraîcheur
  effective d’une donnée de la semaine active.

Les pages publiques des releases calendrier, effectifs et blessures sont
accessibles. Le chargement des listes d’assets par l’outil de lecture n’a pas
abouti : aucune fraîcheur effective d’un fichier 2026 n’est donc certifiée par
cette vérification. Cela ne prouve pas une indisponibilité du fournisseur. Aucune
collecte du worker n’a été lancée.

Solution minimale praticable : conserver le collecteur, le journal et les actions
Admin existantes. L’Admin confirme le titulaire ou l’absence sur une information
officielle liée au match; seule l’affectation hebdomadaire change. Les snapshots,
résultats, ratings, consommation réelle et réservations restent inchangés. Un QB
confirmé absent est retiré de l’offre; sans remplaçant suffisamment confirmé,
l’équipe reste sans offre. Le retour la semaine suivante exige une revalidation,
sans effacement de l’historique et sans libération d’une équipe déjà réservée.

Cette solution nécessite une confirmation humaine pour chaque changement
détecté. Elle ne remplit donc pas encore l’objectif d’intervention Admin seulement
exceptionnelle. L’application automatique reste bloquée tant qu’une preuve
intrajournalière suffisamment explicite n’a pas été établie. Augmenter la fréquence
ne résoudrait pas ce manque de preuve. Aucun code fonctionnel, migration, secret,
menu, job, ressource AWS ou donnée Production n’a été modifié pour cette étape.

## Flux d’observation

- La Lambda demande une autorisation de collecte à la RPC. PostgreSQL utilise
  la saison et la semaine actives, l’ouverture réelle dans
  `qb_selection_weeks.started_at` et tous les matchs NFL de la semaine. Il
  accorde au plus un passage par tranche de deux heures.
- Le worker valide les fichiers du calendrier et des effectifs
  [nflverse](https://github.com/nflverse/nflverse-data/releases). Le premier
  kickoff est le plus tôt des deux calendriers. Les statuts Sleeper ajoutent
  des signaux d’indisponibilité. Les projections et conflits restent à
  vérifier dans l’Admin.
- Le worker envoie le rapport signé à la RPC. PostgreSQL vérifie le HMAC, le
  nonce, le contexte et le gel. Les observations et les tentatives Sleeper
  sont dédupliquées. L’interface Admin de cette livraison consulte le journal.

## Recommandations Admin

L’Observatoire affiche les recommandations de la semaine avant le journal
technique. Il lit le contexte Admin et les 100 derniers signaux. Le statut du
QB, les identités, les sources et l’effet éventuel sur le menu sont présentés
ensemble. Une piste basée sur nflverse et Sleeper reste soumise à une
confirmation pour le match. Le rapport de blessures nflverse peut corroborer
une absence, et une annonce explicite du club peut confirmer le titulaire.

Le lot visuel utilise les deux lectures Admin déjà présentes en Production.
Le lot manuel présente le titulaire actuel et le remplaçant potentiel. Pour
un autre nom, la route Admin vérifie l’identité sur l’effectif ESPN de
l’équipe et la présente avant confirmation. Le serveur revérifie le nom,
l’identifiant et le poste au moment de la confirmation. Le RPC, réservé à
la route serveur, vérifie l’Admin, le signal et l’état de l’équipe sous
verrou. Une fiche périmée demande un rafraîchissement.

Un changement retrouve l’unique titulaire actif à partir de la colonne
`qbs.team`, puis met à jour son nom et son identifiant ESPN. Le même UUID
maintient la réservation. Lorsque le menu automatisé est désactivé, une
ancienne affectation hebdomadaire ne change pas la ligne retenue.
La confirmation refuse une collision d’identité ou une modification
susceptible de réécrire un historique sans snapshot. Une confirmation de
maintien journalise la décision sans réécrire
le catalogue. Le journal retient le rapport traité, et les rapports
ultérieurs peuvent apporter de nouveaux signalements.

`manual_admin_enabled` est une autorisation indépendante, réservée à la
configuration privée et initialisée à `false`. L’action manuelle exige une
semaine régulière ouverte avant le premier kickoff, avec `enabled=false`
et `automation_enabled=false`. Le menu habituel reste la source pour les
joueurs. Il recharge le catalogue à l’ouverture et au retour au premier
plan, ainsi qu’à la réception d’une mise à jour Realtime lorsqu’elle est
disponible. Les nouvelles sélections vérifient aussi l’identité affichée
après un changement de titulaire. L’admissibilité utilise l’identifiant ESPN
du QB qui a joué lorsqu’un rating officiel est disponible. Le titulaire
sélectionné qui n’a pas joué reste admissible pour une semaine ultérieure,
sous réserve des autres choix du participant.

### Désactivation des confirmations manuelles

Le déploiement applique seulement la migration
`20261124102217_qb_manual_recommendation_review.sql`, puis publie l’application.
Une fois la version Vercel vérifiée, un administrateur de la base peut passer
`manual_admin_enabled` à `true` avec les deux réglages automatiques à
`false`. La confirmation reste fermée après le premier kickoff.

Pour suspendre les confirmations, exécuter en tant qu’administrateur de la base :

```sql
update qb_observation.regular_menu_config
set manual_admin_enabled = false
where singleton and manual_admin_enabled;
```

Vérifier les trois réglages dans la configuration. Conserver la migration,
le journal et les décisions effectuées. Avant un retour à une ancienne
version Vercel, vérifier qu’elle transmet l’identifiant ESPN à la soumission
d’un choix. Après une confirmation ayant changé un titulaire, cette valeur
reste nécessaire pour protéger les joueurs contre les onglets périmés.

## Vérification de l’infrastructure avant activation

Exécuter ces lectures après la migration, avant l’activation. Le contrôle
ne lit aucune valeur de secret.

```sql
select enabled, automation_enabled from qb_observation.regular_menu_config;
select dispatch_enabled from qb_observation.transport_control;

select rolname,
  has_function_privilege(oid, 'public.qb_observer_exchange(text,text)', 'EXECUTE') as exchange,
  has_any_column_privilege(oid, 'qb_observation.transport_control', 'SELECT,INSERT,UPDATE') as config_access,
  has_any_column_privilege(oid, 'qb_observation.runs', 'SELECT,INSERT,UPDATE') as journal_access
from pg_roles
where rolname in ('anon', 'authenticated', 'authenticator', 'service_role');
```

Seul `anon` doit pouvoir appeler cette RPC. La clé publiable fournit ce rôle.
Le HMAC authentifie le worker avant tout accès aux données du journal. Aucun
rôle applicatif ne doit pouvoir lire la configuration privée ou écrire le
journal directement.

## Installation Production — observation seulement

Les deux premières migrations QB sont déjà installées. Le contrôle du
23 novembre a trouvé des privilèges trop larges sur la file `pg_net`. La
version à livrer utilise EventBridge et la RPC HTTPS
`public.qb_observer_exchange` à la place de cette file et de Vault.

1. Vérifier les tests natifs sur le lot exact, puis installer uniquement la
   migration QB manquante. Vérifier que le transport et les deux flags du
   menu sont à `false`. Vérifier les droits et le refus HMAC avant activation.
2. Générer un paquet autonome depuis le commit validé. Déployer sur la Lambda
   existante en Ohio, avec Node.js 24, `index.handler`, 512 Mo et 50 secondes.
   Laisser le worker désactivé pendant la vérification de la configuration.
   La Lambda a besoin de la clé publiable Supabase et du HMAC dédié à la RPC.
   Générer le HMAC côté base et récupérer uniquement un chiffré destiné à une
   clé publique de transfert éphémère. Déchiffrer localement directement vers
   la configuration Lambda. Exclure la valeur en clair du SQL, des sorties,
   de Git et du navigateur.
3. Publier et pointer un alias réservé à l’observateur. Créer une planification
   EventBridge désactivée au départ. Limiter le rôle Scheduler à
   `lambda:InvokeFunction` sur cet alias et sa relation de confiance au compte
   et au groupe de planification exacts. Désactiver les relances dans
   Scheduler et pour les invocations asynchrones de cet alias.
4. Vérifier les validations et l’isolement du diff Admin. Activer la
   réception et la planification avec les flags du menu à `false`. Vérifier
   le premier passage avant le kickoff d’une semaine réellement ouverte,
   sans modifier le calendrier ou l’état sportif. Vérifier le rapport
   signé, la déduplication, les deux sources et le journal Admin.

Planification prévue : toutes les 15 minutes. La base autorise au plus un
passage par fenêtre de deux heures. Un appel hors fenêtre ne collecte aucune
source. Le quota Sleeper reste d’une lecture par 24 heures.

```sql
-- Arrêt immédiat de l’observateur, indépendant des flags du menu.
update qb_observation.transport_control set dispatch_enabled = false where singleton;
```

Passer ensuite la planification EventBridge à `DISABLED`. Pour une suspension
prolongée, laisser l’alias arrêté et renouveler le HMAC avant remise en service.
Conserver les observations et les données sportives.

Coût estimé pour la collecte. nflverse et Sleeper restent gratuits pour cet
usage privé. Avec un déclenchement toutes les 15 minutes, 2 976 invocations
mensuelles au plus représentent 74 400 Go-secondes même à 50 s chacune.
Cette borne reste dans le quota gratuit Lambda et Scheduler s’il reste
disponible. Journaux et transfert peuvent s’ajouter.

Références officielles

- [Clés publiables Supabase](https://supabase.com/docs/guides/api/api-keys)
- [AWS EventBridge Scheduler et Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html)
- [Tarifs Lambda](https://aws.amazon.com/lambda/pricing/)
