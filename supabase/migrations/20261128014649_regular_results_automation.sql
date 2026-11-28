-- Extend the weekly publisher. Existing result rows, notification claims
-- and lifecycle settings are untouched on installation.
begin;

alter table public.push_notification_events
 add column qb_final_payload jsonb,
 add column qb_final_attempted_at timestamptz,
 add constraint qb_final_payload_object check(qb_final_payload is null or
   (notification_type is not distinct from 'qb_final' and jsonb_typeof(qb_final_payload)='object'));
create index regular_qb_final_due on public.push_notification_events(season,week)
 where notification_type='qb_final' and status='pending' and sent_at is null
   and qb_final_payload is not null and qb_final_attempted_at is null;

create function public.guard_regular_qb_final_notification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.notification_type='qb_final' then
  if (new.event_key,new.user_id,new.week,new.season,new.notification_type)
      is distinct from (old.event_key,old.user_id,old.week,old.season,old.notification_type) then
   raise exception 'QB final notification identity is immutable';
  end if;
  if new.qb_final_payload is distinct from old.qb_final_payload then
   raise exception 'QB final notification payload is immutable';
  end if;
  if old.qb_final_attempted_at is not null and new.qb_final_attempted_at is distinct from old.qb_final_attempted_at then
   raise exception 'QB final notification claim cannot be reset';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_regular_qb_final_notification() from public,anon,authenticated,service_role;
create trigger regular_qb_final_notification_immutable before update on public.push_notification_events
 for each row execute function public.guard_regular_qb_final_notification();

create function public.check_regular_week_result_snapshot(
 p_season integer,p_week integer,p_revision bigint,p_actor uuid,p_mode text,p_expected jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare s public.settings;
begin
 if p_mode is null or p_mode not in ('automatic','qb-only','manual','close') then
  raise exception 'Invalid regular result mode';
 end if;
 -- Keep the same sources-before-settings order as publication and lifecycle.
 -- This serializes the two Admin actions and all worker passes with ordinary writes.
 lock table public.games,public.picks,public.qb_picks,public.qb_ratings,public.weekly_scores,public.qbs,public.teams,public.users in share row exclusive mode;
 lock table public.qb_weekly_stats,public.season_participants,public.regular_ranking_versions,public.push_notification_events in share row exclusive mode;
 if p_mode='close' then
  lock table public.qb_selection_weeks in share row exclusive mode;
 end if;
 select * into s from public.settings where id=1 for update;
 if p_mode in ('manual','close') then
  if not exists(select 1 from public.users where id=p_actor and is_admin=true) then
   raise exception 'Administrator required' using errcode='42501';
  end if;
 elsif p_actor is not null then
  raise exception 'Scheduled mode cannot impersonate an administrator' using errcode='42501';
 end if;
 if s.id is null or s.current_season is distinct from p_season or s.current_week is distinct from p_week or
   s.revision is distinct from p_revision or s.phase<>'regular' or s.regular_finalized_at is not null or s.regular_writes_paused then
  raise exception 'Stale, closed or paused regular context' using errcode='40001';
 end if;
 if public.regular_week_ranking_state(p_season,p_week) is distinct from p_expected then
  raise exception 'Stale weekly ranking source' using errcode='40001';
 end if;
end $$;
revoke all on function public.check_regular_week_result_snapshot(integer,integer,bigint,uuid,text,jsonb)
 from public,anon,authenticated,service_role;

-- The original publisher's calculation, saved-score rules and versioned
-- notification queue remain the single implementation for both entry points.
create function public.save_regular_week_ranking(
 p_season integer,p_week integer,p_results jsonb,p_scheduled_for timestamptz,p_notify boolean
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 calculated jsonb; vector jsonb; prior_vector jsonb; current_fingerprint text;
 prior public.regular_ranking_versions; initialized boolean:=false; changed boolean:=false; next_version bigint;
 person jsonb; updated_count integer;
begin
 if jsonb_typeof(p_results) is distinct from 'array' then raise exception 'Weekly result array required'; end if;
 if exists(select 1 from public.picks p join public.games g on g.id=p.game_id
  join public.season_participants sp on sp.season=p_season and sp.user_id=p.user_id and sp.confirmed
  left join public.qb_picks q on q.season=p_season and q.week=p_week and q.user_id=p.user_id
  left join public.qb_ratings r on r.season=p_season and r.week=p_week and r.qb_id=q.qb_id
  where g.season=p_season and g.week=p_week and g.is_pool_eligible and g.result_status='final'
   and (q.id is null or r.passer_rating<0 or r.passer_rating>158.3)) then
  raise exception 'Weekly QB choice or rating invalid';
 end if;
 -- Pending/in-progress score pairs cannot award points. A missing interim QB
 -- rating retains the existing multiplier 1; server preparation rejects missing
 -- ratings for a QB whose own game is already FINAL.
 with pts as (
  select p.user_id,sum(public.regular_pick_base_points(g.home_team,g.away_team,g.home_score,g.away_score,p.picked_team,p.predicted_spread,true))::integer base_points
  from public.picks p join public.games g on g.id=p.game_id
  join public.season_participants sp on sp.season=p_season and sp.user_id=p.user_id and sp.confirmed
  where g.season=p_season and g.week=p_week and g.season_type='regular' and g.is_pool_eligible
   and g.result_status='final' and g.home_score>=0 and g.away_score>=0
   and g.home_team<>'' and g.away_team<>'' and g.home_team<>g.away_team and p.picked_team in(g.home_team,g.away_team)
  group by p.user_id
 ), scores as (
  select p.*,case when r.passer_rating>0 then r.passer_rating::double precision/100::double precision else 1::double precision end m
  from pts p left join public.qb_picks q on q.season=p_season and q.week=p_week and q.user_id=p.user_id
  left join public.qb_ratings r on r.season=p_season and r.week=p_week and r.qb_id=q.qb_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'week',p_week,'base_points',base_points,
  'multiplier',public.regular_round_score(m),'final_score',public.regular_round_score(base_points*m)) order by user_id),'[]'::jsonb) into calculated from scores;
 if calculated is distinct from p_results then raise exception 'Weekly recalculation mismatch'; end if;
 updated_count:=jsonb_array_length(calculated);
 select * into prior from public.regular_ranking_versions where season=p_season and week=p_week;
 if updated_count=0 then
  return jsonb_build_object('updated',0,'version',coalesce(prior.version,0),'changed',false,'baseline',false);
 end if;
 -- A first call on an existing installation compares against PREexisting scores,
 -- never an empty synthetic ranking, even when no migration baseline existed.
 if prior.season is null then
  prior_vector:=public.regular_published_ranking(p_season,p_week);
  insert into public.regular_ranking_versions(season,week,version,fingerprint)
   values(p_season,p_week,0,md5(prior_vector::text)) returning * into prior;
  initialized:=true;
 end if;
 insert into public.weekly_scores(season,user_id,week,base_points,multiplier,final_score)
 select p_season,user_id,week,base_points,multiplier,final_score
 from jsonb_to_recordset(calculated) as x(user_id uuid,week integer,base_points integer,multiplier numeric,final_score numeric)
 on conflict(season,user_id,week) do update set base_points=excluded.base_points,multiplier=excluded.multiplier,final_score=excluded.final_score
 where (public.weekly_scores.base_points,public.weekly_scores.multiplier,public.weekly_scores.final_score)
  is distinct from (excluded.base_points,excluded.multiplier,excluded.final_score);
 vector:=public.regular_published_ranking(p_season,p_week);
 current_fingerprint:=md5(vector::text);
 changed:=current_fingerprint is distinct from prior.fingerprint;
 next_version:=prior.version;
 if changed then
  next_version:=prior.version+1;
  update public.regular_ranking_versions set version=next_version,fingerprint=current_fingerprint where season=p_season and week=p_week;
  if p_notify then
   for person in select value from jsonb_array_elements(vector) loop
    -- The displayed standings include all stored score rows. Preserve their ranks,
    -- but deliver only to confirmed participants, as required by notification guards.
    if not exists(select 1 from public.season_participants where season=p_season
      and user_id=(person->>'user_id')::uuid and confirmed) then continue; end if;
    -- Existing participant/phase notification triggers remain authoritative.
    insert into public.push_notification_events(event_key,user_id,notification_type,week,season,scheduled_for,status,ranking_payload)
    values('regular-rankings-'||p_season||'-week-'||p_week||'-v'||next_version||'-user-'||(person->>'user_id'),
     (person->>'user_id')::uuid,'rankings_updated',p_week,p_season,coalesce(p_scheduled_for,clock_timestamp()),'pending',
     jsonb_build_object('title','🏆 Classements mis à jour','body','Après les derniers matchs, tu es '||(person->>'rank')||case when (person->>'rank')::integer=1 then 'er' else 'e' end||' cette semaine avec '||to_char((person->>'final_score')::numeric,'FM999999999990.000')||' pts.',
      'url','/classements','rank',(person->>'rank')::integer,'score',(person->>'final_score')::numeric,'version',next_version));
   end loop;
  end if;
 end if;
 return jsonb_build_object('updated',updated_count,'version',next_version,'changed',changed,'baseline',initialized);
end $$;
revoke all on function public.save_regular_week_ranking(integer,integer,jsonb,timestamptz,boolean)
 from public,anon,authenticated,service_role;

-- Preserve the existing signature and its original Admin-only contract.
create or replace function public.publish_regular_week(
 p_season integer,p_week integer,p_revision bigint,p_actor uuid,p_expected jsonb,p_results jsonb,p_scheduled_for timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.check_regular_week_result_snapshot(p_season,p_week,p_revision,p_actor,'manual',p_expected);
 return public.save_regular_week_ranking(p_season,p_week,p_results,p_scheduled_for,true);
end $$;

create function public.regular_week_selected_qb_games(p_season integer,p_week integer)
returns table(user_id uuid,qb_id uuid,game_id uuid,opponent text)
language sql stable security invoker set search_path='' as $$
 select q.user_id,q.qb_id,g.id,case when g.is_home then g.away_team else g.home_team end
 from public.qb_picks q
 left join lateral (
  select g.id,g.home_team,g.away_team,m.is_home,count(*) over () matches
  from public.games g
  cross join lateral (select
    qb_observation.regular_team_id(q.selected_team)=qb_observation.regular_team_id(g.home_team) as is_home,
    qb_observation.regular_team_id(q.selected_team)=qb_observation.regular_team_id(g.away_team) as is_away
  ) m
  where g.season=q.season and g.week=q.week and g.season_type='regular' and m.is_home<>m.is_away
 ) g on g.matches=1 and btrim(q.selected_team)<>'' and btrim(q.selected_qb_name)<>''
   and q.selected_espn_athlete_id ~ '^[0-9]{1,18}$'
 where q.season=p_season and q.week=p_week;
$$;
revoke all on function public.regular_week_selected_qb_games(integer,integer) from public,anon,authenticated,service_role;

-- ESPN requests happen before this RPC. The caller prepares exactly the
-- existing calculation over the expected snapshot plus proposed changes.
-- Scope, identity, numeric bounds and result arithmetic are rechecked here.
create function public.commit_regular_week_results(
 p_season integer,p_week integer,p_revision bigint,p_actor uuid,p_mode text,p_expected jsonb,
 p_games jsonb,p_ratings jsonb,p_results jsonb,p_scheduled_for timestamptz,
 p_qb_stats jsonb default '[]'::jsonb,p_teams jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_games integer:=0; v_ratings integer:=0; v_teams integer:=0; v_stats integer:=0; v_qb_events integer:=0;
 v_ranking jsonb; v_advance jsonb;
begin
 if jsonb_typeof(p_games) is distinct from 'array' or jsonb_typeof(p_ratings) is distinct from 'array' or
   jsonb_typeof(p_qb_stats) is distinct from 'array' or jsonb_typeof(p_teams) is distinct from 'array' or
   (p_mode in ('qb-only','close') and (p_qb_stats<>'[]'::jsonb or p_teams<>'[]'::jsonb)) then
  raise exception 'Invalid regular result batch';
 end if;
 perform public.check_regular_week_result_snapshot(p_season,p_week,p_revision,p_actor,p_mode,p_expected);

 if (select count(distinct x.id) from jsonb_to_recordset(p_games) x(id uuid))<>jsonb_array_length(p_games) or
   exists (
    select 1 from jsonb_to_recordset(p_games) x(id uuid,external_game_id text,result_status text,home_score integer,away_score integer)
    left join public.games g on g.id=x.id and g.season=p_season and g.week=p_week and g.season_type='regular'
    where g.id is null or coalesce(x.external_game_id,'') !~ '^[0-9]{1,18}$'
      or g.external_game_id is distinct from x.external_game_id or x.result_status is distinct from 'final'
      or g.home_team=g.away_team
      or x.home_score is null or x.away_score is null or x.home_score<0 or x.away_score<0
   ) then
  raise exception 'Invalid ESPN FINAL game evidence';
 end if;

 if (select count(distinct x.qb_id) from jsonb_to_recordset(p_ratings) x(qb_id uuid))<>jsonb_array_length(p_ratings) or
   exists (
    select 1 from jsonb_to_recordset(p_ratings) x(qb_id uuid,game_id uuid,passer_rating numeric,actual_qb_name text,actual_espn_athlete_id text)
    left join public.regular_week_selected_qb_games(p_season,p_week) q on q.qb_id=x.qb_id and q.game_id=x.game_id
    where q.game_id is null or not coalesce(x.passer_rating between 0 and 158.3,false)
      or coalesce(x.actual_qb_name,'') !~ '[^[:space:]]' or coalesce(x.actual_espn_athlete_id,'') !~ '^[0-9]{1,18}$'
      or not exists(select 1 from jsonb_to_recordset(p_games) f(id uuid) where f.id=x.game_id)
   ) then
  raise exception 'Invalid ESPN FINAL QB evidence';
 end if;

 if p_mode in ('automatic','manual') and exists (
  select 1
  from public.regular_week_selected_qb_games(p_season,p_week) q
  join jsonb_to_recordset(p_games) f(id uuid) on f.id=q.game_id
  left join jsonb_to_recordset(p_ratings) r(qb_id uuid) on r.qb_id=q.qb_id
  left join public.qb_ratings saved on saved.season=p_season and saved.week=p_week and saved.qb_id=q.qb_id
  where r.qb_id is null and not coalesce(saved.passer_rating between 0 and 158.3
    and saved.actual_qb_name ~ '[^[:space:]]' and saved.actual_espn_athlete_id ~ '^[0-9]{1,18}$',false)
 ) then
  raise exception 'Rating QB final attendu mais indisponible';
 end if;

 if p_mode='close' and (
  not exists(select 1 from public.games where season=p_season and week=p_week and season_type='regular' and is_pool_eligible)
  or exists (
   select g.id from public.games g where g.season=p_season and g.week=p_week and g.season_type='regular' and g.is_pool_eligible
   except select x.id from jsonb_to_recordset(p_games) x(id uuid)
  ) or exists (
   select q.qb_id,q.game_id from public.regular_week_selected_qb_games(p_season,p_week) q
   except select r.qb_id,r.game_id from jsonb_to_recordset(p_ratings) r(qb_id uuid,game_id uuid)
  )
 ) then
  raise exception 'Preuves ESPN finales incomplètes pour cette semaine';
 end if;

 if p_mode<>'qb-only' then
  update public.games g set home_score=x.home_score,away_score=x.away_score,result_status='final'
  from jsonb_to_recordset(p_games) x(id uuid,home_score integer,away_score integer)
  where g.id=x.id
   and (p_mode<>'automatic' or g.result_status is distinct from 'final' or not coalesce(g.home_score>=0 and g.away_score>=0,false))
   and (g.home_score,g.away_score,g.result_status) is distinct from (x.home_score,x.away_score,'final'::text);
  get diagnostics v_games=row_count;
 end if;

 insert into public.qb_ratings as saved(season,week,qb_id,passer_rating,actual_qb_name,actual_espn_athlete_id)
 select p_season,p_week,x.qb_id,x.passer_rating,x.actual_qb_name,x.actual_espn_athlete_id
 from jsonb_to_recordset(p_ratings) x(qb_id uuid,passer_rating numeric,actual_qb_name text,actual_espn_athlete_id text)
 on conflict(season,qb_id,week) do update set passer_rating=excluded.passer_rating,actual_qb_name=excluded.actual_qb_name,
  actual_espn_athlete_id=excluded.actual_espn_athlete_id
 where (p_mode in ('manual','close') or not coalesce(saved.passer_rating between 0 and 158.3 and
     saved.actual_qb_name ~ '[^[:space:]]' and saved.actual_espn_athlete_id ~ '^[0-9]{1,18}$',false))
  and (saved.passer_rating,saved.actual_qb_name,saved.actual_espn_athlete_id)
   is distinct from (excluded.passer_rating,excluded.actual_qb_name,excluded.actual_espn_athlete_id);
 get diagnostics v_ratings=row_count;

 if p_mode in ('manual','automatic') then
  if (select count(distinct x.espn_athlete_id) from jsonb_to_recordset(p_qb_stats) x(espn_athlete_id text))<>jsonb_array_length(p_qb_stats) or
    exists (select 1 from jsonb_to_recordset(p_qb_stats) x(week integer,espn_athlete_id text,qb_name text,passer_rating numeric)
      where x.week is distinct from p_week or x.espn_athlete_id !~ '^[0-9]{1,18}$' or coalesce(x.qb_name,'') !~ '[^[:space:]]'
       or not coalesce(x.passer_rating between 0 and 158.3,false)) then
   raise exception 'Invalid ESPN weekly QB statistics';
  end if;
  insert into public.qb_weekly_stats as saved(season,week,espn_athlete_id,qb_name,team,passer_rating,updated_at)
  select p_season,p_week,x.espn_athlete_id,x.qb_name,x.team,x.passer_rating,clock_timestamp()
  from jsonb_to_recordset(p_qb_stats) x(espn_athlete_id text,qb_name text,team text,passer_rating numeric)
  on conflict(season,week,espn_athlete_id) do update set qb_name=excluded.qb_name,team=excluded.team,
   passer_rating=excluded.passer_rating,updated_at=excluded.updated_at
  where p_mode='manual' and (saved.qb_name,saved.team,saved.passer_rating)
    is distinct from (excluded.qb_name,excluded.team,excluded.passer_rating);
  get diagnostics v_stats=row_count;

  if (select count(distinct x.id) from jsonb_to_recordset(p_teams) x(id uuid))<>jsonb_array_length(p_teams) or
    exists (select 1 from jsonb_to_recordset(p_teams) x(id uuid,wins smallint,losses smallint,ties smallint,division_rank smallint)
      left join public.teams t on t.id=x.id
      where t.id is null or x.wins<0 or x.losses<0 or x.ties<0 or x.division_rank<1) then
   raise exception 'Invalid ESPN team standings';
  end if;
  update public.teams t set wins=x.wins,losses=x.losses,ties=x.ties,division_rank=x.division_rank,division_name=x.division_name
  from jsonb_to_recordset(p_teams) x(id uuid,wins smallint,losses smallint,ties smallint,division_rank smallint,division_name text)
  where t.id=x.id and (t.wins,t.losses,t.ties,t.division_rank,t.division_name)
   is distinct from (x.wins,x.losses,x.ties,x.division_rank,x.division_name);
  get diagnostics v_teams=row_count;
 end if;

 if p_mode<>'qb-only' then
  v_ranking:=public.save_regular_week_ranking(p_season,p_week,p_results,p_scheduled_for,p_mode<>'close');
 end if;

 -- Commit the first usable QB result and its notification reservation
 -- together. After a lost response, drain the existing unsent reservation.
 insert into public.push_notification_events(event_key,user_id,notification_type,week,season,status,qb_final_payload)
 select (case when p_season=2026 then '' else 'season-'||p_season||'-' end)||'qb-final-week-'||p_week||'-user-'||q.user_id,
   q.user_id,'qb_final',p_week,p_season,'pending',
   jsonb_build_object('actualQbName',r.actual_qb_name,'opponent',q.opponent,'passerRating',r.passer_rating)
 from public.regular_week_selected_qb_games(p_season,p_week) q
 join public.games g on g.id=q.game_id
 join public.qb_ratings r on r.season=p_season and r.week=p_week and r.qb_id=q.qb_id
 join public.season_participants sp on sp.season=p_season and sp.user_id=q.user_id and sp.confirmed
 where r.passer_rating between 0 and 158.3 and r.actual_qb_name ~ '[^[:space:]]'
   and r.actual_espn_athlete_id ~ '^[0-9]{1,18}$'
   and (g.result_status='final' or exists(select 1 from jsonb_to_recordset(p_games) f(id uuid) where f.id=g.id))
 on conflict(event_key) do nothing;
 get diagnostics v_qb_events=row_count;

 if p_mode='close' then
  -- A failure here, including a target closing while we wait, rolls back
  -- the corrections, recalculation and queue reservations above.
  v_advance:=public.advance_regular_week(p_season,p_week,p_revision,p_actor);
 end if;
 return coalesce(v_ranking,'{}'::jsonb)||jsonb_build_object('games_updated',v_games,'ratings_updated',v_ratings,
  'qb_stats_updated',v_stats,'teams_updated',v_teams,'qb_events_queued',v_qb_events,'advance',v_advance);
end $$;
revoke all on function public.commit_regular_week_results(integer,integer,bigint,uuid,text,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.commit_regular_week_results(integer,integer,bigint,uuid,text,jsonb,jsonb,jsonb,jsonb,timestamptz,jsonb,jsonb)
 to service_role;

commit;
