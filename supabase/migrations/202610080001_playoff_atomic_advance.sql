-- Install manually after lifecycle transition. No data/phase transition at installation.
begin;
create table public.playoff_round_advances (
 source_round_id bigint primary key references public.playoff_rounds(id),
 target_round_id bigint not null unique references public.playoff_rounds(id),
 advanced_at timestamptz not null default clock_timestamp(),
 actor uuid not null references public.users(id),
 result jsonb not null
);
alter table public.playoff_round_advances enable row level security;
revoke all on public.playoff_round_advances from public,anon,authenticated,service_role;
grant select on public.playoff_round_advances to service_role;

create function public.advance_playoff_round_atomic(
 p_season integer,p_round_key text,p_actor uuid,p_expected jsonb,p_games jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 s public.settings; src public.playoff_rounds; dest public.playoff_rounds;
 keys text[]:=array['wild_card','divisional','conference','super_bowl'];
 n integer:=array_position(keys,p_round_key); i integer; conf text; alive text[]; ranked text[];
 pairs jsonb; batch jsonb; state jsonb; pair jsonb; answer jsonb; receipt public.playoff_round_advances;
begin
 if p_season is null or n is null or n>=4 then raise exception 'No next round (Super Bowl refused)'; end if;
 perform pg_catalog.pg_advisory_xact_lock(20260924,p_season);
 -- Reference tables precede playoff tables, settings last, as in lifecycle 2B-1.
 lock table public.qbs,public.teams,public.users in share row exclusive mode;
 lock table public.playoff_seeds,public.playoff_rounds,public.playoff_games,public.playoff_picks,public.playoff_qb_picks,public.playoff_team_paths,public.playoff_round_runs,public.playoff_round_results,public.playoff_round_advances in share row exclusive mode;
 select * into s from public.settings where id=1 for update;
 if s.id is null or s.current_season is distinct from p_season or s.phase is distinct from 'playoffs' then raise exception 'Active playoffs season required'; end if;
 if not exists(select 1 from public.users where id=p_actor and is_admin=true) then raise exception 'Administrator required'; end if;
 select * into src from public.playoff_rounds where season=p_season and round_key=p_round_key;
 select * into receipt from public.playoff_round_advances where source_round_id=src.id;
 -- A source round is the stable idempotency key. Never advance a different round on retry.
 if receipt.source_round_id is not null then return receipt.result; end if;
 if src.id is null or src.status<>'scored' then raise exception 'Scored round required'; end if;
 state:=public.playoff_scoring_state(p_season);
 if p_expected is null or p_expected->'scoring' is distinct from state or
    p_expected->'context' is distinct from jsonb_build_object('id',s.id,'current_season',s.current_season,'current_week',s.current_week,'phase',s.phase,'revision',s.revision,'regular_finalized_at',s.regular_finalized_at,'playoff_reminders_enabled',s.playoff_reminders_enabled)
 then raise exception 'Stale advance snapshot'; end if;
 if exists(select 1 from public.playoff_rounds where season=p_season and (round_order not between 1 and 4 or round_key is distinct from keys[round_order] or (round_order>n and status<>'draft'))) then raise exception 'Invalid round chain'; end if;
 if (select count(*)<>14 or count(finalized_at)<>14 or count(distinct finalized_at)<>1 from public.playoff_seeds where season=p_season) then raise exception 'Frozen seeds required'; end if;
 foreach conf in array array['AFC','NFC'] loop
  if (select array_agg(seed::integer order by seed) from public.playoff_seeds where season=p_season and conference=conf) is distinct from array[1,2,3,4,5,6,7] then raise exception 'Invalid seed slots'; end if;
 end loop;
 select array_agg(team) into alive from public.playoff_seeds where season=p_season;
 -- Reconstruct the full chain from original seeds, including the #1 bye without a fake game.
 for i in 1..n+1 loop
  pairs:='[]';
  if i=4 then
   select array_agg(team order by conference) into ranked from public.playoff_seeds where season=p_season and team=any(alive);
   if cardinality(ranked)<>2 or (select count(distinct conference) from public.playoff_seeds where season=p_season and team=any(alive))<>2 then raise exception 'Conference champions required'; end if;
   pairs:=jsonb_build_array(jsonb_build_object('home_team',ranked[1],'away_team',ranked[2]));
  else
   foreach conf in array array['AFC','NFC'] loop
    select array_agg(team order by seed) into ranked from public.playoff_seeds where season=p_season and conference=conf and team=any(alive);
    if cardinality(ranked) is distinct from (case i when 1 then 7 when 2 then 4 else 2 end) then raise exception 'Invalid survivors'; end if;
    if i=1 then
     pairs:=pairs||jsonb_build_array(jsonb_build_object('home_team',ranked[2],'away_team',ranked[7]),jsonb_build_object('home_team',ranked[3],'away_team',ranked[6]),jsonb_build_object('home_team',ranked[4],'away_team',ranked[5]));
    elsif i=2 then
     pairs:=pairs||jsonb_build_array(jsonb_build_object('home_team',ranked[1],'away_team',ranked[4]),jsonb_build_object('home_team',ranked[2],'away_team',ranked[3]));
    else pairs:=pairs||jsonb_build_array(jsonb_build_object('home_team',ranked[1],'away_team',ranked[2]));
    end if;
   end loop;
  end if;
  if i<=n then
   select coalesce(jsonb_agg(to_jsonb(g)),'[]') into batch from public.playoff_games g join public.playoff_rounds r on r.id=g.round_id where r.season=p_season and r.round_order=i;
   if exists(select 1 from jsonb_array_elements(batch) g where coalesce(g->>'external_game_id','') !~ '^[0-9]+$' or g->>'game_status' is distinct from 'post' or g->>'home_score' is null or g->>'away_score' is null or (g->>'home_score')::int<0 or (g->>'away_score')::int<0 or g->>'home_score'=g->>'away_score') then raise exception 'Official FINAL games required; TEST preserved'; end if;
  else
   batch:=p_games;
   if batch is null or jsonb_typeof(batch)<>'array' then raise exception 'Official next games required'; end if;
   if exists(select 1 from jsonb_array_elements(batch) g where g->>'game_status' is distinct from 'pre' or g->>'home_score' is not null or g->>'away_score' is not null) then raise exception 'Unstarted next games required'; end if;
  end if;
  if jsonb_array_length(batch)<>jsonb_array_length(pairs) then raise exception 'Incomplete matchups'; end if;
  for pair in select value from jsonb_array_elements(pairs) loop
   if (select count(*) from jsonb_array_elements(batch) g where
      (g->>'home_team'=pair->>'home_team' and g->>'away_team'=pair->>'away_team') or
      (i=4 and g->>'home_team'=pair->>'away_team' and g->>'away_team'=pair->>'home_team'))<>1 then raise exception 'Invalid survivors or reseeding'; end if;
  end loop;
  if i<=n then
   select array_agg(t) into alive from unnest(alive) t where not exists(select 1 from jsonb_array_elements(batch) g where t=case when (g->>'home_score')::int>(g->>'away_score')::int then g->>'away_team' else g->>'home_team' end);
  end if;
 end loop;
 select * into dest from public.playoff_rounds where season=p_season and round_order=n+1;
 if dest.id is not null and (dest.status<>'draft' or
   exists(select 1 from public.playoff_qb_picks where round_id=dest.id) or
   exists(select 1 from public.playoff_team_paths where round_id=dest.id) or
   exists(select 1 from public.playoff_round_runs where round_id=dest.id) or
   exists(select 1 from public.playoff_picks p join public.playoff_games g on g.id=p.game_id where g.round_id=dest.id) or
   exists(select 1 from public.playoff_games where round_id=dest.id and (game_status is distinct from 'pre' or game_date<=clock_timestamp() or home_score is not null or away_score is not null or coalesce(external_game_id,'') !~ '^[0-9]+$')))
 then raise exception 'Incompatible target; existing data preserved'; end if;
 -- Recheck every prepared kickoff after locks, using wall time (now() is frozen
 -- at transaction start). This covers new games as well as existing target games.
 if exists(select 1 from jsonb_array_elements(p_games) g
   where g->>'game_date' is null or (g->>'game_date')::timestamptz<=clock_timestamp())
 then raise exception 'Prepared kickoff reached; advance refused'; end if;
 -- Reuse canonical publication validation BEFORE target changes invalidate its source snapshot.
 perform public.publish_playoff_scoring(p_season,src.id,'finalize',state,'[]',null);
 state:=public.playoff_scoring_state(p_season);
 perform public.manage_playoff_round(p_season,'advance',p_round_key,p_games,jsonb_build_object('rounds',state->'rounds','games',state->'games'));
 select * into dest from public.playoff_rounds where season=p_season and round_order=n+1;
 answer:=jsonb_build_object('source_round_id',src.id,'target_round_id',dest.id,'source_status','finalized','target_status','open');
 insert into public.playoff_round_advances(source_round_id,target_round_id,actor,result) values(src.id,dest.id,p_actor,answer);
 return answer;
end $$;
revoke all on function public.advance_playoff_round_atomic(integer,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.advance_playoff_round_atomic(integer,text,uuid,jsonb,jsonb) to service_role;
commit;
