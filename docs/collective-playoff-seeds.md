# Fondation du seeding playoffs — snapshot provisoire 2026

Statut : schéma approuvé et migration appliquée au projet pool-nfl le 24 septembre 2026 via l’éditeur SQL. Ne pas réexécuter cette migration sur ce projet.
Une seule synchronisation PROVISOIRE 2026 a été exécutée, sans finalisation.

## Source ESPN et réutilisation

URL existante :
https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?seasontype=2&type=0&level=3

L'appel est extrait de `app/admin/page.js` dans `lib/espnStandings.mjs`.
L'import division existant garde son URL, son parsing et ses écritures inchangés.
Le backend seeds réutilise le helper avec `&season=2026` et sans cache.
La saison retournée doit correspondre exactement à la saison demandée.

Structure réelle observée : `season.year = 2026`; `children[]` contient les
conférences avec `abbreviation = AFC/NFC`; leurs enfants sont les divisions;
`standings.entries[]` fournit `team.id`, `team.abbreviation`, `team.name`, puis
`stats[]` contient `{ name: "playoffSeed", value: 2 }`, par exemple.
Le helper hérite de la conférence et utilise uniquement playoffSeed, jamais
l'index des équipes ni un recalcul de tiebreakers.

La vérification en lecture seule a extrait 14 équipes / seeds 1–7 AFC et NFC.
Ce sont les standings PROVISOIRES de septembre, pas les qualifiés définitifs.
Le rapprochement avec le référentiel réel Supabase `teams` a été vérifié : 14/14 identités, conférences et seeds correspondent exactement à la réponse ESPN utilisée. WSH → WAS → Commanders confirmé (hors des 14 seeds de cette capture).
La correspondance de production exige une unique `teams.espn_abbr`, avec
l'alias WSH→WAS déjà employé dans l'Admin. Aucun matching approximatif de noms.

## Schéma exact proposé

Migration : `supabase/migrations/202609240001_playoff_seeds.sql`.
Aucune convention de migrations préexistante dans le dépôt; nouveau répertoire
Supabase standard. L’absence de table/RPC équivalentes a été vérifiée avant application; les contraintes, indexes, triggers et permissions distants ont été contrôlés après migration.

`public.playoff_seeds` :

| Colonne | Type | Contraintes / défaut |
|---|---|---|
| id | uuid | PK, gen_random_uuid() |
| season | integer | NOT NULL, 2000–9999 |
| team | text | NOT NULL, nom local canonique, non vide et sans espaces aux extrémités |
| espn_team_id | text | NOT NULL, chiffres uniquement |
| conference | text | NOT NULL, AFC ou NFC |
| seed | smallint | NOT NULL, 1–7 |
| captured_at | timestamptz | NOT NULL, capture commune générée par le backend SQL |
| finalized_at | timestamptz | NULL pour brouillon; sinon date commune ≥ captured_at |
| created_at | timestamptz | NOT NULL, now() |
| updated_at | timestamptz | NOT NULL, now(), actualisé par trigger |

Pas de FK imposée : le type de PK et l'unicité réelle du référentiel `teams`
ne sont pas versionnés. Le backend valide l'identité par l'abréviation ESPN,
puis conserve le nom canonique local et l'identifiant ESPN durable.

Contraintes uniques / indexes correspondants :
- PK id;
- (season, conference, seed);
- (season, team);
- (season, espn_team_id);
- index unique (season, lower(team)) contre les doublons de casse.
Tous les indexes métier commencent par season; pas d'index season redondant.

## RLS / autorisation

RLS activée. SELECT autorisé à authenticated, aucun accès anon.
Aucune politique INSERT/UPDATE/DELETE pour les utilisateurs.
Le rôle service_role peut lire, mais n'a pas d'écriture directe sur la table.
Seules les RPC `sync_playoff_seeds` et `finalize_playoff_seeds` sont exécutables
par service_role. Droits PUBLIC/anon/authenticated sur ces RPC révoqués.
Fonctions SECURITY DEFINER, search_path vide, objets de table qualifiés.

`POST /api/admin/playoff-seeds` vérifie le Bearer via Supabase Auth puis
`users.is_admin === true`, comme `/api/admin/reset-password`.
La clé service_role demeure dans cette route serveur. La sécurité de la
colonne users.is_admin dépend des protections existantes du projet, inchangées.

## Brouillon / synchronisation

Corps d'appel futur : `{ "action": "sync", "season": 2026 }`.
Le helper backend `syncPlayoffSeedsFromEspn` lit le snapshot, refuse un snapshot
finalisé, interroge ESPN, résout les équipes locales et valide 14 lignes uniques.
Les seeds >7 sont exclus. Une donnée manquante, ambiguë, incohérente ou une
réponse d'une autre saison annule l'opération avant toute écriture.

La RPC répète la validation en SQL et verrouille la saison avec un advisory
transaction lock. Elle remplace les 14 lignes brouillon en une transaction,
plutôt que 14 upserts indépendants : cela permet les échanges de seeds sans
collision avec les contraintes uniques. Les IDs/created_at du brouillon sont
renouvelés; aucune autre table ne les référence. captured_at est identique sur
les 14 lignes. Les lecteurs ne voient jamais de snapshot partiel.
Pas de cron, synchronisation automatique, appel public ESPN ou création de
playoff_games dans ce mandat.

## Finalisation

Lire d'abord via `{ "action": "read", "season": 2026 }`.
Après vérification humaine de la fin de saison régulière et de la qualification :
`{ "action": "finalize", "season": 2026, "expectedCapturedAt": "date exacte lue",
   "regularSeasonComplete": true }`.

La confirmation est une attestation Admin explicite, pas une déduction du
calendrier ni du simple fait qu'ESPN fournit déjà 14 seeds. Ne pas finaliser les
standings de septembre. Aucune action finale exécutée par cette passe.

La RPC reprend le même verrou de saison, exige 14 lignes (7 AFC + 7 NFC), une
capture toujours identique à celle revue, puis fixe finalized_at sur l'ensemble.
Les contraintes uniques et domaines garantissent exactement les seeds 1–7.
Une resynchronisation entre lecture et finalisation fait refuser la confirmation.
Triggers : refus des UPDATE/DELETE de lignes finalisées, refus d'ajout à une
saison finalisée, validation différée d'un ensemble final complet et uniforme.
Une nouvelle synchronisation ESPN ne peut plus modifier la saison finalisée.
Comme toute protection SQL, un propriétaire de base capable de supprimer les
triggers n'est pas traité comme un utilisateur ordinaire par cette protection.

## Intégration collective

Le loader lit playoff_seeds pour la saison consultée; le mapper fournit
`{ season, frozen: true, teams: [{team, conference, seed}] }` uniquement si les
14 lignes sont valides et uniformément finalisées. Brouillons ignorés pour la
progression publique : aucun bye provisoire issu des standings courants.
Une absence de table pendant le déploiement gradué produit un avertissement,
pas une page cassée. Seuls 42P01/PGRST205 sont tolérés; autres erreurs propagées.

Une seule prop transmet le snapshot à CollectiveView. collectiveProgression.mjs
reste intégralement inchangé : bye #1 sans match, original seeds, reseeding,
priorité des vrais playoff_games et adversaires inconnus sont conservés.
Le helper dérivé wildCardSeeds expose #2/#7, #3/#6, #4/#5 et les deux byes, sans
persistance ni création de matchs officiels. Aucun multiplicateur modifié.

## Validation locale

- 40 tests réussis, incluant la suite collective et personnelle existante.
- Extraction ESPN, références de saison, doublons/absence/ambiguïté, drafts,
  snapshots finaux, WC, byes et reseeding couverts.
- SQL réellement exécuté dans PGlite (PostgreSQL WASM isolé, aucune URL distante).
  Tests de rôles/RLS, RPC, échanges de seeds, rollback, capture périmée et gel.
  La concurrence intersessions n'est pas simulée par PGlite; le verrou est dans
  les deux RPC et le trigger. Vérification multi-session recommandée en staging.
- PGlite installé uniquement dans le dossier de travail externe au dépôt.
  Aucune dépendance applicative ni lockfile modifié.
- Commande tests : `PGLITE_MODULE=/chemin/temporaire/node_modules/@electric-sql/pglite/dist/index.js node --test lib/playoffs/*.test.mjs app/series/components/playoff-tree/*.test.mjs supabase/tests/*.test.mjs`.
- npm run build réussi : 22 routes; variables Supabase/VAPID locales de
  substitution. Avertissements de cache non bloquants.

## Fichiers

Créés : lib/espnStandings.mjs; lib/playoffs/seeds.mjs;
lib/playoffs/seedOperations.mjs; lib/playoffs/seeds.test.mjs;
app/api/admin/playoff-seeds/route.js;
supabase/migrations/202609240001_playoff_seeds.sql;
supabase/tests/playoff_seeds.test.mjs.

Modifiés : app/admin/page.js (appel partagé seulement);
app/series/components/playoff-tree/collectiveData.mjs;
app/series/components/playoff-tree/collectiveData.test.mjs;
app/series/components/playoff-tree/CollectivePlayoffTree.js (prop seulement);
docs/collective-playoff-seeds.md.

Aucun changement du design, de la saison régulière utilisateur, du scoring,
des règles QB, des notifications, de BottomNav, de PersonalPlayoffTree,
de /series/matchs, du moteur de progression ou de main.
## Vérification distante et reprise après interruption

Avant reprise : lecture des lignes 2026 = []; aucune double synchronisation.
Le helper syncPlayoffSeedsFromEspn avait préparé la requête avec ESPN et les
32 équipes lues dans Supabase. Cette requête RPC a été exécutée une seule fois
via l’éditeur SQL authentifié, avec SET LOCAL ROLE service_role. Aucun secret
service_role extrait; aucune route Admin déployée pour cette opération.

Capture commune : 2026-09-24T13:38:29.777255+00:00.
14 lignes : 7 AFC + 7 NFC, seeds 1–7 uniques, finalized_at NULL sur les 14.
AFC : Chiefs, Bills, Bengals, Jaguars, Raiders, Patriots, Ravens.
NFC : Vikings, Seahawks, Eagles, Panthers, 49ers, Lions, Bears.
Ces équipes représentent les standings provisoires, pas les qualifiés définitifs.

RLS activée; policy SELECT authenticated seulement. Contrôles effectifs :
- anon : aucun SELECT/INSERT/UPDATE/DELETE/TRUNCATE, aucune RPC;
- authenticated : SELECT seulement, aucune RPC;
- service_role : SELECT et exécution des deux RPC, aucune écriture directe;
- ACL exactes RPC : postgres et service_role uniquement; SECURITY DEFINER,
  search_path vide. Aucun appel distant à finalize_playoff_seeds.
Tests réels sous rôle authenticated : lecture réussie et UPDATE/DELETE refusés;
sous anon : lecture refusée. Aucun changement de données pendant ces tests.

La migration a réussi avant l’interruption. La première tentative d’exécution
de la synchronisation a été bloquée par la limite d’utilisation du contrôle
d’autorisation; aucune requête n’a été exécutée à ce moment. Après reprise,
l’unique synchronisation a réussi. Aucun échec SQL.

Le mapper public retourne undefined pour ce snapshot réel provisoire : aucun
bye public activé. playoff_games reste à 3 lignes, scoring inchangé.
Validation locale de reprise : 33 tests JavaScript réussis, npm run build réussi
(22 routes). Les tests SQL locaux avaient déjà réussi au checkpoint; ils n’ont
pas été relancés avec finalisation pendant cette opération distante.
