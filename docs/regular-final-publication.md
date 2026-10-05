# Étape 2A — publication finale régulière contrôlée

Branche : `feature/regular-final-publication`.
Base : `f7a10e0779da927b8b636350f1339485b0de9612`.
La migration est proposée pour revue seulement. Aucun accès Supabase distant,
aucune installation distante, aucun changement de phase ou activation.

## Architecture et utilisation future

`POST /api/admin/regular-final-publication` exige un Bearer Supabase valide,
un profil `users.is_admin = true` vérifié côté serveur et le corps :

```json
{"confirm": true, "season": 2026, "revision": 0}
```

Ces valeurs illustratives doivent correspondre exactement au contexte global
lu au moment de l'action. Elles ne constituent jamais une preuve. Aucun résultat
ni booléen de certification provenant du navigateur n'est utilisé.
Le serveur relit `settings`, obtient un snapshot SQL complet, prépare les preuves
ESPN hors transaction puis appelle une seule RPC de publication atomique.
Ne pas appeler cette action maintenant : ce document ne demande aucune publication réelle.

Aucun bouton « Passer en Séries » ni changement de l'Admin existant.
L'intégration minimale est cette action serveur explicite, indépendante de
`fullUpdate`. Sa future présentation dans l'Admin est hors de cette étape.
La publication laisse `phase = regular`, `regular_finalized_at = NULL` et la
révision inchangés. Les opérations ordinaires restent possibles et peuvent
invalider la preuve : publication n'est pas fermeture.

## Définition de calendrier complet, version 1

Pour `settings.current_season`, lecture de trois sources ESPN :

- index paginé Core `/seasons/{season}/types/2/weeks` ;
- index paginé Core `/seasons/{season}/types/2/events` ;
- index paginé des événements de chaque semaine, puis scoreboard Site correspondant.

Les URL de base sont `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl`
et `https://site.api.espn.com/apis/site/v2/sports/football/nfl`.
Chaque pagination est parcourue entièrement : count, pageCount, pageIndex,
pageSize et nombre d'éléments doivent concorder. Les références sont validées
mais jamais utilisées comme URL réseau arbitraire.
L'union sans doublons des événements hebdomadaires doit être exactement l'index
saisonnier. Chaque scoreboard doit être exactement son index hebdomadaire.
Les deux index globaux sont relus à la fin pour détecter leur changement.
Les identifiants des `games` locaux de la saison doivent correspondre exactement
à cet ensemble ; semaine, saison, type et noms des équipes doivent concorder.
Tous les matchs réguliers sont contrôlés, même sans pick.
Le rapprochement des équipes utilise `teams.espn_abbr`, avec WSH → WAS.

Aucun seuil 18 semaines / 272 matchs, aucune date, aucun MAX(season), aucune
inférence à partir de current_week. Le fournisseur reste l'autorité : une omission
cohérente simultanée de tous ses index n'est pas détectable par une seconde source
indépendante. Ce n'est pas une garantie cryptographique de la NFL.
Le contrat public a été inspecté en lecture seule sur 2025 (index globaux,
semaine 18 et résumé 401772969) ; aucune certification de 2026 n'a été effectuée.

## Matchs et ratings finaux

Pour les événements et compétitions : `name = STATUS_FINAL`, `state = post`,
`completed = true`, deux équipes identifiées, scores entiers présents et positifs
ou nuls. Un statut annulé, incomplet ou ambigu est refusé.
Les scores locaux absents ou incorrects sont corrigés de façon contrôlée à partir
de cette preuve pendant la transaction, pas avant.

Pour chaque couple joueur/semaine ayant des picks, un QB choisi est obligatoire.
Son équipe doit identifier un seul match et un seul côté de ce match.
Le résumé ESPN doit être FINAL, de la même saison/type/ID, avec les mêmes équipes
et scores que le calendrier. La catégorie passing de cette équipe doit fournir
un rating RTG/RAT/RATE numérique fini entre 0 et 158,3.
Une statistique vide, absente ou intermédiaire bloque la publication.

La sélection du passeur réutilise `selectRegularPasser` : identifiant ESPN du QB
choisi, sinon recherche du nom si aucun identifiant n'existe, sinon premier passeur
numérique selon l'ordre régulier. Le rating est enregistré sous le QB CHOISI,
avec le nom et l'ID ESPN du passeur réel. Aucune insertion dans `qbs`, aucun
élargissement de permissions. Ce mécanisme n'introduit aucune nouvelle règle DNP.
Les passers et le passeur retenu sont conservés dans la preuve ; SQL revérifie le choix.

## Recalcul et vérification persistante

Même règle régulière : gagnant = 1 point, gagnant avec écart exact = 2,
perdant/égalité = 0. Pour chaque joueur/semaine ayant des picks : rating / 100,
multiplier arrondi à 3 décimales, score calculé avec le multiplicateur non arrondi
puis arrondi à 3 décimales. JavaScript prépare et SQL recalcule indépendamment ;
un désaccord fait échouer toute la publication.

**Distinction explicite :** un vrai rating numérique **0** conserve la règle
régulière actuelle `multiplier = 1`. Un rating manquant n'utilise JAMAIS cette
règle : la publication est refusée. Modifier le traitement sportif du zéro
serait une autre décision produit.

Les games, qb_ratings et weekly_scores publiés sont tous relus/rapprochés avant
l'attestation. Un trigger qui altérerait ces valeurs provoque un rollback.
Des weekly_scores sans clé joueur/semaine recalculée sont refusés plutôt que
supprimés. Aucun nettoyage destructif des anciens résultats.

## Migration et attestation exactes

Nouvelle migration : `202610050001_regular_final_publication.sql`.
Précondition : fondation `202610040001_lifecycle_foundation.sql` déjà installée.
Ne pas rejouer/modifier cette fondation. Nouvelle migration non installée à distance.

Une table `regular_final_publications` (RLS activée) :

| Colonne | Type / rôle |
| --- | --- |
| season | integer PRIMARY KEY |
| version | integer NOT NULL, CHECK = 1 |
| lifecycle_revision | bigint NOT NULL |
| published_at | timestamptz NOT NULL, clock_timestamp() |
| published_by | uuid NOT NULL, administrateur vérifié |
| request | jsonb NOT NULL, snapshot avant écriture + preuve |
| evidence | jsonb NOT NULL, calendrier, matchs, passers, ratings, résultats |
| source | jsonb NOT NULL, identité canonique après écriture |
| results | jsonb NOT NULL, scores recalculés en SQL |

Trois fonctions SECURITY DEFINER, search_path vide, EXECUTE uniquement service_role
(et propriétaire PostgreSQL) :

- `regular_publication_state(integer) RETURNS jsonb` ;
- `regular_final_publication_valid(integer,bigint) RETURNS boolean` ;
- `publish_regular_final(integer,bigint,uuid,jsonb,jsonb) RETURNS jsonb`.

Aucun trigger ajouté. Aucun UPDATE de données à l'installation. Aucun cron,
aucune policy sur les anciennes tables, aucun changement des grants `qbs`.
La table n'a aucune policy client : ni anon ni authenticated n'y ont accès.
service_role peut SELECT, mais ne peut pas directement INSERT/UPDATE/DELETE/TRUNCATE.
Les opérations privilégiées passent par la RPC, qui revérifie le véritable Admin.
Le propriétaire SQL reste une autorité de confiance, comme les autres migrations.

## Identité et invalidation

Identité déterministe JSONB, versionnée, tableaux ordonnés par identifiants :
settings complet, games de la saison, toutes les lignes picks / qb_picks /
qb_ratings / weekly_scores ; qbs(id,name,team,espn_athlete_id),
teams(id,name,espn_abbr) et identifiants users.
L'égalité avec le snapshot APRÈS publication et la révision lifecycle constituent
la preuve de validité. Pas de booléen navigateur ni hash cryptographique inventé.

Une modification pertinente de ces valeurs, insertion ou suppression, rend
`regular_final_publication_valid` faux. Une modification purement visuelle hors
projection (logo, nom affiché du joueur) ne change pas le calcul.
Une modification annulée puis remise exactement à sa valeur attestée retrouve
la même identité : ce n'est pas un journal historique des mutations.
Une correction ESPN ultérieure non importée ne peut être détectée localement ;
une nouvelle publication contrôlée revalide les sources externes.

La future transition devra acquérir les mêmes verrous sur toutes les tables
sources, puis le verrou lifecycle, et appeler ce validateur **dans sa transaction**,
avant fermeture. Lire ce booléen dans le navigateur ou hors transaction ne suffira
jamais. La transition elle-même n'est pas implémentée.

## Atomicité, concurrence, répétition

Préparation réseau sans transaction SQL longue (quatre lectures simultanées
maximum, résumés partagés entre QB du même match).
La RPC verrouille toutes les tables sources en SHARE ROW EXCLUSIVE, puis appelle
`lock_regular_lifecycle` pour le verrou settings et les contrôles existants.
L'ordre respecte celui des écritures régulières qui verrouillent leur table
avant le guard settings FOR SHARE. Aucun bypass service_role du guard.
L'état courant doit correspondre au snapshot préparé : une mutation concurrente
fait échouer la publication et exige une nouvelle préparation.

Une seule transaction PostgreSQL effectue recalcul, écritures, vérifications et
attestation. Toute erreur annule cette partie intégralement. Deux publications
sont sérialisées par les verrous ; une répétition de la même preuve encore valide
renvoie `already_published: true`, sans changer published_at, y compris après
une nouvelle lecture du snapshot. Une preuve périmée n'est jamais réacceptée
sur la seule base de son ancienne présence.

## Validation locale et limites

231 tests réussis, 0 échec, 0 ignoré : toutes les suites existantes et 45 nouveaux
tests/sous-tests. PGlite exécute réellement la migration et les RPC dans une base
éphémère sans connexion distante, avec fixture issue des deux audits SQL fournis.
Couverture : calendrier complet/partiel/dupliqué, saison/semaine/type erronés,
FINAL/annulé/live, rating absent, remplacement, zéro réel, recalcul, RLS/grants,
route Admin, orchestration, mauvaise révision, fermeture, rollback tardif,
altération des valeurs persistées, idempotence et invalidation par table source.
Les suites régulières, lifecycle, notifications et Séries restent incluses.

Commande locale utilisée (avec PGLITE_MODULE pointant vers PGlite local) :
`node --test $(rg --files app lib supabase -g '*.test.mjs')`.
Build : `npm run build`, variables Supabase factices et VAPID éphémères ; pas
les identifiants ni données de production.

Limites à connaître avant exploitation :

- Les tables historiques QB/weekly_scores n'ont pas de saison. Les picks hors
  saison active et résultats hebdomadaires sans attribution sont refusés. Ce
  chantier n'est pas un archivage/migration multisaison et ne déduit pas l'origine
  historique d'un choix QB sans colonne saison.
- QB transféré/renommé, équipe ambiguë, match annulé ou changement du contrat ESPN :
  refus, pas de rapprochement ni de rating inventé.
- Pas de publication réelle ni de mesure du temps d'une saison complète en Preview.
  La route a un budget d'exécution de 60 s ; un timeout de préparation ne publie
  rien. Si la réponse se perd après commit, revalidation/idempotence permettent
  de retrouver le résultat. Un traitement asynchrone durable n'est pas ajouté ici.
- PGlite ne simule pas des connexions PostgreSQL réseau concurrentes : les verrous
  sont réels mais leur contention multi-session devra être validée séparément.
- Le calendrier complet signifie complet selon les index ESPN rapprochés à cette
  publication ; ESPN ne fournit pas une preuve signée d'absence de correction future.
- Pas de bouton Admin supplémentaire ni de transition vers playoffs dans cette étape.

Aucune opération Supabase distante, aucun db push, aucune migration distante
appliquée, aucune phase changée, aucune seed finalisée, aucune ronde ouverte,
aucun rappel activé, aucun merge main.
