-- MANUAL REVIEW ONLY. No remote application is authorized by this file.
-- Add final-result evidence and atomic regular publication/activation primitives.
-- Installation preserves scores, lifecycle and queue; only ranking baselines are seeded.
begin;
lock table public.games,public.picks,public.qb_picks,public.qb_ratings,public.weekly_scores,public.qbs,public.teams,public.users in share row exclusive mode;

alter table public.games add column result_status text;
alter table public.games add constraint games_result_status_valid check(result_status is null or result_status='final');
-- Existing score pairs do not prove FINAL. Deliberately no result_status backfill.

create function public.regular_pick_base_points(
 p_home_team text,p_away_team text,p_home_score integer,p_away_score integer,
 p_picked_team text,p_predicted_spread integer,p_final boolean default true
) returns integer language sql immutable security invoker set search_path='' as $$
 select case
  when p_final is distinct from true or p_home_score is null or p_away_score is null or p_home_score<0 or p_away_score<0
   or p_home_team is null or p_away_team is null or p_home_team='' or p_away_team='' or p_home_team=p_away_team
   or p_picked_team is null or p_picked_team not in(p_home_team,p_away_team) then 0
  when p_home_score=p_away_score then 1
  when p_picked_team=case when p_home_score>p_away_score then p_home_team else p_away_team end
   then case when p_predicted_spread>0 and p_predicted_spread=abs(p_home_score-p_away_score) then 2 else 1 end
  else 0 end;
$$;
revoke all on function public.regular_pick_base_points(text,text,integer,integer,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.regular_pick_base_points(text,text,integer,integer,text,integer,boolean) to service_role;

-- Match Number(value.toFixed(3)) using the exact IEEE-754 value, including
-- half cases such as 112.85 / 100. Decimal numeric round() would change scores.
create function public.regular_round_score(p_value double precision)
returns numeric language plpgsql immutable strict security invoker set search_path='' as $$
declare bytes bytea:=float8send(p_value); exponent integer; fraction numeric; mantissa numeric;
 numerator numeric; denominator numeric:=1; signum integer:=1; i integer;
begin
 exponent:=((get_byte(bytes,0) & 127)*16)+(get_byte(bytes,1) >> 4);
 if exponent=2047 then raise exception 'Finite regular score required'; end if;
 if (get_byte(bytes,0) & 128)<>0 then signum:=-1; end if;
 fraction:=get_byte(bytes,1) & 15;
 for i in 2..7 loop fraction:=fraction*256+get_byte(bytes,i); end loop;
 if exponent=0 then mantissa:=fraction;exponent:=-1074;
 else mantissa:=4503599627370496+fraction;exponent:=exponent-1075; end if;
 if mantissa=0 then return 0; end if;
 numerator:=mantissa*1000;
 if exponent>=0 then numerator:=numerator*power(2::numeric,exponent);
 else denominator:=power(2::numeric,-exponent); end if;
 return signum*div(2*numerator+denominator,2*denominator)/1000;
end $$;
revoke all on function public.regular_round_score(double precision) from public,anon,authenticated,service_role;
grant execute on function public.regular_round_score(double precision) to service_role;

create function public.guard_regular_positive_spread() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' or new.predicted_spread is distinct from old.predicted_spread or new.picked_team is distinct from old.picked_team or new.game_id is distinct from old.game_id then
  if exists(select 1 from public.games where id=new.game_id and season_type='regular') and
    (new.predicted_spread is null or new.predicted_spread<=0) then
   raise exception 'Une nouvelle sélection régulière exige un écart positif.' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_regular_positive_spread() from public,anon,authenticated,service_role;
create trigger regular_positive_spread before insert or update of predicted_spread,picked_team,game_id on public.picks
 for each row execute function public.guard_regular_positive_spread();

create or replace function public.publish_regular_final(p_season integer,p_revision bigint,p_actor uuid,p_expected jsonb,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.settings; prior public.regular_final_publications; calculated jsonb; actual jsonb; v_item jsonb; chosen jsonb; v_qb public.qb_picks; v_game public.games; n integer;
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
  select * into v_qb from public.qb_picks where season=p_season and qb_id=(v_item->>'qb_id')::uuid and week=(v_item->>'week')::int;
  if v_qb.id is null or coalesce(v_qb.selected_qb_name,'') !~ '[^[:space:]]' or coalesce(v_qb.selected_espn_athlete_id,'') !~ '[^[:space:]]' or coalesce(v_qb.selected_team,'') !~ '[^[:space:]]' then
   raise exception 'Selected QB snapshot unavailable; reviewed historical evidence required';
  end if;
  if v_item->>'selected_qb_name' is distinct from v_qb.selected_qb_name or
    v_item->>'selected_espn_athlete_id' is distinct from v_qb.selected_espn_athlete_id or
    v_item->>'selected_team' is distinct from v_qb.selected_team then
   raise exception 'Selected QB snapshot mismatch';
  end if;
  select * into v_game from public.games where id=(v_item->>'game_id')::uuid and season=p_season;
  if v_qb.id is null or v_qb.selected_team is null or v_game.id is null or v_game.week is distinct from (v_item->>'week')::int or
    v_item->>'team' is null or v_item->>'team' not in(v_game.home_team,v_game.away_team) or position(lower(v_qb.selected_team) in lower(v_item->>'team'))=0 or
    v_item->>'final_status' is distinct from 'STATUS_FINAL' or v_item->>'state' is distinct from 'post' or v_item->'completed' is distinct from 'true'::jsonb or
    jsonb_typeof(v_item->'passers') is distinct from 'array' or jsonb_array_length(v_item->'passers')=0 or
    exists(select 1 from jsonb_array_elements(v_item->'passers') x where x->>'id' is null or x->>'id' !~ '^[0-9]+$' or x->>'name' is null or
     jsonb_typeof(x->'rating') is distinct from 'number' or (x->>'rating')::numeric not between 0 and 158.3) then raise exception 'Invalid final QB evidence'; end if;
  select x into chosen from jsonb_array_elements(v_item->'passers') with ordinality e(x,ord)
   order by (case when nullif(v_qb.selected_espn_athlete_id,'') is not null then x->>'id'=v_qb.selected_espn_athlete_id else position(lower(v_qb.selected_qb_name) in lower(x->>'name'))>0 end) desc,ord limit 1;
  if v_item->>'actual_espn_athlete_id' is distinct from chosen->>'id' or v_item->>'actual_qb_name' is distinct from chosen->>'name' or
    v_item->'passer_rating' is distinct from chosen->'rating' then raise exception 'QB selection/replacement mismatch'; end if;
 end loop;
 -- Recompute independently in SQL, preserving existing regular scoring and its
 -- explicit numeric-zero rule, with NO missing-rating fallback.
 if exists(select 1 from public.picks p join public.games g on g.id=p.game_id
  left join public.qb_picks qp on qp.user_id=p.user_id and qp.week=g.week and qp.season=p_season
  where g.season=p_season and (qp.id is null or not exists(select 1 from jsonb_array_elements(p_proof->'ratings') r where (r->>'qb_id')::uuid=qp.qb_id and (r->>'week')::int=g.week))) then raise exception 'Required final QB rating missing'; end if;
 with final_games as(select * from jsonb_to_recordset(p_proof->'games') as x(id uuid,home_score int,away_score int)),
 pts as(select p.user_id,g.week,sum(public.regular_pick_base_points(g.home_team,g.away_team,f.home_score,f.away_score,p.picked_team,p.predicted_spread,true))::int base_points
 from public.picks p join public.games g on g.id=p.game_id join final_games f on f.id=g.id group by p.user_id,g.week),
 scores as(select p.*,case when (r->>'passer_rating')::numeric>0 then (r->>'passer_rating')::double precision/100::double precision else 1::double precision end m
 from pts p join public.qb_picks qp on qp.user_id=p.user_id and qp.week=p.week and qp.season=p_season join jsonb_array_elements(p_proof->'ratings') r on (r->>'qb_id')::uuid=qp.qb_id and (r->>'week')::int=p.week)
 select jsonb_agg(jsonb_build_object('user_id',user_id,'week',week,'base_points',base_points,'multiplier',public.regular_round_score(m),'final_score',public.regular_round_score(base_points*m)) order by week,user_id) into calculated from scores;
 if calculated is null or calculated is distinct from p_proof->'results' then raise exception 'Final recalculation mismatch'; end if;
 if exists(select 1 from public.weekly_scores w where w.season=p_season and not exists(select 1 from jsonb_array_elements(calculated) r where (r->>'user_id')::uuid=w.user_id and (r->>'week')::int=w.week)) then raise exception 'Unattributed historical weekly scores: no destructive cleanup'; end if;
 update public.games g set home_score=x.home_score,away_score=x.away_score,result_status='final' from jsonb_to_recordset(p_proof->'games') as x(id uuid,home_score int,away_score int) where g.id=x.id;
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


create function public.regular_week_ranking_state(p_season integer,p_week integer)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'settings',(select to_jsonb(s) from public.settings s where id=1),
  'games',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.games g where g.season=p_season and g.week=p_week),'[]'::jsonb),
  'picks',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.picks p join public.games g on g.id=p.game_id where g.season=p_season and g.week=p_week),'[]'::jsonb),
  'qb_picks',coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from public.qb_picks q where q.season=p_season and q.week=p_week),'[]'::jsonb),
  'qb_ratings',coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from public.qb_ratings q where q.season=p_season and q.week=p_week),'[]'::jsonb),
  'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.user_id) from public.season_participants p where p.season=p_season and p.confirmed),'[]'::jsonb)
 );
$$;
revoke all on function public.regular_week_ranking_state(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.regular_week_ranking_state(integer,integer) to service_role;

create table public.regular_ranking_versions (
 season integer not null references public.seasons(season),
 week integer not null check(week>0),
 version bigint not null check(version>=0),
 fingerprint text not null,
 primary key(season,week)
);
alter table public.regular_ranking_versions enable row level security;
revoke all on public.regular_ranking_versions from public,anon,authenticated,service_role;
grant select on public.regular_ranking_versions to service_role;

-- Canonical fingerprint identity is ONLY (user_id, final_score, ordinal rank).
-- trim_scale makes 1, 1.0 and 1.000 the same published score.
-- Mirror lib/seasons/rankings.mjs rankWeeklyScores: stable score-only sort,
-- preserving the input sequence for ties, then ordinal positions (not shared ranks).
-- Read the SAME whole-season ORDER BY week source as the regular rankings page.
-- Its within-week input order has no additional business tie-break. user_id below
-- only canonicalizes JSON serialization; it never determines a player's rank.
create function public.regular_published_ranking(p_season integer,p_week integer)
returns jsonb language sql stable security definer set search_path='' as $$
 with source_rows as materialized (
  select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) rows
  from (select * from public.weekly_scores where season=p_season order by week asc) w
 ), inputs as (
  select (item->>'user_id')::uuid user_id,
   coalesce((item->>'final_score')::numeric,0) final_score,source_position
  from source_rows cross join lateral jsonb_array_elements(rows) with ordinality as e(item,source_position)
  where (item->>'week')::integer=p_week
 ), ranked as (
  select user_id,final_score,row_number() over(order by final_score desc,source_position) position
  from inputs
 )
 select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'final_score',trim_scale(coalesce(final_score,0)),
  'rank',position) order by user_id),'[]'::jsonb)
 from ranked;
$$;
revoke all on function public.regular_published_ranking(integer,integer) from public,anon,authenticated,service_role;
-- Internal helper, executed as the owner of the publishing function.
insert into public.regular_ranking_versions(season,week,version,fingerprint)
 select season,week,0,md5(public.regular_published_ranking(season,week)::text)
 from public.weekly_scores group by season,week;

alter table public.push_notification_events add column ranking_payload jsonb;
alter table public.push_notification_events add column ranking_attempted_at timestamptz;
alter table public.push_notification_events add constraint ranking_payload_object check(ranking_payload is null or jsonb_typeof(ranking_payload)='object');
create index regular_ranking_notifications_due on public.push_notification_events(scheduled_for)
 where notification_type='rankings_updated' and status='pending' and sent_at is null and ranking_attempted_at is null;

create function public.guard_regular_ranking_notification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.notification_type='rankings_updated' then
  if new.event_key is distinct from old.event_key or new.user_id is distinct from old.user_id or
    new.week is distinct from old.week or new.season is distinct from old.season or new.notification_type is distinct from old.notification_type then
   raise exception 'Ranking notification identity is immutable';
  end if;
  if old.ranking_payload is not null and new.ranking_payload is distinct from old.ranking_payload then
   raise exception 'Published ranking payload is immutable';
  end if;
  if old.ranking_attempted_at is not null and new.ranking_attempted_at is distinct from old.ranking_attempted_at then
   raise exception 'Ranking delivery claim cannot be reset';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_regular_ranking_notification() from public,anon,authenticated,service_role;
create trigger regular_ranking_notification_immutable before update on public.push_notification_events
 for each row execute function public.guard_regular_ranking_notification();

create function public.publish_regular_week(
 p_season integer,p_week integer,p_revision bigint,p_actor uuid,p_expected jsonb,p_results jsonb,p_scheduled_for timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 s public.settings; calculated jsonb; vector jsonb; prior_vector jsonb; current_fingerprint text;
 prior public.regular_ranking_versions; initialized boolean:=false; changed boolean:=false; next_version bigint;
 person jsonb; updated_count integer;
begin
 -- Same sources-before-settings order as lifecycle/final publication; queue locks
 -- also precede settings so claimers never deadlock with a publisher.
 lock table public.games,public.picks,public.qb_picks,public.qb_ratings,public.weekly_scores,public.qbs,public.teams,public.users in share row exclusive mode;
 lock table public.season_participants,public.regular_ranking_versions,public.push_notification_events in share row exclusive mode;
 select * into s from public.settings where id=1 for update;
 if not exists(select 1 from public.users where id=p_actor and is_admin=true) then raise exception 'Administrator required' using errcode='42501'; end if;
 if s.id is null or s.current_season is distinct from p_season or s.current_week is distinct from p_week or
   s.revision is distinct from p_revision or s.phase<>'regular' or s.regular_finalized_at is not null or s.regular_writes_paused then
  raise exception 'Stale, closed or paused regular context' using errcode='40001';
 end if;
 if public.regular_week_ranking_state(p_season,p_week) is distinct from p_expected then
  raise exception 'Stale weekly ranking source' using errcode='40001';
 end if;
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
 return jsonb_build_object('updated',updated_count,'version',next_version,'changed',changed,'baseline',initialized);
end $$;
revoke all on function public.publish_regular_week(integer,integer,bigint,uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.publish_regular_week(integer,integer,bigint,uuid,jsonb,jsonb,timestamptz) to service_role;

create function public.claim_regular_ranking(p_event_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare e public.push_notification_events; s public.settings;
begin
 -- Obtain the eventual UPDATE table lock before settings, matching publication.
 lock table public.push_notification_events in row exclusive mode;
 select * into e from public.push_notification_events where event_key=p_event_key for update;
 if e.event_key is null or e.notification_type is distinct from 'rankings_updated' or e.status is distinct from 'pending' or
   e.sent_at is not null or e.ranking_attempted_at is not null or e.scheduled_for is null or e.scheduled_for>clock_timestamp() then return false; end if;
 select * into s from public.settings where id=1 for share;
 if s.id is null or s.phase<>'regular' or s.regular_finalized_at is not null or s.regular_writes_paused or
   e.season is distinct from s.current_season or not exists(select 1 from public.season_participants
    where season=s.current_season and user_id=e.user_id and confirmed) then return false; end if;
 -- Legacy payload=NULL reservations use this same claim. New payloads are frozen.
 update public.push_notification_events set ranking_attempted_at=clock_timestamp() where event_key=e.event_key;
 return true;
end $$;
revoke all on function public.claim_regular_ranking(text) from public,anon,authenticated,service_role;
grant execute on function public.claim_regular_ranking(text) to service_role;

create function public.advance_regular_week(p_season integer,p_week integer,p_revision bigint,p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.settings; target integer; opened timestamptz;
begin
 lock table public.games,public.picks,public.qb_picks,public.weekly_scores,public.users in share row exclusive mode;
 lock table public.season_participants,public.qb_selection_weeks in share row exclusive mode;
 select * into s from public.settings where id=1 for update;
 if not exists(select 1 from public.users where id=p_actor and is_admin=true) then raise exception 'Administrator required' using errcode='42501'; end if;
 if s.id is null or s.current_season is distinct from p_season or s.current_week is distinct from p_week or s.revision is distinct from p_revision or
   s.phase<>'regular' or s.regular_finalized_at is not null or s.regular_writes_paused then
  raise exception 'Stale, closed or paused regular context' using errcode='40001';
 end if;
 target:=p_week+1;
 if not exists(select 1 from public.games where season=p_season and week=target and season_type='regular' and is_pool_eligible) or
  exists(select 1 from public.games where season=p_season and week=target and
   (season_type<>'regular' or home_team=away_team or not exists(select 1 from public.teams where name=games.home_team)
    or not exists(select 1 from public.teams where name=games.away_team) or coalesce(external_game_id,'') !~ '^[0-9]+$' or game_date is null or game_date<=clock_timestamp() or home_score is not null or away_score is not null or result_status is not null)) or
  exists(select 1 from public.qb_picks where season=p_season and week=target) or
  exists(select 1 from public.weekly_scores where season=p_season and week=target) or
  exists(select 1 from public.picks p join public.games g on g.id=p.game_id where g.season=p_season and g.week=target) then
  raise exception 'Admissible unstarted next regular week required';
 end if;
 opened:=clock_timestamp();
 -- Never overwrite an existing selection clock. Failure rolls back activation.
 insert into public.qb_selection_weeks(season,week,started_at) values(p_season,target,opened);
 update public.settings set current_week=target where id=1 returning * into s;
 if s.current_week<>target or s.revision<>p_revision+1 then raise exception 'Incomplete regular activation'; end if;
 return jsonb_build_object('season',p_season,'week',target,'started_at',opened,'revision',s.revision);
end $$;
revoke all on function public.advance_regular_week(integer,integer,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.advance_regular_week(integer,integer,bigint,uuid) to service_role;
commit;
