-- The owner approved all 13 evidence-derived 2026 participants.
-- Installation does not advance lifecycle or prepare a future season.
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
-- END REGULAR WRITE PAUSE BOOTSTRAP
do $$ begin if (select regular_writes_paused from public.settings where id=1) is distinct from true then raise exception 'Activer le bootstrap maintenance avant cette migration'; end if; end $$;

create table public.seasons (
 season integer primary key check(season between 2000 and 9999),
 prepared_at timestamptz,
 participants_confirmed_at timestamptz,
 started_at timestamptz,
 ended_at timestamptz
);
insert into public.seasons(season,started_at) values(2026,now());
create table public.season_participants (
 season integer not null references public.seasons(season),
 user_id uuid not null references public.users(id),
 confirmed boolean not null default false,
 initial_order integer check(initial_order>0),
 primary key(season,user_id), unique(season,initial_order)
);
-- Actual selections/scores are evidence, not every account. Owner must review omissions.
insert into public.season_participants(season,user_id,confirmed)
 select 2026,user_id,true from (
 select p.user_id from public.picks p join public.games g on g.id=p.game_id where g.season=2026
 union select user_id from public.qb_picks union select user_id from public.weekly_scores
 ) evidence;
-- Preserve the observed first-week order; do not invent positions for missing choices.
update public.season_participants p set initial_order=q.position from (
 select user_id,row_number() over(order by created_at,id)::integer position from public.qb_picks where week=1
) q where p.season=2026 and p.user_id=q.user_id;
alter table public.qb_picks add column season integer not null default 2026 references public.seasons(season);
alter table public.qb_picks drop constraint if exists qb_picks_user_id_week_key;
drop index if exists public.qb_picks_user_id_week_key;
create unique index qb_picks_user_id_week_key on public.qb_picks(season,user_id,week);
alter table public.qb_picks alter column season drop default;
alter table public.qb_ratings add column season integer not null default 2026 references public.seasons(season);
alter table public.qb_ratings drop constraint if exists qb_ratings_qb_id_week_key;
drop index if exists public.qb_ratings_qb_id_week_key;
create unique index qb_ratings_qb_id_week_key on public.qb_ratings(season,qb_id,week);
alter table public.qb_ratings alter column season drop default;
alter table public.weekly_scores add column season integer not null default 2026 references public.seasons(season);
alter table public.weekly_scores drop constraint if exists weekly_scores_user_id_week_key;
drop index if exists public.weekly_scores_user_id_week_key;
create unique index weekly_scores_user_id_week_key on public.weekly_scores(season,user_id,week);
alter table public.weekly_scores alter column season drop default;
alter table public.qb_weekly_stats add column season integer not null default 2026 references public.seasons(season);
alter table public.qb_weekly_stats drop constraint if exists qb_weekly_stats_week_athlete_unique;
drop index if exists public.qb_weekly_stats_week_athlete_unique;
create unique index qb_weekly_stats_week_athlete_unique on public.qb_weekly_stats(season,week,espn_athlete_id);
alter table public.qb_weekly_stats alter column season drop default;
alter table public.qb_selection_weeks add column season integer not null default 2026 references public.seasons(season);
alter table public.qb_selection_weeks drop constraint if exists qb_selection_weeks_pkey;
drop index if exists public.qb_selection_weeks_pkey;
create unique index qb_selection_weeks_pkey on public.qb_selection_weeks(season,week);
alter table public.qb_selection_weeks alter column season drop default;
alter table public.qb_picks drop constraint if exists qb_picks_qb_id_week_key;
drop index if exists public.qb_picks_qb_id_week_key;
create unique index qb_picks_qb_id_week_key on public.qb_picks(season,qb_id,week);
alter table public.push_notification_events add column season integer;
update public.push_notification_events set season=2026 where notification_type in ('qb_turn','qb_final','rankings_updated','regular_five_hour');
create index notification_event_season on public.push_notification_events(season,status);
alter table public.seasons enable row level security;
alter table public.season_participants enable row level security;
revoke all on public.seasons,public.season_participants from public,anon,authenticated,service_role;
grant select on public.seasons,public.season_participants to authenticated,service_role;
create policy seasons_read on public.seasons for select to authenticated using(true);
create policy participants_read on public.season_participants for select to authenticated using(true);

-- Invoker identity distinguishes trusted SQL functions from browser/service direct writes.
create or replace function public.guard_regular_write() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s public.settings; old_season integer; new_season integer; uid uuid;
begin
 -- The mutating statement already holds ROW EXCLUSIVE on its table. Every
 -- lifecycle transition locks these tables before settings, excluding races.
 -- Plain SELECT respects member RLS; FOR SHARE would require Admin UPDATE RLS.
 select * into s from public.settings where id=1;
 if tg_op='TRUNCATE' then raise exception 'Historical seasons cannot be truncated'; end if;
 -- Compatibility marker, not authorization: pause, RLS and season guards still apply.
 if current_user<>'postgres' and coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-pool-regular-schema','')<>'20261009' then raise exception 'Version périmée. Recharge la page avant de soumettre.' using errcode='55000'; end if;
 if tg_table_name='picks' then
  if tg_op<>'INSERT' then select season into old_season from public.games where id=old.game_id; end if;
  if tg_op<>'DELETE' then select season into new_season from public.games where id=new.game_id; uid:=new.user_id; end if;
 else
  if tg_op<>'INSERT' then old_season:=old.season; end if;
  if tg_op<>'DELETE' then new_season:=new.season; end if;
  if tg_table_name in ('qb_picks','weekly_scores') and tg_op<>'DELETE' then uid:=(to_jsonb(new)->>'user_id')::uuid; end if;
 end if;
 if tg_op='UPDATE' and old_season is distinct from new_season then raise exception 'Season identity is immutable'; end if;
 -- Only the trusted preparation function (owner postgres) may import FUTURE games.
 if current_user='postgres' and tg_table_name='games' and tg_op='INSERT' and s.phase='offseason' and new_season=s.current_season+1 and exists(select 1 from public.seasons where season=new_season and started_at is null) and to_jsonb(new)->>'home_score' is null and to_jsonb(new)->>'away_score' is null then return new; end if;
 if s.id is null or s.phase<>'regular' or s.regular_finalized_at is not null or coalesce(new_season,old_season) is distinct from s.current_season then raise exception 'Regular season is closed or historical'; end if;
 if uid is not null and not exists(select 1 from public.season_participants where season=s.current_season and user_id=uid and confirmed) then raise exception 'Confirmed season participant required'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare t text; begin
 foreach t in array array['games','picks','qb_picks','qb_ratings','qb_weekly_stats','weekly_scores','qb_selection_weeks'] loop
 execute format('drop trigger lifecycle_regular_write on public.%I',t);
 execute format('create trigger lifecycle_regular_write before insert or update or delete on public.%I for each row execute function public.guard_regular_write()',t);
 execute format('create trigger lifecycle_regular_truncate before truncate on public.%I for each statement execute function public.guard_regular_write()',t);
 end loop;
end $$;
create or replace function public.guard_lifecycle_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Lifecycle settings cannot be removed'; end if;
 if tg_op='INSERT' then raise exception 'Lifecycle singleton already provisioned'; end if;
 if new.id is distinct from old.id then raise exception 'Lifecycle identity is immutable'; end if;
 if current_user<>'postgres' and
   (new.current_season is distinct from old.current_season or new.phase is distinct from old.phase or
    new.regular_finalized_at is distinct from old.regular_finalized_at or
    new.playoff_reminders_enabled is distinct from old.playoff_reminders_enabled or new.revision is distinct from old.revision)
 then raise exception 'Lifecycle fields require the trusted transition transaction' using errcode='42501'; end if;
 if current_user<>'postgres' and new.current_week is distinct from old.current_week and
   (old.phase<>'regular' or old.regular_finalized_at is not null)
 then raise exception 'Regular season is closed' using errcode='42501'; end if;
 new.revision:=old.revision+1;
 return new;
end $$;
create or replace function public.regular_publication_state(p_season integer)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'settings',(select to_jsonb(s) from public.settings s where s.id=1 and s.current_season=p_season),
 'games',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.games g where g.season=p_season),'[]'),
 'picks',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.picks p join public.games g on g.id=p.game_id where g.season=p_season),'[]'),
 'qb_picks',coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from public.qb_picks q where q.season=p_season),'[]'),
 'qb_ratings',coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from public.qb_ratings q where q.season=p_season),'[]'),
 'weekly_scores',coalesce((select jsonb_agg(to_jsonb(w) order by w.id) from public.weekly_scores w where w.season=p_season),'[]'),
 'qbs',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'name',q.name,'team',q.team,'espn_athlete_id',q.espn_athlete_id) order by q.id) from public.qbs q),'[]'),
 'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'espn_abbr',t.espn_abbr) order by t.id) from public.teams t),'[]'),
 'users',coalesce((select jsonb_agg(u.id order by u.id) from public.users u join public.season_participants sp on sp.user_id=u.id where sp.season=p_season and sp.confirmed),'[]')
 );
$$;
revoke all on function public.regular_publication_state(integer) from public,anon,authenticated;
grant execute on function public.regular_publication_state(integer) to service_role;

-- Future transition MUST call under its locks before freezing the regular data.
create or replace function public.regular_final_publication_valid(p_season integer,p_revision bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.regular_final_publications p join public.settings s on s.id=1
 where p.season=p_season and s.current_season=p_season and s.revision=p_revision and p.lifecycle_revision=p_revision
 and s.phase='regular' and s.regular_finalized_at is null and p.source=public.regular_publication_state(p_season));
$$;
revoke all on function public.regular_final_publication_valid(integer,bigint) from public,anon,authenticated;
grant execute on function public.regular_final_publication_valid(integer,bigint) to service_role;

create or replace function public.publish_regular_final(p_season integer,p_revision bigint,p_actor uuid,p_expected jsonb,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.settings; prior public.regular_final_publications; calculated jsonb; actual jsonb; v_item jsonb; chosen jsonb; v_qb public.qbs; v_game public.games; n integer;
begin
 -- Lock regular sources first: ordinary writers acquire their table lock before
 -- the foundation's settings FOR SHARE. No network is performed inside SQL.
 lock table public.games,public.picks,public.qb_picks,public.qb_ratings,public.weekly_scores,public.qbs,public.teams,public.users in share row exclusive mode;
 perform public.lock_regular_lifecycle(p_season,p_revision);
 select * into s from public.settings where id=1;
 if not exists(select 1 from public.users where id=p_actor and is_admin=true) then raise exception 'Administrator required'; end if;
 select * into prior from public.regular_final_publications where season=p_season;
 if prior.evidence=p_proof and public.regular_final_publication_valid(p_season,p_revision) then
  return jsonb_build_object('already_published',true,'published_at',prior.published_at,'season',p_season);
 end if;
 if public.regular_publication_state(p_season) is distinct from p_expected then raise exception 'Stale regular source snapshot'; end if;
 if p_proof is null or (p_proof->>'version')::integer is distinct from 1 or
   (p_proof->>'season')::integer is distinct from p_season or (p_proof->>'revision')::bigint is distinct from p_revision or
   (p_proof->'calendar'->>'season')::integer is distinct from p_season or (p_proof->'calendar'->>'season_type')::integer is distinct from 2 or
   jsonb_typeof(p_proof->'games') is distinct from 'array' or jsonb_typeof(p_proof->'ratings') is distinct from 'array' or
   jsonb_typeof(p_proof->'results') is distinct from 'array' or jsonb_typeof(p_proof->'calendar'->'weeks') is distinct from 'array' or
   jsonb_typeof(p_proof->'calendar'->'event_ids') is distinct from 'array' then raise exception 'Invalid final proof'; end if;
 n:=jsonb_array_length(p_proof->'games');
 if n=0 or jsonb_array_length(p_proof->'calendar'->'weeks')=0 or n<>jsonb_array_length(p_proof->'calendar'->'event_ids') or
   n<>(select count(distinct value) from jsonb_array_elements_text(p_proof->'calendar'->'event_ids')) or
   n<>(select count(distinct x->>'id') from jsonb_array_elements(p_proof->'games') x) or
   n<>(select count(distinct x->>'external_game_id') from jsonb_array_elements(p_proof->'games') x) or
   n<>(select count(*) from public.games where season=p_season) then raise exception 'Incomplete calendar'; end if;
 if (select count(*)<>count(distinct x->>'week') from jsonb_array_elements(p_proof->'calendar'->'weeks') x) or
   n<>(select count(*) from jsonb_array_elements(p_proof->'calendar'->'weeks') w cross join lateral jsonb_array_elements_text(w->'event_ids') e) or
   exists(select 1 from jsonb_array_elements(p_proof->'calendar'->'weeks') w where (w->>'week')::int<=0 or jsonb_array_length(w->'event_ids')=0) then raise exception 'Invalid weekly calendar'; end if;
 for v_item in select value from jsonb_array_elements(p_proof->'games') loop
  select * into v_game from public.games where id=(v_item->>'id')::uuid;
  if v_game.id is null or v_game.season<>p_season or v_game.season_type<>'regular' or v_game.external_game_id is distinct from v_item->>'external_game_id' or
    v_game.week is distinct from (v_item->>'week')::int or v_game.home_team is distinct from v_item->>'home_team' or v_game.away_team is distinct from v_item->>'away_team' or
    (v_item->>'season')::int is distinct from p_season or v_item->>'season_type' is distinct from 'regular' or
    v_item->>'external_game_id' !~ '^[0-9]+$' or v_item->>'final_status' is distinct from 'STATUS_FINAL' or v_item->>'state' is distinct from 'post' or v_item->'completed' is distinct from 'true'::jsonb or
    v_item->>'home_score' is null or v_item->>'away_score' is null or (v_item->>'home_score')::int<0 or (v_item->>'away_score')::int<0 or
    not (p_proof->'calendar'->'event_ids' ? v_game.external_game_id) or
    (select count(*) from jsonb_array_elements(p_proof->'calendar'->'weeks') w cross join lateral jsonb_array_elements_text(w->'event_ids') e where e.value=v_game.external_game_id and (w->>'week')::int=v_game.week)<>1
  then raise exception 'Invalid FINAL game or calendar membership'; end if;
 end loop;
 if exists(select 1 from public.picks p left join public.games g on g.id=p.game_id where g.id is null or (g.season=p_season and (g.season_type<>'regular' or p.picked_team not in(g.home_team,g.away_team) or p.predicted_spread<0))) then raise exception 'Invalid or mixed-season picks'; end if;
 if (select count(*)<>count(distinct (x->>'qb_id',x->>'week')) from jsonb_array_elements(p_proof->'ratings') x) then raise exception 'Duplicate ratings'; end if;
 for v_item in select value from jsonb_array_elements(p_proof->'ratings') loop
  select * into v_qb from public.qbs where id=(v_item->>'qb_id')::uuid;
  select * into v_game from public.games where id=(v_item->>'game_id')::uuid and season=p_season;
  if v_qb.id is null or v_qb.team is null or v_game.id is null or v_game.week is distinct from (v_item->>'week')::int or
    v_item->>'team' is null or v_item->>'team' not in(v_game.home_team,v_game.away_team) or position(lower(v_qb.team) in lower(v_item->>'team'))=0 or
    v_item->>'final_status' is distinct from 'STATUS_FINAL' or v_item->>'state' is distinct from 'post' or v_item->'completed' is distinct from 'true'::jsonb or
    jsonb_typeof(v_item->'passers') is distinct from 'array' or jsonb_array_length(v_item->'passers')=0 or
    exists(select 1 from jsonb_array_elements(v_item->'passers') x where x->>'id' is null or x->>'id' !~ '^[0-9]+$' or x->>'name' is null or
     jsonb_typeof(x->'rating') is distinct from 'number' or (x->>'rating')::numeric not between 0 and 158.3) then raise exception 'Invalid final QB evidence'; end if;
  select x into chosen from jsonb_array_elements(v_item->'passers') with ordinality e(x,ord)
   order by (case when nullif(v_qb.espn_athlete_id,'') is not null then x->>'id'=v_qb.espn_athlete_id else position(lower(v_qb.name) in lower(x->>'name'))>0 end) desc,ord limit 1;
  if v_item->>'actual_espn_athlete_id' is distinct from chosen->>'id' or v_item->>'actual_qb_name' is distinct from chosen->>'name' or
    v_item->'passer_rating' is distinct from chosen->'rating' then raise exception 'QB selection/replacement mismatch'; end if;
 end loop;
 -- Recompute independently in SQL, preserving existing regular scoring and its
 -- explicit numeric-zero rule, with NO missing-rating fallback.
 if exists(select 1 from public.picks p join public.games g on g.id=p.game_id
  left join public.qb_picks qp on qp.user_id=p.user_id and qp.week=g.week and qp.season=p_season
  where g.season=p_season and (qp.id is null or not exists(select 1 from jsonb_array_elements(p_proof->'ratings') r where (r->>'qb_id')::uuid=qp.qb_id and (r->>'week')::int=g.week))) then raise exception 'Required final QB rating missing'; end if;
 with final_games as(select * from jsonb_to_recordset(p_proof->'games') as x(id uuid,home_score int,away_score int)),
 pts as(select p.user_id,g.week,sum(case when p.picked_team=case when f.home_score>f.away_score then g.home_team when f.away_score>f.home_score then g.away_team else null end then case when p.predicted_spread=abs(f.home_score-f.away_score) then 2 else 1 end else 0 end)::int base_points
 from public.picks p join public.games g on g.id=p.game_id join final_games f on f.id=g.id group by p.user_id,g.week),
 scores as(select p.*,case when (r->>'passer_rating')::numeric>0 then (r->>'passer_rating')::numeric/100 else 1 end m
 from pts p join public.qb_picks qp on qp.user_id=p.user_id and qp.week=p.week and qp.season=p_season join jsonb_array_elements(p_proof->'ratings') r on (r->>'qb_id')::uuid=qp.qb_id and (r->>'week')::int=p.week)
 select jsonb_agg(jsonb_build_object('user_id',user_id,'week',week,'base_points',base_points,'multiplier',round(m,3),'final_score',round(base_points*m,3)) order by week,user_id) into calculated from scores;
 if calculated is null or calculated is distinct from p_proof->'results' then raise exception 'Final recalculation mismatch'; end if;
 if exists(select 1 from public.weekly_scores w where w.season=p_season and not exists(select 1 from jsonb_array_elements(calculated) r where (r->>'user_id')::uuid=w.user_id and (r->>'week')::int=w.week)) then raise exception 'Unattributed historical weekly scores: no destructive cleanup'; end if;
 update public.games g set home_score=x.home_score,away_score=x.away_score from jsonb_to_recordset(p_proof->'games') as x(id uuid,home_score int,away_score int) where g.id=x.id;
 insert into public.qb_ratings(season,qb_id,week,passer_rating,actual_qb_name,actual_espn_athlete_id)
 select p_season,qb_id,week,passer_rating,actual_qb_name,actual_espn_athlete_id from jsonb_to_recordset(p_proof->'ratings') as x(qb_id uuid,week int,passer_rating numeric,actual_qb_name text,actual_espn_athlete_id text)
 on conflict(season,qb_id,week) do update set passer_rating=excluded.passer_rating,actual_qb_name=excluded.actual_qb_name,actual_espn_athlete_id=excluded.actual_espn_athlete_id;
 insert into public.weekly_scores(season,user_id,week,base_points,multiplier,final_score)
 select p_season,user_id,week,base_points,multiplier,final_score from jsonb_to_recordset(calculated) as x(user_id uuid,week int,base_points int,multiplier numeric,final_score numeric)
 on conflict(season,user_id,week) do update set base_points=excluded.base_points,multiplier=excluded.multiplier,final_score=excluded.final_score;
 select jsonb_agg(jsonb_build_object('user_id',user_id,'week',week,'base_points',base_points,'multiplier',multiplier,'final_score',final_score) order by week,user_id) into actual from public.weekly_scores where season=p_season;
 if actual is distinct from calculated then raise exception 'Persisted final results mismatch'; end if;
 if exists(select 1 from jsonb_to_recordset(p_proof->'games') as x(id uuid,home_score int,away_score int)
   left join public.games g on g.id=x.id where g.id is null or g.home_score is distinct from x.home_score or g.away_score is distinct from x.away_score) then raise exception 'Persisted final games mismatch'; end if;
 if exists(select 1 from jsonb_to_recordset(p_proof->'ratings') as x(qb_id uuid,week int,passer_rating numeric,actual_qb_name text,actual_espn_athlete_id text)
   left join public.qb_ratings r on r.qb_id=x.qb_id and r.week=x.week and r.season=p_season where r.id is null or r.passer_rating is distinct from x.passer_rating or r.actual_qb_name is distinct from x.actual_qb_name or r.actual_espn_athlete_id is distinct from x.actual_espn_athlete_id) then raise exception 'Persisted final ratings mismatch'; end if;
 insert into public.regular_final_publications(season,version,lifecycle_revision,published_by,request,evidence,source,results)
 values(p_season,1,p_revision,p_actor,jsonb_build_object('expected',p_expected,'proof',p_proof),p_proof,public.regular_publication_state(p_season),calculated)
 on conflict(season) do update set published_at=clock_timestamp(),version=1,lifecycle_revision=excluded.lifecycle_revision,published_by=excluded.published_by,request=excluded.request,evidence=excluded.evidence,source=excluded.source,results=excluded.results;
 return jsonb_build_object('already_published',false,'season',p_season,'published_at',(select published_at from public.regular_final_publications where season=p_season));
end $$;
revoke all on function public.publish_regular_final(integer,bigint,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_regular_final(integer,bigint,uuid,jsonb,jsonb) to service_role;

create function public.manage_season_lifecycle(p_action text,p_season integer,p_revision bigint,p_actor uuid,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.settings; sb public.playoff_rounds; state jsonb; prepared_game record; count_players integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(20260924,p_season);
 lock table public.games,public.picks,public.qb_picks,public.qb_ratings,public.weekly_scores,public.qbs,public.teams,public.users in share row exclusive mode;
 lock table public.seasons,public.season_participants,public.qb_selection_weeks,public.qb_weekly_stats,public.playoff_rounds,public.playoff_games,public.playoff_picks,public.playoff_qb_picks,public.playoff_team_paths,public.playoff_round_runs,public.playoff_round_results in share row exclusive mode;
 select * into s from public.settings where id=1 for update;
 if not exists(select 1 from public.users where id=p_actor and is_admin=true) then raise exception 'Administrator required'; end if;
 if s.id is null or s.revision is distinct from p_revision then raise exception 'Stale lifecycle context'; end if;
 if s.regular_writes_paused then raise exception 'Maintenance en cours. Opération temporairement indisponible.'; end if;
 if p_action='finish' then
  if s.phase<>'playoffs' or p_season<>s.current_season then raise exception 'Active playoffs required'; end if;
  select * into sb from public.playoff_rounds where season=p_season and round_key='super_bowl';
  if sb.id is null or sb.status not in ('scored','finalized') then raise exception 'Validated Super Bowl required'; end if;
  if exists(select 1 from public.playoff_games g join public.playoff_rounds r on r.id=g.round_id where r.season=p_season and (coalesce(g.external_game_id,'') !~ '^[0-9]+$' or g.game_status is distinct from 'post')) then raise exception 'Official final games required'; end if;
  if (select count(*) from public.playoff_rounds where season=p_season)<>4 or (select count(*) from public.playoff_games g join public.playoff_rounds r on r.id=g.round_id where r.season=p_season)<>13 then raise exception 'Complete playoff season required'; end if;
  if sb.status='scored' then
   state:=public.playoff_scoring_state(p_season);
   perform public.publish_playoff_scoring(p_season,sb.id,'finalize',state,'[]',null);
  end if;
  if exists(select 1 from public.playoff_rounds r where r.season=p_season and (r.status<>'finalized' or not exists(select 1 from public.playoff_round_runs where round_id=r.id and finalized_at is not null))) then raise exception 'Finalized publications required'; end if;
  update public.seasons set ended_at=clock_timestamp() where season=p_season;
  update public.settings set phase='offseason' where id=1;
 elsif p_action in ('prepare','participants','start') then
  if s.phase<>'offseason' or p_season is distinct from s.current_season+1 then raise exception 'Next season during offseason only'; end if;
  if p_action='prepare' then
   if exists(select 1 from public.seasons where season=p_season) then raise exception 'Season already prepared; no overwrite'; end if;
   if jsonb_typeof(p_payload->'games') is distinct from 'array' or jsonb_array_length(p_payload->'games')=0 then raise exception 'Complete calendar required'; end if;
   if exists(select 1 from public.games where season=p_season) then raise exception 'Existing future games preserved'; end if;
   insert into public.seasons(season,prepared_at) values(p_season,clock_timestamp());
   for prepared_game in select * from jsonb_to_recordset(p_payload->'games') as x(external_game_id text,week integer,game_date timestamptz,home_team text,away_team text) loop
    if prepared_game.external_game_id is null or prepared_game.external_game_id !~ '^[0-9]+$' or prepared_game.week is null or prepared_game.week<1 or prepared_game.game_date is null or prepared_game.game_date<=clock_timestamp() or prepared_game.home_team is not distinct from prepared_game.away_team or not exists(select 1 from public.teams where name=prepared_game.home_team) or not exists(select 1 from public.teams where name=prepared_game.away_team) then raise exception 'Invalid prepared calendar'; end if;
    insert into public.games(external_game_id,season,week,season_type,game_date,home_team,away_team,is_pool_eligible) values(prepared_game.external_game_id,p_season,prepared_game.week,'regular',prepared_game.game_date,prepared_game.home_team,prepared_game.away_team,(extract(dow from prepared_game.game_date at time zone 'America/Toronto')<>0 or extract(hour from prepared_game.game_date at time zone 'America/Toronto')<12 or extract(hour from prepared_game.game_date at time zone 'America/Toronto')>=19));
   end loop;
   if not exists(select 1 from public.games where season=p_season and week=1) then raise exception 'Week one required'; end if;
  elsif p_action='participants' then
   if not exists(select 1 from public.seasons where season=p_season and prepared_at is not null and started_at is null) then raise exception 'Prepared season required'; end if;
   if jsonb_typeof(p_payload->'participants') is distinct from 'array' then raise exception 'Participant list required'; end if;
   count_players:=jsonb_array_length(p_payload->'participants');
   if exists(select 1 from jsonb_to_recordset(p_payload->'participants') as x(user_id uuid,initial_order integer) where initial_order is null or initial_order<1 or initial_order>count_players or not exists(select 1 from public.users where id=x.user_id)) then raise exception 'Invalid participant/order'; end if;
   delete from public.season_participants where season=p_season;
   insert into public.season_participants(season,user_id,confirmed,initial_order) select p_season,user_id,true,initial_order from jsonb_to_recordset(p_payload->'participants') as x(user_id uuid,initial_order integer);
   update public.seasons set participants_confirmed_at=case when count_players>0 then clock_timestamp() else null end where season=p_season;
  else
   if not exists(select 1 from public.seasons where season=p_season and prepared_at is not null and participants_confirmed_at is not null and started_at is null) then raise exception 'Prepared season and confirmed participants required'; end if;
   select count(*) into count_players from public.season_participants where season=p_season and confirmed;
   if count_players=0 or (select array_agg(initial_order order by initial_order) from public.season_participants where season=p_season and confirmed) is distinct from array(select generate_series(1,count_players)) then raise exception 'Complete initial order required'; end if;
   if not exists(select 1 from public.games where season=p_season and week=1 and is_pool_eligible) or exists(select 1 from public.games where season=p_season and (game_date is null or game_date<=clock_timestamp() or season_type<>'regular' or home_score is not null or away_score is not null)) then raise exception 'Unstarted calendar required'; end if;
   update public.settings set current_season=p_season,current_week=1,phase='regular',regular_finalized_at=null where id=1;
   update public.seasons set started_at=clock_timestamp() where season=p_season;
   insert into public.qb_selection_weeks(season,week,started_at) values(p_season,1,clock_timestamp());
  end if;
 else raise exception 'Unknown lifecycle action'; end if;
 -- Also invalidate stale Admin confirmations after preparation/list edits.
 if p_action in ('prepare','participants') then update public.settings set revision=revision where id=1; end if;
 return jsonb_build_object('season',p_season,'action',p_action);
end $$;
revoke all on function public.manage_season_lifecycle(text,integer,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manage_season_lifecycle(text,integer,bigint,uuid,jsonb) to service_role;
create or replace function public.queue_pool_reminder(p_event jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare kind text:=p_event->>'notification_type';
begin
 if kind not in('regular_five_hour','playoff_open','playoff_h24','playoff_morning') or kind is null or
   p_event->>'event_key' is null or p_event->>'user_id' is null or p_event->>'scheduled_for' is null or
   jsonb_typeof(p_event->'reminder_context') is distinct from 'object' then raise exception 'Invalid reminder'; end if;
 if not public.lifecycle_notification_allowed(kind) then return; end if;
 insert into public.push_notification_events(event_key,user_id,notification_type,week,scheduled_for,status,reminder_context,season)
 values(p_event->>'event_key',(p_event->>'user_id')::uuid,kind,(p_event->>'week')::integer,(p_event->>'scheduled_for')::timestamptz,'pending',p_event->'reminder_context',(p_event->>'season')::integer)
 on conflict(event_key) do update set
   scheduled_for=case when kind in('playoff_h24','playoff_morning') then excluded.scheduled_for else public.push_notification_events.scheduled_for end,
   reminder_context=case when kind in('playoff_h24','playoff_morning') then excluded.reminder_context else public.push_notification_events.reminder_context end
 where public.push_notification_events.reminder_attempted_at is null and public.push_notification_events.reminder_cancelled_at is null and public.push_notification_events.sent_at is null;
end $$;
revoke all on function public.queue_pool_reminder(jsonb) from public,anon,authenticated;
grant execute on function public.queue_pool_reminder(jsonb) to service_role;


create or replace function public.claim_pool_reminder(p_event_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare e public.push_notification_events; r public.playoff_rounds; kickoff timestamptz; local_clock time;
begin
 select * into e from public.push_notification_events where event_key=p_event_key for update;
 if e.event_key is null or e.notification_type not in('regular_five_hour','playoff_open','playoff_h24','playoff_morning') or
   e.reminder_context is null or e.status<>'pending' or e.sent_at is not null or e.reminder_attempted_at is not null or e.reminder_cancelled_at is not null or e.scheduled_for>now() then return false; end if;
 if not public.lifecycle_notification_allowed(e.notification_type) then return false; end if;
 if not exists(select 1 from public.users where id=e.user_id) then return false; end if;
 if e.notification_type='regular_five_hour' then
  if not exists(select 1 from public.settings where current_week=e.week and current_season=e.season) or not exists(select 1 from public.season_participants where season=e.season and user_id=e.user_id and confirmed) or
    not exists(select 1 from public.qb_selection_weeks where season=e.season and week=e.week and started_at=(e.reminder_context->>'cycle')::timestamptz) or
    exists(select 1 from public.qb_picks where season=e.season and week=e.week and user_id=e.user_id) or
    exists(select 1 from public.games where season=e.season and week=e.week and is_pool_eligible=true and game_date<=now()) then return false; end if;
  local_clock:=(now() at time zone 'America/Toronto')::time;
  if local_clock>='22:00'::time or local_clock<'08:30'::time then return false; end if;
 else
  select * into r from public.playoff_rounds where id=(e.reminder_context->>'round_id')::bigint for share;
  if r.id is null or r.season<>(select current_season from public.settings where id=1) or r.status<>'open' then return false; end if;
  select min(game_date) into kickoff from public.playoff_games where round_id=r.id and external_game_id ~ '^[0-9]+$';
  if kickoff is null or kickoff<=now() or exists(select 1 from public.playoff_games where round_id=r.id and game_status in('in','post')) then return false; end if;
  if e.notification_type='playoff_h24' and (kickoff-interval '24 hours'>now() or kickoff-interval '24 hours'<r.reminder_opened_at) then return false; end if;
  if e.notification_type='playoff_morning' and (((kickoff at time zone 'America/Toronto')::date+time '08:30') at time zone 'America/Toronto'>now() or
    ((kickoff at time zone 'America/Toronto')::date+time '08:30') at time zone 'America/Toronto'<r.reminder_opened_at) then return false; end if;
  if e.notification_type<>'playoff_open' and
    exists(select 1 from public.playoff_qb_picks where round_id=r.id and user_id=e.user_id and (r.round_key<>'super_bowl' or super_bowl_total is not null)) and
    exists(select 1 from public.playoff_team_paths where round_id=r.id and user_id=e.user_id) and
    not exists(select 1 from public.playoff_games g where round_id=r.id and not exists(select 1 from public.playoff_picks p where p.game_id=g.id and p.user_id=e.user_id)) then return false; end if;
 end if;
 update public.push_notification_events set reminder_attempted_at=clock_timestamp() where event_key=e.event_key;
 return true;
end $$;
revoke all on function public.claim_pool_reminder(text) from public,anon,authenticated;
grant execute on function public.claim_pool_reminder(text) to service_role;


create function public.guard_regular_notification_season() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.notification_type in ('qb_turn','qb_final','rankings_updated','regular_five_hour') and
  (not exists(select 1 from public.settings where id=1 and phase='regular' and current_season=new.season and regular_finalized_at is null) or
   not exists(select 1 from public.season_participants where season=new.season and user_id=new.user_id and confirmed)) then return null; end if;
 return new;
end $$;
create trigger regular_notification_season before insert or update on public.push_notification_events for each row execute function public.guard_regular_notification_season();
revoke all on function public.guard_regular_notification_season() from public,anon,authenticated,service_role;
commit;
