# QB hebdomadaires — nflverse + Sleeper

Livraison locale du 21 novembre 2026 sur `feat/qb-announcement-collector`.
Elle reprend `d3490d6` et le worker Lambda existant. Aucune activation distante.
Ce document décrit la décision gratuite retenue après les recherches conservées
dans `qb-observation.md`; il ne transforme pas une projection en confirmation.

## Sources et limites vérifiées

- nflverse : calendrier complet et effectifs, identités GSIS/ESPN rapprochées
  sans ambiguïté. Le calendrier fournit une indication de QB, sans confirmation
  de titularisation. Un depth chart n'est pas utilisé comme preuve et aucun gros
  fichier supplémentaire de depth charts n'est téléchargé.
- Sleeper : `GET https://api.sleeper.app/v1/players/nfl?position=QB`, sans token,
  pour ce pool privé non commercial. Un test ponctuel local a obtenu 45 QB avec
  identité exploitable. Ce nombre n'est ni une règle ni une couverture garantie.
  Seuls nom, équipe, identifiant ESPN et statuts sont conservés; aucun article.
- `Active`, `Inactive`, `Probable`, `Questionable`, `Doubtful`, une ligne absente,
  une projection ou un retour à l'entraînement ne confirment jamais un titulaire.
- `Out`, `IR`, `PUP` et `Suspended` constituent des signaux d'indisponibilité.
  Pour créer une exclusion, il faut une identité concordante avec le QB actuel,
  le bon contexte, un relevé effectué après l'ouverture et vieux de 36 h au plus.
  Le relevé est une observation locale, pas la date d'une annonce officielle.
  Sleeper ne garantit ni la date de modification ni le match visé par son tag;
  `Out` peut persister puis être effacé au changement de semaine. Le mode
  observation doit donc être validé avant toute autorisation d'exclusion réelle.
- Les disparitions de `Out` et les retours `Active` ne lèvent aucune absence.
  Une confirmation Admin explicite est requise. Une nouvelle absence après un
  retour observé réarme le blocage et crée un nouveau signal, sans doublons au
  passage suivant. Le risque de faux négatif demeure si un retour puis une
  nouvelle blessure se produisent entre deux lectures quotidiennes.

Sources primaires : [API Sleeper](https://docs.sleeper.com/#players),
[statuts Sleeper](https://support.sleeper.com/en/articles/3570017-injury-statuses-and-ir-eligibility),
[fréquences nflverse](https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html),
[dictionnaire du calendrier](https://raw.githubusercontent.com/nflverse/nflreadr/main/data-raw/dictionary_schedules.csv),
[licence/attribution nflverse](https://github.com/nflverse#licensing).

## Architecture minimale

EventBridge Scheduler déclenche la Lambda. Le worker obtient son contexte auprès
de `qb_observer_exchange` avant d’interroger nflverse et Sleeper. Il utilise
uniquement la clé publiable du projet et un HMAC dédié à cet échange. La RPC
vérifie la signature, l’âge et le nonce de chaque message, puis borne les
opérations au schéma privé du journal. La Lambda n’a aucun accès direct aux
tables. Le paquet ne comporte aucune dépendance supplémentaire.

La RPC fournit le contexte de la collecte. `runs.source_state`
conserve le cache normalisé, les absences et les diagnostics par équipe. Aucun
nouveau service ni nouvelle table. Une revendication durable
`runs.sleeper_requested_at` empêche une seconde lecture avant 24 heures, même si
la réponse du premier worker est perdue. Le booléen signé `allowSleeperFetch`
accorde cette lecture; le worker vérifie aussi la date de sa dernière tentative.
Pas de retry automatique de cette requête ni de nouvelle invocation manuelle
du même payload. Les erreurs et `Retry-After` restent visibles dans le journal.
La latence amont quotidienne n'est pas supprimée par le tick toutes les 2 h.

Budget : 45 secondes, au plus 7 GET (calendrier 3, roster 3, Sleeper 1), 128 KiB
pour l'enveloppe signée. Dépassement = échec sans état partiel. Le nouveau worker
refuse un ancien protocole ne transportant pas le cache et le quota durable.

## Règles conservées

- L'offre fiable existante reste inchangée lorsqu'aucun changement ne l'invalide.
  Il n'y a pas de validation Admin répétée pour toutes les équipes inchangées.
- Une exclusion bloque toute l'équipe, sans promouvoir une autre ligne du
  catalogue. Les projections et les conflits sont soumis à l'Admin existant.
- Une absence persiste entre semaines. Une confirmation Admin ultérieure peut
  rétablir une offre pour la semaine visée. La confirmation du retour du même
  athlète reste valable les semaines suivantes jusqu'à une nouvelle absence;
  confirmer un remplaçant ne prouve pas le retour du blessé. Rien ne réinitialise
  l'historique de consommation ni une réservation existante.
- Le gel utilise le premier kickoff de la semaine NFL complète, même hors pool,
  et le plus tôt des calendriers vérifiés. Rien n'est appliqué après le gel.
- Les snapshots `selected_*`, les résultats `actual_*`, les ratings, points,
  classements et notifications ne sont jamais écrits par la collecte.
- Les RPC et verrous existants continuent de contrôler les sélections et les
  réservations. Seul le QB réellement crédité est consommé après résultat fiable.

## Migration manuelle préparée, non appliquée

`supabase/migrations/20261121183802_qb_free_source_observation.sql` complète les
deux migrations existantes sans les modifier. Elle ajoute l'état et le quota
privés au journal, plus `automation_enabled = false`. Elle adapte les fonctions
de transport, de journal et de filtrage existantes. Les objets privés restent
interdits à `anon`, `authenticated` et `service_role`; les RPC Admin conservent
leur contrôle d'identité et `is_admin`.

L’installation n’effectue aucun appel HTTP, ne crée aucune tâche et ne change
aucun choix ou résultat. Le transport d’observation reste désactivé. Le menu
et les exclusions restent à `false`. Le journal Admin utilise la RPC de
lecture existante et offre la consultation des observations et des sources.

## Mise en service Production — observation uniquement

La mise en service utilise EventBridge et n’utilise plus la file `pg_net`, le
Cron de Supabase ou les identifiants AWS dans la base. Les précédents résultats
d’essai AWS couvrent le collecteur et le HMAC. Le nouvel échange revendication
et retour doit être vérifié sur PostgreSQL et Lambda avant activation.

Appliquer uniquement la migration QB manquante après validation. Déployer le
paquet autonome depuis le commit validé et vérifier son empreinte. EventBridge
utilise un rôle dédié, autorisé à invoquer l’alias de l’observateur. Le
planificateur et le transport sont indépendants des flags du menu.

Conserver `enabled=false` et `automation_enabled=false`. Livrer uniquement la
consultation Admin et le flux d’observation. Les chemins joueurs de `main`,
dont la consommation des QB dans l’ancien menu, doivent rester inchangés.
Valider la première collecte sur une semaine réellement ouverte avant son
premier kickoff. Une semaine déjà gelée doit rester hors fenêtre.

Une panne de source ou du worker laisse les fonctions sportives indépendantes.
Pour arrêter la collecte, couper le transport et désactiver la planification
EventBridge. Conserver le journal et les flags du menu.
