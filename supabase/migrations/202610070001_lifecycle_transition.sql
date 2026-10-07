-- Local review only. Requires lifecycle foundation, regular final publication,
-- seed, round-admin and scoring migrations already installed. No data changes here.
begin;
create function public.lifecycle_transition_state(p_season integer)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'regular',public.regular_publication_state(p_season),
  'publication',(select to_jsonb(p) from public.regular_final_publications p where season=p_season),
  'publication_valid',public.regular_final_publication_valid(p_season,(select revision from public.settings where id=1)),
  'seeds',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.playoff_seeds s where season=p_season),'[]'),
  'rounds',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.playoff_rounds r where season=p_season),'[]'),
  'games',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.playoff_games g join public.playoff_rounds r on r.id=g.round_id where r.season=p_season),'[]'),
  'picks',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.playoff_picks p join public.playoff_games g on g.id=p.game_id join public.playoff_rounds r on r.id=g.round_id where r.season=p_season),'[]'),
  'qb_picks',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.playoff_qb_picks p join public.playoff_rounds r on r.id=p.round_id where r.season=p_season),'[]'),
  'paths',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.playoff_team_paths p join public.playoff_rounds r on r.id=p.round_id where r.season=p_season),'[]'),
  'runs',coalesce((select jsonb_agg(to_jsonb(p) order by p.round_id) from public.playoff_round_runs p join public.playoff_rounds r on r.id=p.round_id where r.season=p_season),'[]'),
  'results',coalesce((select jsonb_agg(to_jsonb(p) order by p.round_id,p.user_id) from public.playoff_round_results p join public.playoff_rounds r on r.id=p.round_id where r.season=p_season),'[]')
 );
$$;
revoke all on function public.lifecycle_transition_state(integer) from public,anon,authenticated;
grant execute on function public.lifecycle_transition_state(integer) to service_role;

create function public.transition_to_playoffs(p_season integer,p_revision bigint,p_actor uuid,p_expected jsonb,p_prepared jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 s public.settings; actual jsonb; original_seeds jsonb; desired_seeds jsonb;
 capture timestamptz; prepared_time timestamptz; conflict record; wc public.playoff_rounds;
 keys text[]:=array['wild_card','divisional','conference','super_bowl'];
begin
 if p_season is null or p_season not between 2000 and 9999 or p_revision is null or p_revision<0 then raise exception 'Saison ou révision invalide'; end if;
 -- Match existing seed/round lock order. Regular writers lock their own table
 -- BEFORE the settings guard; never take settings first and then those tables.
 perform pg_catalog.pg_advisory_xact_lock(20260924,p_season);
 lock table public.games,public.picks,public.qb_picks,public.qb_ratings,public.weekly_scores,public.qbs,public.teams,public.users in share row exclusive mode;
 lock table public.regular_final_publications,public.playoff_seeds,public.playoff_rounds,public.playoff_games,public.playoff_picks,public.playoff_qb_picks,public.playoff_team_paths,public.playoff_round_runs,public.playoff_round_results in share row exclusive mode;
 select * into s from public.settings where id=1 for update;
 if not exists(select 1 from public.users where id=p_actor and is_admin=true) then raise exception 'Administrateur requis'; end if;
 if s.id is null or s.current_season is distinct from p_season then raise exception 'Mauvaise saison active'; end if;
 if s.phase='playoffs' then raise exception 'Déjà en Séries : aucune transition supplémentaire'; end if;
 if s.phase<>'regular' or s.regular_finalized_at is not null then raise exception 'Saison régulière fermée'; end if;
 if s.revision is distinct from p_revision then raise exception 'Révision lifecycle périmée'; end if;
 if s.playoff_reminders_enabled is distinct from false then raise exception 'Les rappels doivent rester désactivés'; end if;
 if not public.regular_final_publication_valid(p_season,p_revision) then raise exception 'Publication finale régulière absente ou périmée'; end if;
 actual:=public.lifecycle_transition_state(p_season);
 if actual is distinct from p_expected then raise exception 'Snapshot modifié pendant la préparation : relire avant de continuer'; end if;
 if p_prepared is null or (p_prepared->>'version')::int is distinct from 1 or (p_prepared->>'season')::int is distinct from p_season or
    (p_prepared->>'revision')::bigint is distinct from p_revision or
    (p_prepared->>'publication_published_at')::timestamptz is distinct from (actual->'publication'->>'published_at')::timestamptz or
    jsonb_typeof(p_prepared->'seeds') is distinct from 'array' or jsonb_typeof(p_prepared->'games') is distinct from 'array'
 then raise exception 'Préparation invalide'; end if;
 prepared_time:=(p_prepared->>'prepared_at')::timestamptz;
 if prepared_time is null or prepared_time>clock_timestamp()+interval '5 seconds' or prepared_time<clock_timestamp()-interval '5 minutes' then raise exception 'Préparation ESPN périmée'; end if;
 if jsonb_array_length(p_prepared->'seeds')<>14 then raise exception 'Exactement 14 seeds requis'; end if;
 if exists(select 1 from jsonb_to_recordset(p_prepared->'seeds') as x(season int,conference text,seed int,team text,espn_team_id text)
  where season is distinct from p_season or conference is null or conference not in('AFC','NFC') or seed is null or seed not between 1 and 7 or
  team is null or btrim(team)='' or team<>btrim(team) or espn_team_id is null or espn_team_id !~ '^[0-9]+$') or
  (select count(*) filter(where conference='AFC')<>7 or count(*) filter(where conference='NFC')<>7 or count(distinct (conference,seed))<>14 or count(distinct lower(team))<>14 or count(distinct espn_team_id)<>14
   from jsonb_to_recordset(p_prepared->'seeds') as x(conference text,seed int,team text,espn_team_id text)) then raise exception 'Seeds invalides, dupliqués ou conférences incomplètes'; end if;
 if exists(select 1 from jsonb_array_elements(p_prepared->'seeds') x where not exists(select 1 from public.teams t where t.name=x->>'team')) then raise exception 'Équipe seed absente du référentiel'; end if;
 select r.id,r.round_key,r.status into conflict from public.playoff_rounds r where r.season=p_season and
   (r.status<>'draft' or r.round_order not between 1 and 4 or r.round_key is distinct from keys[r.round_order] or r.reminder_opened_at is not null) order by r.id limit 1;
 if found then raise exception 'Ronde incompatible : % (id %, état %)',conflict.round_key,conflict.id,conflict.status; end if;
 select g.id,g.round_id,g.external_game_id into conflict from public.playoff_games g join public.playoff_rounds r on r.id=g.round_id where r.season=p_season order by g.id limit 1;
 if found then raise exception 'Match existant à préserver : % (id %, ronde %). Aucun écrasement ni suppression',coalesce(conflict.external_game_id,'sans ID'),conflict.id,conflict.round_id; end if;
 if jsonb_array_length(actual->'picks')>0 or jsonb_array_length(actual->'qb_picks')>0 or jsonb_array_length(actual->'paths')>0 or
    jsonb_array_length(actual->'runs')>0 or jsonb_array_length(actual->'results')>0 then raise exception 'Choix/parcours/scoring Séries existants à préserver'; end if;
 if jsonb_array_length(p_prepared->'games')<>6 then raise exception 'Exactement six matchs Wild Card requis'; end if;
 if (select count(distinct x->>'external_game_id')<>6 from jsonb_array_elements(p_prepared->'games') x) or
    (select count(distinct team)<>12 from (select x->>'home_team' team from jsonb_array_elements(p_prepared->'games') x union all select x->>'away_team' from jsonb_array_elements(p_prepared->'games') x) q)
 then raise exception 'Matchs ou équipes WC dupliqués'; end if;
 if exists(select 1 from jsonb_array_elements(p_prepared->'games') g where
  g->>'external_game_id' is null or g->>'external_game_id' !~ '^[0-9]+$' or g->>'game_status' is distinct from 'pre' or
  g->>'home_score' is not null or g->>'away_score' is not null or g->>'game_date' is null or (g->>'game_date')::timestamptz<=clock_timestamp() or
  not exists(select 1 from jsonb_array_elements(p_prepared->'seeds') h cross join jsonb_array_elements(p_prepared->'seeds') a
   where h->>'team'=g->>'home_team' and a->>'team'=g->>'away_team' and h->>'conference'=a->>'conference' and
     (h->>'seed')::int in(2,3,4) and (a->>'seed')::int=9-(h->>'seed')::int)) then raise exception 'Affrontement WC incompatible avec seeds/conférences/BYE ou horaire officiel'; end if;
 select g.id,g.round_id,g.external_game_id into conflict from public.playoff_games g where exists(select 1 from jsonb_array_elements(p_prepared->'games') x where x->>'external_game_id'=g.external_game_id) limit 1;
 if found then raise exception 'Événement ESPN déjà utilisé : % (match %, ronde %)',conflict.external_game_id,conflict.id,conflict.round_id; end if;
 select jsonb_agg(jsonb_build_object('season',season,'team',team,'espn_team_id',espn_team_id,'conference',conference,'seed',seed) order by conference,seed) into original_seeds from public.playoff_seeds where season=p_season;
 select jsonb_agg(x order by x->>'conference',(x->>'seed')::int) into desired_seeds from jsonb_array_elements(p_prepared->'seeds') x;
 -- Validate the observed snapshot under the existing locks before replacement.
 if original_seeds is not null then
  if (select count(*)<>14 or count(*) filter(where conference='AFC')<>7 or count(*) filter(where conference='NFC')<>7 or
      count(distinct (conference,seed))<>14 or count(distinct captured_at)<>1 or
      (count(finalized_at)<>0 and (count(finalized_at)<>14 or count(distinct finalized_at)<>1))
      from public.playoff_seeds where season=p_season) then raise exception 'Snapshot seeds incomplet ou incohérent'; end if;
  if exists(select 1 from public.playoff_seeds where season=p_season and finalized_at is not null) and original_seeds is distinct from desired_seeds
   then raise exception 'Seeds finalisés différents : aucun remplacement autorisé'; end if;
 end if;
 -- Only an absent or wholly provisional differing snapshot is synchronized.
 -- p_expected already protects every observed row against concurrent changes.
 if original_seeds is null or original_seeds is distinct from desired_seeds then
  capture:=public.sync_playoff_seeds(p_season,p_prepared->'seeds');
 else
  select min(captured_at) into capture from public.playoff_seeds where season=p_season;
 end if;
 if not exists(select 1 from public.playoff_seeds where season=p_season and finalized_at is not null) then
  perform public.finalize_playoff_seeds(p_season,capture);
 elsif (select count(finalized_at)<>14 or count(distinct finalized_at)<>1 from public.playoff_seeds where season=p_season) then raise exception 'Finalisation seeds incohérente'; end if;
 -- Real draft -> open through existing round infrastructure. Its unchanged
 -- notification guards deliberately queue NOTHING while reminders are false.
 perform public.manage_playoff_round(p_season,'prepare','wild_card',p_prepared->'games',jsonb_build_object('rounds',actual->'rounds','games',actual->'games'));
 select * into wc from public.playoff_rounds where season=p_season and round_key='wild_card';
 if wc.status is distinct from 'open' or (select count(*) from public.playoff_games where round_id=wc.id)<>6 then raise exception 'Ouverture Wild Card incomplète'; end if;
 update public.settings set phase='playoffs',regular_finalized_at=transaction_timestamp() where id=1;
 -- Foundation increments revision itself; no direct setting of its value.
 select * into s from public.settings where id=1;
 if s.phase<>'playoffs' or s.regular_finalized_at is null or s.revision<>p_revision+1 or s.playoff_reminders_enabled is distinct from false then raise exception 'Contexte final incompatible'; end if;
 return jsonb_build_object('season',p_season,'phase',s.phase,'revision',s.revision,'regular_finalized_at',s.regular_finalized_at,'wild_card_round_id',wc.id,'games_created',6,'playoff_reminders_enabled',s.playoff_reminders_enabled);
end $$;
revoke all on function public.transition_to_playoffs(integer,bigint,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.transition_to_playoffs(integer,bigint,uuid,jsonb,jsonb) to service_role;
commit;
