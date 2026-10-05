# Fondation du cycle de vie — revue manuelle

## Périmètre et sources

Base : main `184b3e78884570ce29aacbeddf76a406d9fe918a`.
Sources : `Supabase Snippet Untitled query (3).csv` et `(4).csv`, fournis par le propriétaire. Aucun accès distant n'a servi à cette implémentation.

Comparaison effectuée avant SQL :
- settings : id/current_week/current_season integer NOT NULL, PK id; aucun CHECK singleton dans l'export. Préflight exige exactement une ligne id=1 valide, puis CHECK id=1. Aucune ligne n'est créée ou réparée.
- games possède déjà season integer et season_type text; ses imports et updates passent par le client navigateur. Les autres identités régulières reposent sur semaine et/ou game_id.
- clés préservées : picks(user_id,game_id), qb_picks(user_id,week) et (qb_id,week), qb_ratings(qb_id,week), qb_weekly_stats(week,espn_athlete_id), weekly_scores(user_id,week), qb_selection_weeks(week).
- users.is_admin boolean nullable default false; INSERT/UPDATE du propre profil et droits sur toutes ses colonnes rendent nécessaire une protection du champ en base. Les policies et les droits des autres champs sont conservés.
- les grants TRUNCATE/TRIGGER ordinaires exportés sont retirés sur les sept tables régulières, users et settings. NO dans les grants signifie non transmissible, pas absent. Aucune policy RLS n'est remplacée.
- qbs : aucune nouvelle permission; son défaut de policy INSERT pour le navigateur demeure hors scope. L'écriture service_role (BYPASSRLS) est une voie distincte déjà privilégiée, non utilisée par cette insertion navigateur.
- aucun trigger utilisateur régulier n'a été démontré dans l'export, conformément à l'instruction du propriétaire. Aucun trigger existant d'un autre nom n'est supprimé.

## Migration

`supabase/migrations/202610040001_lifecycle_foundation.sql` est autonome après les migrations Playoffs/rappels déjà installées. Transaction BEGIN/COMMIT, réexécutable sur son propre état; elle ne rejoue aucune ancienne migration.

Première installation attendue : phase='regular', regular_finalized_at=NULL, revision=0, playoff_reminders_enabled=false. current_week/current_season, profils et événements existants sont conservés. Une réexécution ne remet pas une phase existante à regular et ne réinitialise pas la révision.

Le code dépend des nouvelles colonnes : appliquer manuellement la migration **après revue et avant déploiement de ce code**, jamais déployer d'abord sur main. Sans les colonnes, le contexte échoue explicitement plutôt que choisir 2026 ou une saison maximale. Cette branche n'est pas une activation.

Procédure future uniquement : ouvrir SQL Editor avec l'autorité PostgreSQL habituelle `postgres`, exécuter le fichier complet, contrôler l'état et les définitions. NE PAS utiliser db push ni rejouer 202609250001. Aucune de ces actions n'a été faite par l'agent.

## Triggers : définitions exactes

Les corps de fonctions sont intégralement dans la migration. Voici les déclarations SQL concrètes créées par la boucle :

```sql
CREATE TRIGGER lifecycle_regular_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.games FOR EACH STATEMENT EXECUTE FUNCTION public.guard_regular_write();
CREATE TRIGGER lifecycle_regular_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.picks FOR EACH STATEMENT EXECUTE FUNCTION public.guard_regular_write();
CREATE TRIGGER lifecycle_regular_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.qb_picks FOR EACH STATEMENT EXECUTE FUNCTION public.guard_regular_write();
CREATE TRIGGER lifecycle_regular_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.qb_ratings FOR EACH STATEMENT EXECUTE FUNCTION public.guard_regular_write();
CREATE TRIGGER lifecycle_regular_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.qb_weekly_stats FOR EACH STATEMENT EXECUTE FUNCTION public.guard_regular_write();
CREATE TRIGGER lifecycle_regular_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.weekly_scores FOR EACH STATEMENT EXECUTE FUNCTION public.guard_regular_write();
CREATE TRIGGER lifecycle_regular_write BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.qb_selection_weeks FOR EACH STATEMENT EXECUTE FUNCTION public.guard_regular_write();
CREATE TRIGGER lifecycle_user_admin_flag BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_user_admin_flag();
CREATE TRIGGER lifecycle_settings BEFORE INSERT OR UPDATE OR DELETE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.guard_lifecycle_settings();
CREATE TRIGGER lifecycle_settings_truncate BEFORE TRUNCATE ON public.settings FOR EACH STATEMENT EXECUTE FUNCTION public.guard_lifecycle_settings();
CREATE TRIGGER lifecycle_notification BEFORE INSERT OR UPDATE ON public.push_notification_events FOR EACH ROW EXECUTE FUNCTION public.guard_lifecycle_notification();
```

Les deux triggers d'ouverture Playoffs existants sont conservés; leur fonction `playoff_open_reminders()` est remplacée pour consulter le garde-fou avant de modifier reminder_opened_at ou de mettre en file. `queue_pool_reminder` et `claim_pool_reminder` conservent signatures et restrictions service_role; leurs corps vérifient aussi le garde-fou. Le claim vérifie la saison active.

## Garanties et inventaire des écritures

- INSERT/UPDATE/DELETE/TRUNCATE réguliers : guard statement SECURITY DEFINER, search_path vide, lecture settings FOR SHARE conservée jusqu'à fin de transaction. Même service_role ne contourne pas le gel des données régulières.
- games : import, remise à jour des horaires, scores, admissibilité; picks et qb_picks : soumission/modification/suppression; qb_ratings/qb_weekly_stats : mises à jour ESPN; weekly_scores : recalcul; qb_selection_weeks : ouverture de semaine.
- settings : semaine modifiable selon les droits RLS existants seulement tant que regular ouvert. Révision incrémentée automatiquement sur chaque UPDATE; suppression/truncate/ajout d'une ligne interdits. Les imports qui réécrivent la **même** saison restent permis; changer de saison est volontairement bloqué.
- phase, saison, clôture, activation rappels et révision ne sont pas librement modifiables par authenticated, même admin, ni par une écriture service_role directe.
- seul postgres, propriétaire de confiance, peut aujourd'hui gérer les champs du cycle. La future transaction SECURITY DEFINER aura ce rôle et devra implémenter la preuve de clôture. Aucun bypass via paramètre frontend, JWT metadata ou GUC utilisateur.
- users : trigger SECURITY INVOKER; rôle SQL effectif postgres/service_role autorisé à gérer is_admin. Un utilisateur ordinaire, même admin applicatif, ne peut changer sa valeur (true/false/NULL). INSERT true refusé; INSERT false/défaut/NULL reste possible selon RLS. Réécrire la même valeur n'est pas une élévation. Les autres champs gardent leurs droits.
- aucune restriction ajoutée à teams/qbs ni aux tables Playoffs. Les mises à jour des référentiels partagés restent utilisables par les voies déjà autorisées.

## Clôture : primitive préparée, aucune fausse preuve

`lock_regular_lifecycle(integer,bigint)` est exclusivement exécutable par service_role/propriétaire. Elle verrouille settings FOR UPDATE, vérifie saison, phase regular, absence de gel et révision attendue; elle retourne le contexte et n'écrit rien.

**Ce n'est pas une RPC de finalisation.** Elle ne considère ni un booléen, ni un timestamp frontend, ni une présence de scores comme preuve sportive. Aucun endpoint de clôture n'est créé dans cette étape. Lors du prochain chantier, la transaction appelante devra vérifier une preuve réelle de fin du calendrier et de publication des scores, puis enregistrer clôture/phase atomiquement. Appeler le verrou seul via HTTP ne conserve pas un verrou pour un second appel HTTP.

Le propriétaire PostgreSQL reste nécessairement une autorité de confiance (il peut également changer les triggers). Il n'existe pas d'exception service_role permettant d'écrire dans les données régulières après gel. Un futur outil de réparation devra être explicite, pas un bypass accessible aux clients.

## Contexte et prévisualisation

`loadLifecycle` lit strictement settings(id=1) et valide types, phase et révision. Aucun MAX, valeur par défaut silencieuse, année du calendrier ou saison navigateur autoritaire. Les API Admin comparent la saison demandée à la saison réelle avant l'action.

`getPlayoffContext(client)` devient asynchrone et utilise ce contexte; ses appelants Séries et Admin sont adaptés. La phase regular n'interdit pas la prévisualisation authentifiée /series. Aucun routage, navigation, arbre, calcul, scoring ou bouton de transition n'est ajouté.

## Notifications

Quatre barrières : variable POOL_REMINDERS_ENABLED toujours absente/non activée, cron reminders toujours absent, flag DB false, contrôle de phase. Les nouveaux rappels Playoffs ne sont ni mis en file ni réclamés avec le flag false; aucune suppression d'événement existant. Le trigger direct protège aussi les inserts/upserts contournant la RPC. Le type d'un événement ne peut être transformé pour contourner le contrôle.

Les routes régulières first-player/next-player/qb-final/rankings-updated/scheduled s'arrêtent hors regular ouvert. Le transport relit le contexte juste avant chaque envoi; le worker de rappels vérifie également avant queue/claim/envoi. Le cron historique et les notifications de compte restent intacts.

Limite physique : un push déjà remis au fournisseur avant la fermeture ne peut pas être rappelé. La future orchestration devra aussi traiter les opérations réseau déjà en vol; aucune transaction SQL ne peut annuler leur livraison.

## Validation locale et limites

Fixture SQL dérivée des colonnes, indexes, grants et policies des exports, sans données de production. Les tables Playoffs/queue de cette fixture sont minimales; les FK régulières non complètement décrites ne sont pas réinventées. Les suites Playoffs existantes valident séparément leurs migrations complètes.

PGlite PostgreSQL embarqué en mémoire : installation/rejeu, rôles ordinaires/admin/service_role, profils, ancien contexte, double tentative même révision, tous DML réguliers après gel/phase, référentiels/Playoffs, rappels bloqués et événements historiques préservés. La concurrence logique des deux tentatives est testée; PGlite sérialise les requêtes, ce n'est pas une simulation de deux connexions PostgreSQL indépendantes. Un test multiconnexion des verrous/deadlocks demeure à faire en environnement isolé avant activation de la future transition. Un deadlock doit entraîner rollback/reprise, jamais une transition partielle.

Aucune preuve de clôture sportive ni transition complète n'est livrée ici; c'est explicitement le chantier suivant. Aucun flux offseason, aucune archive et aucune clé multi-saison n'est introduit.

Les rôles SQL privilégiés réels doivent être postgres/service_role comme attendu. Vérifier aussi que les définitions exportées sont toujours actuelles et que settings comporte bien exactement une ligne id=1 avant l'application manuelle. Les defaults ne prouvent pas la valeur réelle de current_season; cette valeur doit être contrôlée par le propriétaire, sans être forcée par la migration.
