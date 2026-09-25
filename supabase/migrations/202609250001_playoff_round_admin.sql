-- LOCAL ONLY. Do not apply to production as part of development/testing.
-- Legacy/TEST games retain NULL status; scores alone never imply FINAL.
begin;
alter table public.playoff_games add column game_status text
  check (game_status in ('pre','in','post'));
alter table public.playoff_games add constraint playoff_games_final_scores
  check (game_status is distinct from 'post' or
    (home_score is not null and away_score is not null and home_score >= 0 and away_score >= 0 and home_score <> away_score));

-- One protected transaction after server-side ESPN/seed validation. Compare the
-- exact reviewed season under locks so stale/concurrent requests cannot advance
-- using results that changed while ESPN was being fetched.
create function public.manage_playoff_round(
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

  if p_action='update' then
    if source.id is null or source.status not in ('open','locked') or
      (select count(*) from public.playoff_games where round_id=source.id)<>counts[n] then raise exception 'Active official round required'; end if;
    if (select count(*)<>count(distinct id) from jsonb_to_recordset(p_games) as x(id bigint)) then raise exception 'Duplicate updates'; end if;
    for g in select * from jsonb_to_recordset(p_games) as x(id bigint,external_game_id text,game_status text,home_score integer,away_score integer) loop
      if g.game_status is null or g.game_status not in ('pre','in','post') or
        not exists(select 1 from public.playoff_games where id=g.id and round_id=source.id and external_game_id=g.external_game_id and
          (game_status is distinct from 'post' or g.game_status='post') and (game_status is distinct from 'in' or g.game_status<>'pre')) or
        (g.game_status in ('in','post') and (g.home_score is null or g.away_score is null or g.home_score<0 or g.away_score<0))
        then raise exception 'Invalid or regressive result'; end if;
      update public.playoff_games set game_status=g.game_status,home_score=g.home_score,away_score=g.away_score,updated_at=clock_timestamp() where id=g.id;
    end loop;
    update public.playoff_rounds set status='locked',updated_at=clock_timestamp() where id=source.id and status='open' and
      exists(select 1 from public.playoff_games where round_id=source.id and (game_date<=now() or game_status in ('in','post')));
    return;
  end if;
  if p_action='prepare' and (n<>1 or exists(select 1 from public.playoff_games where round_id=source.id))
    then raise exception 'Only empty Wild Card can be initialized'; end if;
  target := case when p_action='advance' then n+1 else n end;
  if target>4 then raise exception 'Super Bowl is the final round'; end if;
  if p_action='advance' and (source.id is null or source.status not in ('open','locked') or
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
  if p_action='advance' then
    -- Round closure only: no scoring or QB/path mutation is performed.
    update public.playoff_rounds set status='finalized',updated_at=clock_timestamp() where id=source.id;
  end if;
  update public.playoff_rounds set status='open',updated_at=clock_timestamp() where id=dest.id;
end;
$$;
revoke all on function public.manage_playoff_round(integer,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.manage_playoff_round(integer,text,text,jsonb,jsonb) to service_role;
commit;
