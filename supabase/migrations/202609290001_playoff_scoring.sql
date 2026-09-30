-- Apply manually ONCE after 202609240001 and the already-applied 202609250001.
-- No remote application by the development agent. Transactional and re-runnable.
begin;
alter table public.playoff_qb_picks add column if not exists super_bowl_total integer check(super_bowl_total>=0);
alter table public.playoff_games add column if not exists test_qb_results jsonb;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='playoff_test_qb_results' and conrelid='public.playoff_games'::regclass) then
    alter table public.playoff_games add constraint playoff_test_qb_results check(test_qb_results is null or (external_game_id like 'TEST-%' and jsonb_typeof(test_qb_results)='array'));
  end if;
end $$;
create table if not exists public.playoff_round_runs (
  round_id bigint primary key references public.playoff_rounds(id),
  processed_at timestamptz not null default now(),
  source jsonb not null,
  standings jsonb not null check(jsonb_typeof(standings)='array'),
  finalized_at timestamptz
);
create table if not exists public.playoff_round_results (
  round_id bigint not null references public.playoff_round_runs(round_id),
  user_id uuid not null references public.users(id),
  round_order integer not null check(round_order between 1 and 4),
  pick_results jsonb not null check(jsonb_typeof(pick_results)='array'),
  normal_game_points integer not null check(normal_game_points>=0),
  path_team text not null,
  path_multiplier integer not null check(path_multiplier between 0 and 4),
  path_games_played integer not null check(path_games_played between 0 and 4),
  path_alive boolean not null,
  path_base_points integer not null check(path_base_points between 0 and 2),
  path_adjusted_points integer not null,
  subtotal integer not null,
  selected_qb_id bigint not null references public.qbs(id),
  qb_consumed boolean not null,
  qb_result jsonb not null,
  qb_multiplier numeric(6,3) not null check(qb_multiplier between 0 and 1.583),
  final_score numeric(12,3) not null check(final_score>=0),
  cumulative_score numeric(12,3) not null check(cumulative_score>=0),
  round_margin_error bigint not null check(round_margin_error>=0),
  cumulative_margin_error bigint not null check(cumulative_margin_error>=0),
  super_bowl_total_error integer check(super_bowl_total_error>=0),
  round_rank integer not null check(round_rank>0),
  cumulative_rank integer not null check(cumulative_rank>0),
  primary key(round_id,user_id),
  check(path_adjusted_points=path_base_points*path_multiplier),
  check(subtotal=normal_game_points+path_adjusted_points),
  check((qb_result->>'passer_rating')::numeric between 0 and 158.3),
  check(qb_result ?& array['passer_rating','actual_espn_athlete_id','actual_qb_name','consumed','dnp']),
  check(qb_consumed=(qb_result->>'consumed')::boolean),
  check(final_score=round(subtotal*(qb_result->>'passer_rating')::numeric/100,3))
);
create index if not exists playoff_results_user on public.playoff_round_results(user_id,round_id);
alter table public.playoff_round_runs enable row level security;
alter table public.playoff_round_results enable row level security;
revoke all on public.playoff_round_runs,public.playoff_round_results from public,anon,authenticated,service_role;
-- Source includes picks; it is private to the protected RPC, not public SELECT.
grant select(round_id,processed_at,standings,finalized_at) on public.playoff_round_runs to authenticated;
grant select on public.playoff_round_results to authenticated;
grant select on public.playoff_round_runs,public.playoff_round_results to service_role;
drop policy if exists playoff_runs_read on public.playoff_round_runs;
create policy playoff_runs_read on public.playoff_round_runs for select to authenticated using(true);
drop policy if exists playoff_results_read on public.playoff_round_results;
create policy playoff_results_read on public.playoff_round_results for select to authenticated using(true);

create or replace function public.playoff_scoring_state(p_season integer)
returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
 'rounds',coalesce((select jsonb_agg(to_jsonb(r) order by id) from public.playoff_rounds r where season=p_season),'[]'),
 'games',coalesce((select jsonb_agg(to_jsonb(g) order by g.id) from public.playoff_games g join public.playoff_rounds r on r.id=g.round_id where r.season=p_season),'[]'),
 'picks',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.playoff_picks p join public.playoff_games g on g.id=p.game_id join public.playoff_rounds r on r.id=g.round_id where r.season=p_season),'[]'),
 'qbPicks',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.playoff_qb_picks p join public.playoff_rounds r on r.id=p.round_id where r.season=p_season),'[]'),
 'paths',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.playoff_team_paths p join public.playoff_rounds r on r.id=p.round_id where r.season=p_season),'[]'),
 'seeds',coalesce((select jsonb_agg(to_jsonb(s) order by conference,seed) from public.playoff_seeds s where season=p_season),'[]'),
 'qbs',coalesce((select jsonb_agg(to_jsonb(q) order by id) from public.qbs q),'[]'),
 'teams',coalesce((select jsonb_agg(to_jsonb(t) order by name) from public.teams t),'[]'),
 'results',coalesce((select jsonb_agg(to_jsonb(s) order by s.round_id,s.user_id) from public.playoff_round_results s join public.playoff_rounds r on r.id=s.round_id where r.season=p_season),'[]'),
 'runs',coalesce((select jsonb_agg(jsonb_build_object('round_id',s.round_id,'processed_at',s.processed_at,'standings',s.standings,'finalized_at',s.finalized_at) order by s.round_id) from public.playoff_round_runs s join public.playoff_rounds r on r.id=s.round_id where r.season=p_season),'[]')
); $$;
revoke all on function public.playoff_scoring_state(integer) from public,anon,authenticated;
grant execute on function public.playoff_scoring_state(integer) to service_role;

-- Immutable even to service_role/direct SQL. Locks also serialize direct writes
-- with publication/finalization (all RPCs use the same table lock order).
create or replace function public.guard_finalized_playoff() returns trigger
language plpgsql set search_path='' as $$
declare old_round bigint; new_round bigint;
begin
 if tg_table_name='playoff_rounds' then
   if tg_op<>'INSERT' and old.status='finalized' then raise exception 'Finalized round is immutable'; end if;
   if tg_op<>'DELETE' and new.status='finalized' and not exists(select 1 from public.playoff_round_runs where round_id=new.id and finalized_at is not null) then raise exception 'Calculated publication must be finalized first'; end if;
   return case when tg_op='DELETE' then old else new end;
 end if;
 if tg_table_name='playoff_picks' then
   if tg_op<>'INSERT' then select round_id into old_round from public.playoff_games where id=old.game_id; end if;
   if tg_op<>'DELETE' then select round_id into new_round from public.playoff_games where id=new.game_id; end if;
 else
   if tg_op<>'INSERT' then old_round:=old.round_id; end if;
   if tg_op<>'DELETE' then new_round:=new.round_id; end if;
 end if;
 perform 1 from public.playoff_rounds where id in(old_round,new_round) for share;
 if exists(select 1 from public.playoff_rounds where id in(old_round,new_round) and status='finalized') then raise exception 'Finalized round is immutable'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare t text; begin
 foreach t in array array['playoff_rounds','playoff_games','playoff_picks','playoff_qb_picks','playoff_team_paths','playoff_round_runs','playoff_round_results'] loop
   execute format('drop trigger if exists guard_finalized_playoff on public.%I',t);
   execute format('create trigger guard_finalized_playoff before insert or update or delete on public.%I for each row execute function public.guard_finalized_playoff()',t);
 end loop;
end $$;

-- TRUNCATE bypasses row triggers; reject it explicitly for protected snapshots.
create or replace function public.guard_playoff_truncate() returns trigger
language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.playoff_rounds where status='finalized') then raise exception 'Finalized rounds are immutable; truncate refused'; end if;
 return null;
end $$;
do $$ declare t text; begin
 foreach t in array array['playoff_rounds','playoff_games','playoff_picks','playoff_qb_picks','playoff_team_paths','playoff_round_runs','playoff_round_results'] loop
  execute format('drop trigger if exists guard_playoff_truncate on public.%I',t);
  execute format('create trigger guard_playoff_truncate before truncate on public.%I execute function public.guard_playoff_truncate()',t);
 end loop;
end $$;

create or replace function public.publish_playoff_scoring(p_season integer,p_round_id bigint,p_action text,p_expected jsonb,p_updates jsonb,p_publication jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.playoff_rounds; state jsonb; g record; participants integer; source jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(20260924,p_season);
 lock table public.playoff_rounds,public.playoff_games,public.playoff_picks,public.playoff_qb_picks,public.playoff_team_paths,public.playoff_round_runs,public.playoff_round_results in share row exclusive mode;
 state:=public.playoff_scoring_state(p_season);
 if state is distinct from p_expected then raise exception 'Stale scoring snapshot; reload'; end if;
 select * into r from public.playoff_rounds where id=p_round_id and season=p_season;
 if r.id is null or r.status not in ('open','locked','scored') then raise exception 'Active non-finalized round required'; end if;
 if exists(select 1 from public.playoff_rounds x where season=p_season and round_order<r.round_order and (status<>'finalized' or not exists(select 1 from public.playoff_round_runs where round_id=x.id and finalized_at is not null))) or
    (select count(*) from public.playoff_rounds where season=p_season and round_order<r.round_order)<>r.round_order-1 or
    exists(select 1 from public.playoff_rounds where season=p_season and round_order>r.round_order and status<>'draft') then raise exception 'Invalid scored round chain'; end if;
 if p_action='finalize' then
   if r.status<>'scored' or not exists(select 1 from public.playoff_round_runs where round_id=r.id and playoff_round_runs.source=(state-'runs'-'results')) or
     not exists(select 1 from public.playoff_round_results where round_id=r.id) or
     exists(select 1 from public.playoff_games where round_id=r.id and game_status is distinct from 'post') then raise exception 'Complete current publication required before finalization'; end if;
   update public.playoff_round_runs set finalized_at=clock_timestamp() where round_id=r.id;
   update public.playoff_rounds set status='finalized',updated_at=clock_timestamp() where id=r.id;
   return;
 end if;
 if p_action is distinct from 'update' or jsonb_typeof(p_updates) is distinct from 'array' then raise exception 'Invalid scoring action'; end if;
 for g in select * from jsonb_to_recordset(p_updates) as x(id bigint,external_game_id text,game_status text,home_score integer,away_score integer) loop
   if not exists(select 1 from public.playoff_games where id=g.id and round_id=r.id and external_game_id=g.external_game_id and external_game_id ~ '^[0-9]+$' and
      (game_status is distinct from 'post' or g.game_status='post') and (game_status is distinct from 'in' or g.game_status<>'pre')) or g.game_status is null or g.game_status not in ('pre','in','post') then raise exception 'Invalid ESPN update (TEST preserved)'; end if;
   update public.playoff_games set game_status=g.game_status,home_score=g.home_score,away_score=g.away_score,updated_at=clock_timestamp() where id=g.id;
 end loop;
 delete from public.playoff_round_results where round_id=r.id;
 delete from public.playoff_round_runs where round_id=r.id;
 if p_publication is null then
   update public.playoff_rounds set status=case when exists(select 1 from public.playoff_games where round_id=r.id and (game_date<=now() or game_status in('in','post'))) then 'locked' else 'open' end,updated_at=clock_timestamp() where id=r.id;
   return;
 end if;
 if jsonb_typeof(p_publication->'results') is distinct from 'array' or jsonb_typeof(p_publication->'standings') is distinct from 'array' or
   not exists(select 1 from public.playoff_games where round_id=r.id) or
   exists(select 1 from public.playoff_games where round_id=r.id and game_status is distinct from 'post') then raise exception 'FINAL games and complete results required'; end if;
 select count(*) into participants from (select user_id from public.playoff_qb_picks where round_id=r.id union select user_id from public.playoff_team_paths where round_id=r.id union select p.user_id from public.playoff_picks p join public.playoff_games gm on gm.id=p.game_id where gm.round_id=r.id) u;
 if participants=0 or jsonb_array_length(p_publication->'results')<>participants then raise exception 'Incomplete participants'; end if;
 update public.playoff_rounds set status='scored',updated_at=clock_timestamp() where id=r.id;
 source:=public.playoff_scoring_state(p_season)-'runs'-'results';
 insert into public.playoff_round_runs(round_id,source,standings) values(r.id,source,p_publication->'standings');
 if exists(select 1 from jsonb_array_elements(p_publication->'results') x where (x->>'round_id')::bigint is distinct from r.id) then raise exception 'Wrong publication round'; end if;
 insert into public.playoff_round_results select * from jsonb_populate_recordset(null::public.playoff_round_results,p_publication->'results');
 if exists(select 1 from public.playoff_round_results s where s.round_id=r.id and (s.round_order<>r.round_order or
   jsonb_array_length(s.pick_results)<>(select count(*) from public.playoff_games where round_id=r.id) or
   not exists(select 1 from public.playoff_qb_picks where round_id=r.id and user_id=s.user_id and qb_id=s.selected_qb_id) or
   not exists(select 1 from public.playoff_team_paths where round_id=r.id and user_id=s.user_id and team=s.path_team))) then raise exception 'Incoherent publication'; end if;
end $$;
revoke all on function public.publish_playoff_scoring(integer,bigint,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_playoff_scoring(integer,bigint,text,jsonb,jsonb,jsonb) to service_role;

create or replace function public.manage_playoff_round(
  p_season integer, p_action text, p_round_key text, p_games jsonb, p_expected jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  keys text[] := array['wild_card','divisional','conference','super_bowl'];
  names text[] := array['Wild Card','Divisional','Finales de conférence','Super Bowl'];
  counts integer[] := array[6,4,2,1];
  n integer := array_position(keys,p_round_key);
  target integer;
  source public.playoff_rounds;
  dest public.playoff_rounds;
  actual jsonb;
  expected jsonb;
  g record;
begin
  if p_season is null or p_season not between 2000 and 9999 or n is null or
    p_action is null or p_action not in ('prepare','advance','update') or
    p_games is null or jsonb_typeof(p_games) <> 'array' or p_expected is null or
    jsonb_typeof(p_expected->'rounds') is distinct from 'array' or jsonb_typeof(p_expected->'games') is distinct from 'array'
    then raise exception 'Invalid round operation'; end if;
  -- Same lock order as the seed infrastructure. No regular-season tables touched.
  perform pg_catalog.pg_advisory_xact_lock(20260924,p_season);
  lock table public.playoff_rounds, public.playoff_games in share row exclusive mode;
  if (select count(*)<>14 or count(finalized_at)<>14 or count(distinct finalized_at)<>1 or
      count(*) filter(where conference='AFC')<>7 or count(*) filter(where conference='NFC')<>7
      from public.playoff_seeds where season=p_season) then raise exception 'Finalized seeds required'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into actual from public.playoff_rounds r where season=p_season;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into expected
    from jsonb_populate_recordset(null::public.playoff_rounds,p_expected->'rounds') r;
  if actual<>expected then raise exception 'Stale rounds'; end if;
  select coalesce(jsonb_agg(to_jsonb(gm) order by gm.id),'[]') into actual from public.playoff_games gm
    join public.playoff_rounds r on r.id=gm.round_id where r.season=p_season;
  select coalesce(jsonb_agg(to_jsonb(gm) order by gm.id),'[]') into expected
    from jsonb_populate_recordset(null::public.playoff_games,p_expected->'games') gm;
  if actual<>expected then raise exception 'Stale games'; end if;
  if exists(select 1 from public.playoff_rounds where season=p_season and
      (round_key<>keys[round_order] or (round_order<n and status<>'finalized') or (round_order>n and status<>'draft'))) or
    (select count(*) from public.playoff_rounds where season=p_season and round_order<n)<>n-1
    then raise exception 'Inconsistent round chain'; end if;
  select * into source from public.playoff_rounds where season=p_season and round_key=p_round_key;
  if exists(select 1 from public.playoff_games where round_id=source.id and
      (external_game_id is null or external_game_id !~ '^[0-9]+$')) then raise exception 'TEST/non-official games preserved'; end if;

  if p_action='update' then raise exception 'Use publish_playoff_scoring for complete updates'; end if;
  if p_action='prepare' and (n<>1 or exists(select 1 from public.playoff_games where round_id=source.id))
    then raise exception 'Only empty Wild Card can be initialized'; end if;
  target := case when p_action='advance' then n+1 else n end;
  if target>4 then raise exception 'Super Bowl is the final round'; end if;
  if p_action='advance' and (source.id is null or source.status<>'finalized' or
    not exists(select 1 from public.playoff_round_runs where round_id=source.id and finalized_at is not null) or
    not exists(select 1 from public.playoff_round_results where round_id=source.id) or
    (select count(*) from public.playoff_games where round_id=source.id)<>counts[n] or
    exists(select 1 from public.playoff_games where round_id=source.id and game_status is distinct from 'post'))
    then raise exception 'All current games must be FINAL'; end if;
  select * into dest from public.playoff_rounds where season=p_season and round_key=keys[target];
  if dest.id is not null and dest.status<>'draft' then raise exception 'Target must be draft'; end if;
  if jsonb_array_length(p_games)<>counts[target] then raise exception 'Incomplete official matchups'; end if;
  if (select count(distinct external_game_id)<>counts[target] from jsonb_to_recordset(p_games) as x(external_game_id text)) or
    (select count(distinct team)<>counts[target]*2 from (
      select value->>'home_team' as team from jsonb_array_elements(p_games)
      union all select value->>'away_team' from jsonb_array_elements(p_games)) t)
    then raise exception 'Duplicate matchups'; end if;
  for g in select * from jsonb_to_recordset(p_games) as x(external_game_id text,game_date timestamptz,home_team text,away_team text) loop
    if g.external_game_id is null or g.external_game_id !~ '^[0-9]+$' or g.game_date is null or g.game_date<=now() or
      not exists(select 1 from public.playoff_seeds where season=p_season and team=g.home_team) or
      not exists(select 1 from public.playoff_seeds where season=p_season and team=g.away_team)
      then raise exception 'Invalid official game'; end if;
    if exists(select 1 from public.playoff_games where external_game_id=g.external_game_id and
      (round_id is distinct from dest.id or home_team<>g.home_team or away_team<>g.away_team)) then raise exception 'Existing game conflict'; end if;
  end loop;
  if exists(select 1 from public.playoff_games old where old.round_id=dest.id and
      (old.game_status in ('in','post') or not exists(select 1 from jsonb_array_elements(p_games) x where x->>'external_game_id'=old.external_game_id)))
    then raise exception 'Existing games preserved'; end if;
  if dest.id is null then
    insert into public.playoff_rounds(season,round_key,round_name,round_order,status)
      values(p_season,keys[target],names[target],target,'draft') returning * into dest;
  end if;
  insert into public.playoff_games(round_id,external_game_id,game_date,home_team,away_team,game_status)
    select dest.id,external_game_id,game_date,home_team,away_team,'pre'
      from jsonb_to_recordset(p_games) as x(external_game_id text,game_date timestamptz,home_team text,away_team text)
    on conflict(external_game_id) do update set game_date=excluded.game_date,game_status='pre',updated_at=clock_timestamp();
  update public.playoff_rounds set status='open',updated_at=clock_timestamp() where id=dest.id;
end;
$$;

revoke all on function public.manage_playoff_round(integer,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.manage_playoff_round(integer,text,text,jsonb,jsonb) to service_role;

-- Ordinary users submit once, atomically. No direct write may bypass QB/path
-- eligibility or edit choices after publication. auth.uid() is supplied by JWT.
revoke all on public.playoff_picks,public.playoff_qb_picks,public.playoff_team_paths from public,anon,authenticated;
grant select on public.playoff_picks,public.playoff_qb_picks,public.playoff_team_paths to authenticated;
drop function if exists public.submit_playoff_round(bigint,bigint,text,jsonb);
create or replace function public.submit_playoff_round(p_round_id bigint,p_qb_id bigint,p_team text,p_picks jsonb,p_super_bowl_total integer default null)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); r public.playoff_rounds; previous public.playoff_round_results; games integer; played integer:=0; continued boolean:=false; chosen_game bigint;
begin
 if uid is null then raise exception 'Authentication required'; end if;
 select * into r from public.playoff_rounds where id=p_round_id;
 if r.id is null then raise exception 'Round missing'; end if;
 perform pg_catalog.pg_advisory_xact_lock(20260924,r.season);
 lock table public.playoff_rounds,public.playoff_games,public.playoff_picks,public.playoff_qb_picks,public.playoff_team_paths,public.playoff_round_runs,public.playoff_round_results in share row exclusive mode;
 select * into r from public.playoff_rounds where id=p_round_id;
 if (r.round_key='super_bowl' and (p_super_bowl_total is null or p_super_bowl_total<0)) or (r.round_key<>'super_bowl' and p_super_bowl_total is not null) then raise exception 'Super Bowl total required only in Super Bowl'; end if;
 if r.status<>'open' or exists(select 1 from public.playoff_games where round_id=r.id and (game_date<=now() or game_status in('in','post'))) then raise exception 'Round closed for submissions'; end if;
 if exists(select 1 from public.playoff_qb_picks where round_id=r.id and user_id=uid) or exists(select 1 from public.playoff_team_paths where round_id=r.id and user_id=uid) or exists(select 1 from public.playoff_picks p join public.playoff_games g on g.id=p.game_id where g.round_id=r.id and p.user_id=uid) then raise exception 'Submission already exists'; end if;
 if (select count(*) from public.playoff_rounds where season=r.season and round_order<r.round_order and status='finalized')<>r.round_order-1 then raise exception 'Previous rounds must be finalized'; end if;
 select count(*) into games from public.playoff_games where round_id=r.id;
 if games=0 or jsonb_typeof(p_picks) is distinct from 'array' or jsonb_array_length(p_picks)<>games or
   (select count(distinct (p->>'game_id')::bigint) from jsonb_array_elements(p_picks) p)<>games then raise exception 'All game picks required'; end if;
 if exists(select 1 from jsonb_array_elements(p_picks) p where not exists(select 1 from public.playoff_games g where g.round_id=r.id and g.id=(p->>'game_id')::bigint and p->>'picked_team' in(g.home_team,g.away_team)) or p->>'predicted_spread' is null or (p->>'predicted_spread') !~ '^[0-9]+$') then raise exception 'Invalid game pick'; end if;
 if not exists(select 1 from public.qbs q where q.id=p_qb_id and q.active=true and q.is_active_starter=true and exists(select 1 from public.playoff_games g where g.round_id=r.id and q.team in(g.home_team,g.away_team))) then raise exception 'QB ineligible'; end if;
 if exists(select 1 from public.playoff_round_results s join public.playoff_rounds pr on pr.id=s.round_id where pr.season=r.season and pr.round_order<r.round_order and s.user_id=uid and s.qb_consumed and s.selected_qb_id=p_qb_id) and
   exists(select 1 from public.qbs q where q.active=true and q.is_active_starter=true and exists(select 1 from public.playoff_games g where g.round_id=r.id and q.team in(g.home_team,g.away_team)) and not exists(select 1 from public.playoff_round_results s join public.playoff_rounds pr on pr.id=s.round_id where pr.season=r.season and pr.round_order<r.round_order and s.user_id=uid and s.qb_consumed and s.selected_qb_id=q.id)) then raise exception 'QB already used; unused eligible QB remains'; end if;
 select s.* into previous from public.playoff_round_results s join public.playoff_rounds pr on pr.id=s.round_id where pr.season=r.season and pr.round_order<r.round_order and s.user_id=uid order by pr.round_order desc limit 1;
 if previous.round_id is not null and previous.round_order<>r.round_order-1 then raise exception 'Missing previous participant result'; end if;
 if previous.path_alive then
   if p_team is distinct from previous.path_team then raise exception 'Surviving path is locked'; end if;
   continued:=true; played:=previous.path_games_played;
 end if;
 select id into chosen_game from public.playoff_games where round_id=r.id and p_team in(home_team,away_team);
 if chosen_game is null then
   if r.round_key<>'wild_card' or not exists(select 1 from public.playoff_seeds where season=r.season and team=p_team and seed=1 and finalized_at is not null) then raise exception 'Team not eligible for path'; end if;
 else
   if not exists(select 1 from jsonb_array_elements(p_picks) p where (p->>'game_id')::bigint=chosen_game and p->>'picked_team'=p_team) then raise exception 'Path team must be picked to win'; end if;
 end if;
 insert into public.playoff_qb_picks(user_id,round_id,qb_id,super_bowl_total) values(uid,r.id,p_qb_id,p_super_bowl_total);
 insert into public.playoff_team_paths(user_id,round_id,team,multiplier,continues_previous_path) values(uid,r.id,p_team,played+1,continued);
 insert into public.playoff_picks(user_id,game_id,picked_team,predicted_spread)
   select uid,(p->>'game_id')::bigint,p->>'picked_team',(p->>'predicted_spread')::integer from jsonb_array_elements(p_picks) p;
end $$;
revoke all on function public.submit_playoff_round(bigint,bigint,text,jsonb,integer) from public,anon;
grant execute on function public.submit_playoff_round(bigint,bigint,text,jsonb,integer) to authenticated;
create or replace function public.read_playoff_results(p_round_ids bigint[])
returns jsonb language sql stable set search_path='' as $$
select jsonb_build_object(
 'results',coalesce((select jsonb_agg(to_jsonb(s) order by s.round_id,s.user_id) from public.playoff_round_results s where s.round_id=any(p_round_ids)),'[]'),
 'runs',coalesce((select jsonb_agg(jsonb_build_object('round_id',r.round_id,'processed_at',r.processed_at,'standings',r.standings,'finalized_at',r.finalized_at) order by r.round_id) from public.playoff_round_runs r where r.round_id=any(p_round_ids)),'[]')
); $$;
revoke all on function public.read_playoff_results(bigint[]) from public,anon;
grant execute on function public.read_playoff_results(bigint[]) to authenticated,service_role;
commit;
