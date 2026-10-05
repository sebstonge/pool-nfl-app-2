-- REVIEW / MANUAL ONLY. Requires 202610040001; never replay earlier migrations.
begin;
create table if not exists public.regular_final_publications (
 season integer primary key,
 version integer not null check(version=1),
 lifecycle_revision bigint not null,
 published_at timestamptz not null default clock_timestamp(),
 published_by uuid not null,
 request jsonb not null,
 evidence jsonb not null,
 source jsonb not null,
 results jsonb not null
);
alter table public.regular_final_publications enable row level security;
revoke all on public.regular_final_publications from public,anon,authenticated,service_role;
grant select on public.regular_final_publications to service_role;

-- Canonical full source identity, not a browser flag. The legacy week-only
-- tables are deliberately included in full; mixed-season picks fail preparation.
create or replace function public.regular_publication_state(p_season integer)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'settings',(select to_jsonb(s) from public.settings s where s.id=1 and s.current_season=p_season),
 'games',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.games g where g.season=p_season),'[]'),
 'picks',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.picks p),'[]'),
 'qb_picks',coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from public.qb_picks q),'[]'),
 'qb_ratings',coalesce((select jsonb_agg(to_jsonb(q) order by q.id) from public.qb_ratings q),'[]'),
 'weekly_scores',coalesce((select jsonb_agg(to_jsonb(w) order by w.id) from public.weekly_scores w),'[]'),
 'qbs',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'name',q.name,'team',q.team,'espn_athlete_id',q.espn_athlete_id) order by q.id) from public.qbs q),'[]'),
 'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'espn_abbr',t.espn_abbr) order by t.id) from public.teams t),'[]'),
 'users',coalesce((select jsonb_agg(u.id order by u.id) from public.users u),'[]')
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
 if exists(select 1 from public.picks p left join public.games g on g.id=p.game_id where g.id is null or g.season<>p_season or g.season_type<>'regular' or p.picked_team not in(g.home_team,g.away_team) or p.predicted_spread<0) then raise exception 'Invalid or mixed-season picks'; end if;
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
  left join public.qb_picks qp on qp.user_id=p.user_id and qp.week=g.week
  where qp.id is null or not exists(select 1 from jsonb_array_elements(p_proof->'ratings') r where (r->>'qb_id')::uuid=qp.qb_id and (r->>'week')::int=g.week)) then raise exception 'Required final QB rating missing'; end if;
 with final_games as(select * from jsonb_to_recordset(p_proof->'games') as x(id uuid,home_score int,away_score int)),
 pts as(select p.user_id,g.week,sum(case when p.picked_team=case when f.home_score>f.away_score then g.home_team when f.away_score>f.home_score then g.away_team else null end then case when p.predicted_spread=abs(f.home_score-f.away_score) then 2 else 1 end else 0 end)::int base_points
 from public.picks p join public.games g on g.id=p.game_id join final_games f on f.id=g.id group by p.user_id,g.week),
 scores as(select p.*,case when (r->>'passer_rating')::numeric>0 then (r->>'passer_rating')::numeric/100 else 1 end m
 from pts p join public.qb_picks qp on qp.user_id=p.user_id and qp.week=p.week join jsonb_array_elements(p_proof->'ratings') r on (r->>'qb_id')::uuid=qp.qb_id and (r->>'week')::int=p.week)
 select jsonb_agg(jsonb_build_object('user_id',user_id,'week',week,'base_points',base_points,'multiplier',round(m,3),'final_score',round(base_points*m,3)) order by week,user_id) into calculated from scores;
 if calculated is null or calculated is distinct from p_proof->'results' then raise exception 'Final recalculation mismatch'; end if;
 if exists(select 1 from public.weekly_scores w where not exists(select 1 from jsonb_array_elements(calculated) r where (r->>'user_id')::uuid=w.user_id and (r->>'week')::int=w.week)) then raise exception 'Unattributed historical weekly scores: no destructive cleanup'; end if;
 update public.games g set home_score=x.home_score,away_score=x.away_score from jsonb_to_recordset(p_proof->'games') as x(id uuid,home_score int,away_score int) where g.id=x.id;
 insert into public.qb_ratings(qb_id,week,passer_rating,actual_qb_name,actual_espn_athlete_id)
 select qb_id,week,passer_rating,actual_qb_name,actual_espn_athlete_id from jsonb_to_recordset(p_proof->'ratings') as x(qb_id uuid,week int,passer_rating numeric,actual_qb_name text,actual_espn_athlete_id text)
 on conflict(qb_id,week) do update set passer_rating=excluded.passer_rating,actual_qb_name=excluded.actual_qb_name,actual_espn_athlete_id=excluded.actual_espn_athlete_id;
 insert into public.weekly_scores(user_id,week,base_points,multiplier,final_score)
 select user_id,week,base_points,multiplier,final_score from jsonb_to_recordset(calculated) as x(user_id uuid,week int,base_points int,multiplier numeric,final_score numeric)
 on conflict(user_id,week) do update set base_points=excluded.base_points,multiplier=excluded.multiplier,final_score=excluded.final_score;
 select jsonb_agg(jsonb_build_object('user_id',user_id,'week',week,'base_points',base_points,'multiplier',multiplier,'final_score',final_score) order by week,user_id) into actual from public.weekly_scores;
 if actual is distinct from calculated then raise exception 'Persisted final results mismatch'; end if;
 if exists(select 1 from jsonb_to_recordset(p_proof->'games') as x(id uuid,home_score int,away_score int)
   left join public.games g on g.id=x.id where g.id is null or g.home_score is distinct from x.home_score or g.away_score is distinct from x.away_score) then raise exception 'Persisted final games mismatch'; end if;
 if exists(select 1 from jsonb_to_recordset(p_proof->'ratings') as x(qb_id uuid,week int,passer_rating numeric,actual_qb_name text,actual_espn_athlete_id text)
   left join public.qb_ratings r on r.qb_id=x.qb_id and r.week=x.week where r.id is null or r.passer_rating is distinct from x.passer_rating or r.actual_qb_name is distinct from x.actual_qb_name or r.actual_espn_athlete_id is distinct from x.actual_espn_athlete_id) then raise exception 'Persisted final ratings mismatch'; end if;
 insert into public.regular_final_publications(season,version,lifecycle_revision,published_by,request,evidence,source,results)
 values(p_season,1,p_revision,p_actor,jsonb_build_object('expected',p_expected,'proof',p_proof),p_proof,public.regular_publication_state(p_season),calculated)
 on conflict(season) do update set published_at=clock_timestamp(),version=1,lifecycle_revision=excluded.lifecycle_revision,published_by=excluded.published_by,request=excluded.request,evidence=excluded.evidence,source=excluded.source,results=excluded.results;
 return jsonb_build_object('already_published',false,'season',p_season,'published_at',(select published_at from public.regular_final_publications where season=p_season));
end $$;
revoke all on function public.publish_regular_final(integer,bigint,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_regular_final(integer,bigint,uuid,jsonb,jsonb) to service_role;
commit;
