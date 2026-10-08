# Fin du lifecycle et isolation régulière multi-saison

Migration unique : `supabase/migrations/202610090001_lifecycle_completion.sql`.
Ne pas rejouer les migrations précédentes. Aucun déploiement/migration distante
ni transition réelle n'a été effectué pour cette livraison.

## Avant installation : validation propriétaire obligatoire des participants 2026

Il n'existe pas de liste canonique historique dans le schéma actuel. La migration
reprend uniquement les utilisateurs ayant un pick sur un match 2026, un choix QB
régulier ou un score hebdomadaire. Les deux dernières tables sont attribuées à
2026 selon la décision du propriétaire. Elle ne reprend jamais tous les comptes.

La liste exacte réelle doit être validée par le propriétaire AVANT installation.
Requête de lecture seule à exécuter manuellement sur le schéma actuel :

```sql
with evidence as (
 select p.user_id,'pick 2026' source
 from public.picks p join public.games g on g.id=p.game_id where g.season=2026
 union select user_id,'choix QB' from public.qb_picks
 union select user_id,'score hebdomadaire' from public.weekly_scores
), observed_order as (
 select user_id,created_at,
 row_number() over(order by created_at,id) initial_order
 from public.qb_picks where week=1
)
select u.id,u.real_name,u.display_name,
 (count(e.source)>0) as proposed_participant_2026,
 array_agg(distinct e.source) filter(where e.source is not null) as evidence,
 o.initial_order,o.created_at as week_one_submission
from public.users u
left join evidence e on e.user_id=u.id
left join observed_order o on o.user_id=u.id
group by u.id,u.real_name,u.display_name,o.initial_order,o.created_at
order by proposed_participant_2026 desc,o.initial_order nulls last,u.id;
```

L'ordre 2026 reprend la chronologie observée des soumissions de semaine 1, pas
une liste de noms. L'absence d'une soumission laisse l'ordre NULL. Les égalités de
timestamp doivent être vérifiées dans cette liste (l'id stabilise seulement le tri).
Un participant réel absent de toutes ces preuves doit être signalé pour ajuster
explicitement le backfill avant installation, pas deviné depuis tous les users.

Installation manuelle uniquement après cette confirmation et la revue SQL :
ouvrir le fichier complet de migration, copier son contenu exact dans SQL Editor,
et exécuter une seule fois. Le fichier contient BEGIN/COMMIT. Il ne change aucun
champ settings à l'installation, ne finalise rien et ne prépare aucune saison.

La mise en production du code doit être coordonnée avec la migration : les anciens
clients n'envoient pas `season` et utilisent les anciennes clés ON CONFLICT. Après
installation, ils doivent être rechargés sur la nouvelle version. Ce changement
n'est pas compatible avec une période prolongée où l'ancien code reste actif.
Aucun défaut implicite vers la saison active n'est utilisé pour masquer un client
périmé : ses écritures sont refusées plutôt qu'attribuées à une nouvelle saison.

## Modèle et droits

- `seasons` : saison préparée, participants confirmés, démarrée, terminée.
  L'entrée 2026 est marquée comme déjà démarrée lors du backfill (ce timestamp
  n'est pas une reconstruction de la date historique de lancement).
- `season_participants` : `(season,user_id)`, confirmation, ordre initial unique.
  Les comptes users sont conservés, qu'ils participent ou non.
- Saison 2026 ajoutée aux cinq tables hebdomadaires, puis colonne obligatoire sans
  défaut. Index uniques composites incluant season. Picks déduit sa saison de games.
- Nouvelles tables : RLS, lecture authenticated/service_role, aucune écriture directe
  pour ces rôles. RPC `manage_season_lifecycle(text,integer,bigint,uuid,jsonb)` :
  SECURITY DEFINER, search_path vide, EXECUTE service_role/propriétaire uniquement.
  L'API vérifie le token et is_admin; SQL revérifie l'acteur, la phase et revision.
- Triggers `lifecycle_regular_write` (par ligne) et `lifecycle_regular_truncate`
  sur les sept tables régulières. Saison historique immuable; non-participant refusé.
  Guard invoker : seules les insertions de calendrier futur effectuées par la RPC
  propriétaire sont autorisées en offseason. Aucun élargissement des droits qbs.
  Les verrous de table des transitions excluent les écritures régulières simultanées;
  la lecture simple de settings n'exige pas la policy UPDATE réservée aux Admins.
- Trigger `regular_notification_season` sur la queue : saison active et membre
  confirmé obligatoires pour les événements réguliers. Guards Playoffs conservés.
- Le guard settings permet le reset de semaine seulement à l'opération privilégiée.
  Les actions modifiantes invalident les confirmations Admin périmées via revision.

Les définitions SQL exactes des triggers/fonctions sont toutes dans la migration.

## Opérations et interface

`manage_season_lifecycle` réutilise les finalisations et verrous existants; toute
exception annule l'opération SQL entière. Pas de réseau dans la transaction.

- **finish** : saison active Playoffs, quatre rondes/13 vrais matchs terminés,
  publication canonique du Super Bowl, finalisation existante si scored, toutes
  rondes finalisées avec leurs runs, puis offseason. Aucun résultat effacé.
- **prepare** : offseason, saison active + 1 seulement. Le serveur parcourt le
  calendrier ESPN complet et revalide ses index; date future, équipes locales et
  WSH → WAS vérifiés. SQL refuse un calendrier existant, importe les matchs sans
  scores et sans participants. Les horaires de semaine 1 doivent être confirmés;
  les dates ESPN des semaines ultérieures peuvent encore être prévisionnelles,
  comme dans l'import régulier existant (aucune date n'est inventée). La règle régulière existante excluant les matchs du
  dimanche de 12 h à 18 h 59 est conservée (heure de Toronto), y compris en SQL.
  settings.current_season reste inchangé.
- **participants** : saison préparée non démarrée. Liste explicite de comptes et
  ordre continu 1..N; édition indépendante du calendrier. Un ancien joueur peut
  être absent puis revenir. Reprendre la liste précédente ne fait qu'un brouillon
  local jusqu'à confirmation explicite.
- **start** : calendrier exploitable non commencé, participants confirmés et ordre
  complet. Atomiquement nouvelle saison, semaine 1, phase regular, suppression du
  marqueur de clôture régulière courant et initialisation de l'horloge de sélection.
  Pas de suppression des données de la saison précédente.

Dans l'Admin Séries : « METTRE FIN AUX SÉRIES » remplace la finalisation séparée
du Super Bowl. Dans /admin en offseason : préparation, participants/ordre, démarrage,
avec confirmations. Le démarrage reste désactivé si le serveur constate un prérequis
absent ou si la liste affichée a été modifiée sans reconfirmation.
Les six routes publiques normales affichent la même page offseason simple.
Les routes /series restent des accès explicites, pas l'interface publique principale.

## Lecteurs, scoring régulier et notifications

`regularClient` est un adaptateur restreint aux anciennes requêtes régulières :
saison fixée pendant la vie de la page/requête, filtres de saison, picks par games,
participants confirmés à la place des listes de comptes, clés d'upsert composites.
Les requêtes de profil et de gestion des mots de passe restent liées aux comptes.
Les calculs sportifs existants ne changent pas; ils reçoivent des entrées isolées.
Les trois fonctions de publication finale régulière sont réémises avec cette
isolation, y compris les contrôles SQL indépendants et les résultats persistés.

Les réservations de notification 2026 conservent leurs clés historiques pour éviter
un renvoi après migration. Les autres années ont un préfixe `season-AAAA-`; la queue
porte aussi season. Claim, worker et transport revérifient le contexte et le membre.
Un ancien événement 2026 ne peut pas être envoyé comme un événement 2027.
Ni le cron ni POOL_REMINDERS_ENABLED ni playoff_reminders_enabled ne sont activés.

## Validation locale

Tests PostgreSQL en mémoire avec le schéma audité et les migrations précédentes :
clôture réelle des quatre rondes synthétiques, rollback après finalisation, préparation
sans participants, ordre invalide, rollback pendant start, deux semaines 1, historique
protégé, véritable rôle authenticated non-admin, réservations interannuelles et
publication 2027 en présence des picks/ratings 2026.
Tests JS : lecteurs/upserts/participants/ordre, calendrier ESPN simulé, API Admin,
transport sans envoi pour ancien événement ou non-participant, routes publiques
regular/playoffs/offseason. Aucun appel réel à Supabase ou ESPN dans ces tests.

Limites assumées : aucune archive publique navigable ajoutée; aucun import de matchs
avant la publication d'un calendrier ESPN complet et futur; l'import est un
snapshot, sans nouveau mécanisme de suivi des reprogrammations/flex NFL; aucune transition réelle
validée en production. L'export réel des participants 2026 reste à confirmer.

Résultat final local : 78 tests ciblés PASS; 405 tests complets PASS; 0 échec,
0 ignoré; `npm run build` PASS (valeurs d'environnement de test, cache npm local).
Revue finale ciblée : aucun P0/P1/P2 nécessitant correction identifié. Migration
non appliquée à distance. La validation propriétaire des participants 2026 reste
nécessaire avant installation.
