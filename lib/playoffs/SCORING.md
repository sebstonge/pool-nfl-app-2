# Scoring Playoffs — application et validation

## Architecture

- `scoring.mjs` : fonctions pures, FINAL explicite, 0/1/2, parcours limité à son match, compteur de matchs réellement joués, QB séparé, scores arrondis avec `Number(toFixed(3))` comme le régulier. Zéro rating donne zéro point.
- `qbResults.mjs` : adaptateur du **summary ESPN déjà utilisé**, même catégorie passing, labels RTG/RAT/RATE, conversion Number et sélection que `app/admin/page.js:updateQBRatingsFromEspn`. QB sélectionné trouvé par ID ESPN (ou nom si ID absent), sinon premier passeur numérique dans l’ordre ESPN. Aucun calcul de rating ni preuve de zéro snap supplémentaire.
- `scoringOperations.mjs` : lecture privée d’un snapshot complet, contrôles de ronde/calendrier, ESPN uniquement pour IDs numériques, calcul de tous les participants, publication atomique. Pas de résultats partiels : des matchs PRE/LIVE ou un rating QB manquant laissent la ronde en attente. Les scores ESPN peuvent être enregistrés sans publier de classement. Une erreur réseau annule la tentative sans écrire.
- `playoff_round_runs` : une publication par ronde, source privée, date de traitement, classement cumulatif enregistré et date de finalisation.
- `playoff_round_results` : une ligne par joueur/ronde, détail des picks, parcours, QB réellement retenu, consommation, subtotal, score, total et rangs. Une deuxième mise à jour **remplace**, elle n’additionne rien.
- RPC `publish_playoff_scoring` : même verrou de saison que l’infrastructure existante, verrouillage des tables Playoffs, comparaison du snapshot sous verrou, transaction pour tous les joueurs. Une requête concurrente périmée est refusée et doit relire les données.
- Mise à jour → `scored` → vérification humaine → finalisation explicite → `finalized`. La finalisation exige une publication correspondant encore aux sources actuelles. Triggers d’immuabilité pour ronde, matchs, choix et résultats, y compris TRUNCATE. L’ancien RPC de gestion ne peut plus mettre à jour des scores séparément ni finaliser lors du passage.
- Passage après finalisation seulement. `expectedMatchups` n’a pas changé : un seul moteur de reseeding, à partir des seeds originaux finalisés. Les fixtures TEST ne peuvent pas ouvrir une vraie ronde suivante. Le RPC exige également une publication de scoring finalisée : un ancien statut `finalized` seul ne suffit pas.
- `submit_playoff_round` : une soumission JWT authentifiée, atomique et unique, seulement ronde ouverte avant le premier kickoff. Valide gagnants/écarts, QB actif admissible et réellement consommé, reset si tous utilisés, parcours survivant imposé, nouveau parcours après défaite et bye #1. Les écritures directes des utilisateurs sur les trois tables de choix sont retirées pour empêcher un contournement. La lecture/RLS existante des choix est conservée.
- `read_playoff_results` : lecture cohérente d’une publication en une requête, sans la source privée. Les pages utilisent exclusivement cette publication pour QB Ratings, les classements et la progression. Les cartes de classement peuplées reprennent les composants du régulier, copiés sous `/series`; aucun fichier régulier n’est modifié.

## Migration — manuelle, non exécutée à distance

Nouvelle migration : `supabase/migrations/202609290001_playoff_scoring.sql`.

Elle crée deux tables (avec erreurs brutes de ronde/cumulatives et erreur du total SB), la colonne nullable `playoff_qb_picks.super_bowl_total` (entier >= 0), une colonne JSON facultative **réservée aux matchs TEST** (`playoff_games.test_qb_results`), les RPC et protections ci-dessus. Elle remplace uniquement le RPC de gestion Playoffs pour séparer finalisation et passage de ronde. Elle ne crée/modifie aucun match, seed, résultat régulier ou donnée de saison 2026.

Les migrations locales antérieures ont été inspectées. Selon le mandat, `202609250001_playoff_round_admin.sql` est **déjà appliquée manuellement** sur Supabase distant. Elle reste inchangée. L’état du registre distant n’a pas été interrogé dans ce chantier (aucun connecteur Supabase disponible); ne pas le confondre avec la présence réelle des objets. **Ne pas faire `supabase db push`, ne rejouer aucune ancienne migration et ne réparer aveuglément le registre.**

La nouvelle migration est transactionnelle et son rejeu a été testé localement. Le schéma de base des tables de choix n’étant pas versionné dans le dépôt, vérifier d’abord sur la base cible, en lecture seule :

```sql
select table_name,column_name,data_type
from information_schema.columns
where table_schema='public' and table_name in
 ('playoff_rounds','playoff_games','playoff_picks','playoff_qb_picks','playoff_team_paths','qbs','users')
order by table_name,ordinal_position;

select conrelid::regclass,conname,pg_get_constraintdef(oid)
from pg_constraint
where conrelid in ('public.playoff_rounds'::regclass,'public.playoff_games'::regclass);

select to_regprocedure('public.manage_playoff_round(integer,text,text,jsonb,jsonb)');
```

Prérequis testés : IDs de rondes/matchs/QB compatibles bigint, utilisateurs UUID, `qbs.active` et `is_active_starter` booléens, statut de ronde acceptant `scored`, `game_status` déjà installé avec contrainte de scores FINAL. Les colonnes de choix sont celles utilisées par la page existante. Si le schéma réel diffère, **arrêter avant application** et adapter la migration, sans modifier les données de production.

Après vérification et approbation, dans le dépôt, avec une connexion propriétaire PostgreSQL fournie par l’opérateur :

```sh
# PLAYOFFS_DATABASE_URL doit être renseignée de façon privée par l’opérateur.
psql "$PLAYOFFS_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/202609290001_playoff_scoring.sql
```

Alternative : exécuter **uniquement le contenu de ce nouveau fichier** dans le SQL Editor Supabase. Ne pas retirer BEGIN/COMMIT. Aucune commande ci-dessus n’a été exécutée contre Supabase distant.

Vérifications après application, en lecture seule :

```sql
select relname,relrowsecurity from pg_class
where oid in ('public.playoff_round_runs'::regclass,'public.playoff_round_results'::regclass);
select * from pg_policies where tablename in ('playoff_round_runs','playoff_round_results');
select routine_name,grantee,privilege_type from information_schema.routine_privileges
where routine_schema='public' and routine_name in
 ('playoff_scoring_state','publish_playoff_scoring','manage_playoff_round','submit_playoff_round','read_playoff_results');
select table_name,grantee,privilege_type from information_schema.table_privileges
where table_schema='public' and table_name in
 ('playoff_round_runs','playoff_round_results','playoff_picks','playoff_qb_picks','playoff_team_paths');
select column_name,grantee,privilege_type from information_schema.column_privileges
where table_schema='public' and table_name='playoff_round_runs';
```

Attendu : authenticated lit les résultats et les métadonnées de publication mais pas `source`; anon n’a aucun accès aux résultats/RPC. Scoring, snapshot privé et gestion réservés au propriétaire et `service_role`; la route exige en plus JWT valide + `users.is_admin=true`. Soumission réservée à authenticated et liée à `auth.uid()`. Pas de droits d’écriture directs ordinaires. Conserver les politiques de lecture existantes sur les choix.

## Tests et mode TEST sans production

Tous les tests SQL sont **PGlite en mémoire**; ils ne prennent aucune URL Supabase. Les seules données sont des fixtures synthétiques 2099–2102. Le test complet crée 13 matchs TEST via le moteur existant de reseeding, trois joueurs, quatre publications/finalisations; il vérifie les compteurs, DNP, verrouillage des parcours, nouvelles sélections, scores cumulés et nombre de points du graphique. Tout fetch ESPN y provoque un échec du test.

Commandes portables (Node installé) :

```sh
# Dépendance de test isolée hors dépôt; aucune dépendance de l’application ajoutée.
npm install --prefix /tmp/nfl-playoffs-sql --no-save @electric-sql/pglite@0.5.8
PGLITE_MODULE=/tmp/nfl-playoffs-sql/node_modules/@electric-sql/pglite/dist/index.js \
  node --test lib/playoffs/*.test.mjs lib/notifications/*.test.mjs supabase/tests/*.test.mjs \
  app/series/components/*/*.test.mjs app/admin/playoffs/*.test.mjs
npm run build
```

Pour cibler le cycle complet seulement, garder `supabase/tests/playoff_scoring.test.mjs`. Sans `PGLITE_MODULE`, Node signale les tests SQL comme **skipped**, ce qui n’est pas une validation SQL.

Pour un test visuel, utiliser une **base de développement isolée** avec des utilisateurs de test et des matchs `TEST-*`; ne pas réutiliser les vrais matchs. `game_status='post'` et deux scores complets distincts sont obligatoires. La colonne `test_qb_results` accepte la liste des passeurs avec un rating numérique, dans leur ordre ESPN, par exemple :

```json
[
  {"id":"20","name":"Remplaçant","team":"Équipe locale","rating":112.5}
]
```

Les IDs doivent correspondre au référentiel QB de **cette base de test**. Les TEST ne sont jamais rafraîchis par ESPN, même lors d’un recalcul. Aucun nouveau formulaire Admin technique n’est ajouté. Le fixture `scoringFixtures.mjs` fournit la saison synthétique complète; son insertion automatique n’existe que dans le test SQL local. Les vrais passages de ronde exigent toujours des matchs ESPN officiels et des seeds finalisés : pas de contournement par TEST.

## Limites et choix explicites

- **DNP/fallback** : comme le régulier, l’absence du QB sélectionné de la liste des passeurs numériques déclenche le premier passeur. Ce n’est pas une preuve de zéro snap : cette exigence a été retirée sur décision explicite. QB sélectionné présent (même après remplacement, même rating zéro) = consommé; fallback = ni lui ni le remplaçant consommés. Sans aucun rating numérique, publication bloquée. La validation FINAL et la plage 0–158,3 restent les contrôles de stockage Playoffs. Le test de parité exécute le bloc réel du fichier Admin régulier, inchangé.
- La publication des classements attend toute la ronde et toutes les soumissions concernées; un joueur partiellement soumis bloque le calcul plutôt que de recevoir un zéro inventé. Les données historiques partielles nécessitent une correction explicite, pas une réparation silencieuse.
- Un joueur sans soumission conserve son total/rang cumulatif à la publication suivante; il n’obtient aucun faux résultat QB ou score de ronde. Un parcours avec un trou dans les rondes du joueur est refusé : règle de reprise après absence à définir, pas inventée ici.
- Classement cumulatif : score décroissant, puis somme des `abs(predicted_spread - abs(home_score-away_score))` croissante, puis erreur absolue du total Super Bowl croissante. Aucune multiplication des erreurs. Égalité parfaite = rang partagé de compétition (1,2,2,4); UUID pour l’ordre visuel seulement. Rang de ronde : score seul, mêmes rangs partagés. Avant le SB, aucune erreur de total inventée.
- Total SB : champ exclusivement au Super Bowl, entier 0–2147483647 (limite du stockage PostgreSQL), enregistré avec QB/parcours/picks dans le même RPC transactionnel à cinq paramètres. Le résultat QB, son rating et sa consommation ne changent jamais cette prédiction; même un rating zéro conserve le tie-break. Aucun point supplémentaire. Les colonnes d’erreur dans les résultats et les standings JSON sont enregistrées à chaque publication.
- Une bye stocke zéro match joué et zéro multiplicateur **appliqué au scoring**; le choix affiche ×1 comme premier multiplicateur futur, sans incrémenter son compteur.
- QB Ratings regroupe le QB **réellement retenu pour le résultat**, une seule observation par match même si plusieurs joueurs l’ont choisi. Un fallback apparaît dans l’historique, mais ne consomme aucun des deux QB.
- Un changement direct des sources avant finalisation rend la publication périmée : recalcul requis. Des anciennes rondes déjà `finalized` sans publication ne sont pas transformées en résultats; elles nécessitent une décision de migration explicite.
- Le build local utilise des clés factices et ne prouve pas l’intégration au projet Supabase distant. Cette dernière attend l’application manuelle contrôlée de la migration. Aucun déploiement, activation globale, finalisation de seeds 2026 ou merge main n’est effectué.

## Migration complémentaire des rappels

Appliquer ensuite seulement `202609300001_notification_reminders.sql`, après le contrôle du schéma de la file push existante. Procédure, configuration, garanties et limites dans `lib/notifications/REMINDERS.md`. Les deux fichiers sont non appliqués à distance. La version précédente de la migration scoring ne doit pas être installée : utiliser la version finale de ce commit sur une base où elle n’a jamais été appliquée.
