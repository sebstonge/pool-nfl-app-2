# Fin du lifecycle et isolation régulière multi-saison

Migration unique : `supabase/migrations/202610090001_lifecycle_completion.sql`.
Ne pas rejouer les migrations précédentes. Aucun déploiement/migration distante
ni transition réelle n'a été effectué pour cette livraison.

## Participants 2026 approuvés par le propriétaire

Il n'existe pas de liste canonique historique dans le schéma actuel. La migration
reprend uniquement les utilisateurs ayant un pick sur un match 2026, un choix QB
régulier ou un score hebdomadaire. Les deux dernières tables sont attribuées à
2026 selon la décision du propriétaire. Elle ne reprend jamais tous les comptes.

Le propriétaire a confirmé les 13 utilisateurs, chacun avec les trois preuves
et un ordre unique de 1 à 13. Cette validation est acquise.
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

Installation manuelle uniquement après le bootstrap maintenance décrit ci-dessous :
ouvrir le fichier complet de migration, copier son contenu exact dans SQL Editor,
et exécuter une seule fois. Le fichier contient BEGIN/COMMIT. Il conserve le flag de maintenance déjà activé, ne finalise rien et ne prépare
aucune saison. Sans bootstrap actif, la migration principale refuse de s'installer.

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
validée en production. Les participants 2026 ont été confirmés par le propriétaire.

Résultat final local : 78 tests ciblés PASS; 405 tests complets PASS; 0 échec,
0 ignoré; `npm run build` PASS (valeurs d'environnement de test, cache npm local).
Revue finale ciblée : aucun P0/P1/P2 nécessitant correction identifié. Migration
non appliquée à distance. La validation propriétaire des participants 2026 est acquise.


## Maintenance coordonnée des écritures (correctif final)

Aucune deuxième migration. Le bootstrap ci-dessous est le préambule idempotent
exact de la migration principale, suivi de l'activation. Il est exécuté MANUELLEMENT
avant elle. Il n'effectue aucune transformation des choix/scores et n'exécute
aucune transition. Les seuls changements de contexte sont le flag et l'incrément
normal de revision par le trigger settings existant; phase/saison/semaine ne changent pas.

Le verrou précède settings. Sous ces verrous, une soumission QB/matchs incomplète
fait échouer la fermeture. Cela couvre le cas où le QB a été écrit juste avant
la fermeture mais où la requête de picks n'est pas encore arrivée. Ne jamais
forcer cette erreur : laisser finir la soumission puis réessayer. Une anomalie
préexistante doit être examinée, pas masquée ou effacée. Si le bootstrap échoue,
sa transaction est annulée : ne pas installer la migration principale.

```sql
begin;
lock table public.games,public.picks,public.qb_picks,public.qb_ratings,public.weekly_scores,public.qb_weekly_stats,public.qb_selection_weeks in share row exclusive mode;
-- BEGIN REGULAR WRITE PAUSE BOOTSTRAP
alter table public.settings add column if not exists regular_writes_paused boolean not null default false;
create or replace function public.guard_regular_write_pause() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s public.settings;
begin
 if tg_table_name='settings' then
  if new.regular_writes_paused is distinct from old.regular_writes_paused then
   if current_user<>'postgres' then raise exception 'Maintenance réservée au propriétaire SQL'; end if;
   if new.regular_writes_paused then
    lock table public.games,public.picks,public.qb_picks,public.qb_ratings,public.weekly_scores,public.qb_weekly_stats,public.qb_selection_weeks in share row exclusive mode;
    -- Refuse to cut a legacy submission between its QB and match requests.
    if exists(select 1 from public.qb_picks q where coalesce((to_jsonb(q)->>'season')::int,2026)=old.current_season and
      exists(select 1 from public.games g where g.season=old.current_season and g.week=q.week and g.is_pool_eligible and
        not exists(select 1 from public.picks p where p.game_id=g.id and p.user_id=q.user_id))) or
      exists(select 1 from public.picks p join public.games g on g.id=p.game_id where g.season=old.current_season and
        not exists(select 1 from public.qb_picks q where q.user_id=p.user_id and q.week=g.week and coalesce((to_jsonb(q)->>'season')::int,2026)=g.season))
    then raise exception 'Maintenance refusée : soumission QB/matchs incomplète. Réessayer après sa complétion; ne pas forcer.'; end if;
   end if;
  end if;
  if old.regular_writes_paused and (new.current_week is distinct from old.current_week or new.current_season is distinct from old.current_season or new.phase is distinct from old.phase or new.regular_finalized_at is distinct from old.regular_finalized_at or new.playoff_reminders_enabled is distinct from old.playoff_reminders_enabled)
  then raise exception 'Maintenance en cours. Contexte sportif verrouillé.'; end if;
  return new;
 end if;
 select * into s from public.settings where id=1;
 if s.id is null or s.regular_writes_paused then
  raise exception 'Maintenance en cours. Les soumissions sont temporairement indisponibles. Réessaie dans quelques minutes.' using errcode='55000';
 end if;
 return null;
end $$;
revoke all on function public.guard_regular_write_pause() from public,anon,authenticated,service_role;
drop trigger if exists regular_write_pause_settings on public.settings;
create trigger regular_write_pause_settings before update on public.settings for each row execute function public.guard_regular_write_pause();
do $$ declare t text; begin
 foreach t in array array['games','picks','qb_picks','qb_ratings','weekly_scores','qb_weekly_stats','qb_selection_weeks'] loop
  execute format('drop trigger if exists regular_write_pause on public.%I',t);
  execute format('create trigger regular_write_pause before insert or update or delete or truncate on public.%I for each statement execute function public.guard_regular_write_pause()',t);
 end loop;
end $$;
update public.settings set regular_writes_paused=true where id=1 and not regular_writes_paused;
commit;
```

Activation ultérieure (mécanisme déjà installé) :

```sql
begin;
lock table public.games,public.picks,public.qb_picks,public.qb_ratings,public.weekly_scores,public.qb_weekly_stats,public.qb_selection_weeks in share row exclusive mode;
update public.settings set regular_writes_paused=true where id=1 and not regular_writes_paused;
commit;
```

Contrôle en lecture seule (après bootstrap et après migration) :

```sql
select regular_writes_paused,phase,current_season,current_week,revision,
       regular_finalized_at,playoff_reminders_enabled
from public.settings where id=1;
select c.relname,t.tgname,t.tgenabled
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and t.tgname in ('regular_write_pause','regular_write_pause_settings')
order by c.relname;
```

Attendu : flag true; 7 guards de tables régulières et 1 guard settings, tous activés
(tgenabled O). Les lectures des choix restent autorisées. Les écritures sont refusées
également pour les RPC SECURITY DEFINER : il n'existe pas d'exception propriétaire
au contrôle de pause. Le propriétaire peut toujours modifier le flag.

Réouverture :

```sql
update public.settings set regular_writes_paused=false
where id=1 and regular_writes_paused;
```

Ordre exact :
1. Push de la branche corrigée et build Preview du SHA final, sans soumission sur la base active.
2. Informer les utilisateurs de la courte fermeture, exécuter le bootstrap puis vérifier true.
3. Appliquer manuellement la migration principale; vérifier que la pause est toujours true.
4. Intégrer la branche dans main et déployer ce SHA en production.
5. Attendre Ready, contrôler le SHA déployé et les lectures de la nouvelle version.
6. Exécuter la réouverture, vérifier false et demander de recharger les anciens onglets.

Si Vercel échoue après migration : laisser true et redéployer le même commit corrigé.
Ne pas remettre l'ancien code en service sur le nouveau schéma. Avant migration,
le bootstrap seul est réversible par false et l'ancien code peut reprendre.

Après migration, toutes les écritures REST des sept tables régulières doivent
porter `x-pool-regular-schema: 20261009`, ajouté par regularClient. Ce marqueur
n'est PAS une autorisation : RLS, participant, saison et pause restent obligatoires.
Il bloque les anciens onglets également sur picks, dont le payload n'a pas changé.
Les contraintes season/ON CONFLICT seules ne suffisaient pas pour ce cas.
Un client ancien est refusé avec « Version périmée. Recharge la page avant de
soumettre. »; un client à jour voit le message de maintenance. Aucune écriture
partielle n'est admise par un ancien onglet après réouverture. L'activation refuse
également de couper une soumission existante. Aucun auto-nettoyage de données.

Le bouton Mes choix relit le flag avant la soumission; les guards restent l'autorité
si la pause commence ensuite. regularIsOpen empêche aussi les nouveaux traitements
réguliers de démarrer pendant cette fermeture. Les rappels Playoffs restent désactivés.

Validation du correctif maintenance : 88 tests ciblés PASS; 410 tests complets
PASS; 0 échec, 0 ignoré; npm run build PASS. Bootstrap et migration exécutés
uniquement dans PostgreSQL local en mémoire. Aucun changement Supabase distant.
