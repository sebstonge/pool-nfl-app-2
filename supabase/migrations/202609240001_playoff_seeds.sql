-- LOCAL PROPOSAL: requires owner approval before any remote execution.
-- Existing teams PK/type/uniqueness are not versioned; retain canonical team
-- name plus immutable ESPN ID instead of introducing an unverified foreign key.
begin;
create table public.playoff_seeds (
  id uuid primary key default gen_random_uuid(),
  season integer not null check (season between 2000 and 9999),
  team text not null check (team = btrim(team) and team <> ''),
  espn_team_id text not null check (espn_team_id ~ '^[0-9]+$'),
  conference text not null check (conference in ('AFC', 'NFC')),
  seed smallint not null check (seed between 1 and 7),
  captured_at timestamptz not null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint playoff_seeds_slot unique (season, conference, seed),
  constraint playoff_seeds_team unique (season, team),
  constraint playoff_seeds_espn_team unique (season, espn_team_id),
  check (finalized_at is null or finalized_at >= captured_at)
);
create unique index playoff_seeds_team_normalized on public.playoff_seeds (season, lower(team));
-- All unique indexes begin with season; no redundant single-column index.
alter table public.playoff_seeds enable row level security;
revoke all on public.playoff_seeds from public, anon, authenticated, service_role;
grant select on public.playoff_seeds to authenticated, service_role;
create policy playoff_seeds_authenticated_read on public.playoff_seeds
  for select to authenticated using (true);

create function public.guard_playoff_seeds() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.season <> old.season then
    raise exception 'Snapshot season cannot change';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(20260924, case when tg_op = 'DELETE' then old.season else new.season end);
  if tg_op <> 'INSERT' and old.finalized_at is not null then
    raise exception 'Finalized playoff seeds are immutable';
  end if;
  if tg_op = 'INSERT' and exists (select 1 from public.playoff_seeds where season = new.season and finalized_at is not null) then
    raise exception 'Finalized playoff seeds are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger playoff_seeds_guard before insert or update or delete on public.playoff_seeds
  for each row execute function public.guard_playoff_seeds();

-- Deferred validation guarantees one complete, uniformly finalized snapshot,
-- including writes made outside the provided RPCs by a privileged operator.
create function public.validate_final_playoff_seeds() returns trigger
language plpgsql set search_path = '' as $$
declare target integer := case when tg_op = 'DELETE' then old.season else new.season end;
begin
  if exists (select 1 from public.playoff_seeds where season = target and finalized_at is not null) then
    if (select count(*) <> 14 or count(finalized_at) <> 14 or count(distinct finalized_at) <> 1 or
        count(distinct captured_at) <> 1 or count(*) filter (where conference = 'AFC') <> 7 or
        count(*) filter (where conference = 'NFC') <> 7 from public.playoff_seeds where season = target) then
      raise exception 'Final snapshot requires exactly seven AFC and seven NFC seeds with one capture/finalization';
    end if;
  end if;
  return null;
end;
$$;
create constraint trigger playoff_seeds_final_complete after insert or update or delete on public.playoff_seeds
  deferrable initially deferred for each row execute function public.validate_final_playoff_seeds();

create function public.sync_playoff_seeds(p_season integer, p_rows jsonb) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare captured timestamptz;
begin
  if p_season is null or p_season not between 2000 and 9999 then raise exception 'Invalid season'; end if;
  perform pg_catalog.pg_advisory_xact_lock(20260924, p_season);
  if exists (select 1 from public.playoff_seeds where season = p_season and finalized_at is not null) then
    raise exception 'Finalized playoff seeds cannot be synchronized';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Expected seed array'; end if;
  if jsonb_array_length(p_rows) <> 14 then raise exception 'Exactly 14 teams required'; end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as r(season integer, conference text, seed integer, team text, espn_team_id text)
    where season is distinct from p_season or conference is null or conference not in ('AFC','NFC') or
      seed is null or seed not between 1 and 7 or team is null or btrim(team) = '' or
      espn_team_id is null or espn_team_id !~ '^[0-9]+$') then raise exception 'Invalid seed payload'; end if;
  if (select count(*) filter(where conference='AFC') <> 7 or count(*) filter(where conference='NFC') <> 7 or
      count(distinct (conference,seed)) <> 14 or count(distinct lower(btrim(team))) <> 14 or count(distinct espn_team_id) <> 14
      from jsonb_to_recordset(p_rows) as r(conference text,seed integer,team text,espn_team_id text)) then
    raise exception 'Duplicate or incomplete seeds';
  end if;
  -- Replace atomically: seed swaps and changes to the fourteen qualifiers cannot
  -- collide with old slot/team uniqueness constraints. No partial state is visible.
  captured := clock_timestamp();
  delete from public.playoff_seeds where season = p_season;
  insert into public.playoff_seeds(season,team,espn_team_id,conference,seed,captured_at)
    select p_season,btrim(team),espn_team_id,conference,seed,captured
    from jsonb_to_recordset(p_rows) as r(team text,espn_team_id text,conference text,seed smallint);
  return captured;
end;
$$;

create function public.finalize_playoff_seeds(p_season integer, p_expected_captured_at timestamptz) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare finalized timestamptz;
begin
  if p_season is null or p_expected_captured_at is null then raise exception 'Season and expected capture required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(20260924, p_season);
  if exists (select 1 from public.playoff_seeds where season = p_season and finalized_at is not null) then
    raise exception 'Snapshot already finalized';
  end if;
  if (select count(*) <> 14 or count(*) filter(where conference='AFC') <> 7 or count(*) filter(where conference='NFC') <> 7
    from public.playoff_seeds where season=p_season) then raise exception 'Incomplete snapshot'; end if;
  if exists (select 1 from public.playoff_seeds where season=p_season and captured_at <> p_expected_captured_at) then
    raise exception 'Snapshot changed: review the latest capture before finalizing';
  end if;
  finalized := clock_timestamp();
  update public.playoff_seeds set finalized_at=finalized where season=p_season;
  return finalized;
end;
$$;
revoke all on function public.guard_playoff_seeds() from public, anon, authenticated, service_role;
revoke all on function public.validate_final_playoff_seeds() from public, anon, authenticated, service_role;
revoke all on function public.sync_playoff_seeds(integer,jsonb) from public, anon, authenticated;
revoke all on function public.finalize_playoff_seeds(integer,timestamptz) from public, anon, authenticated;
grant execute on function public.sync_playoff_seeds(integer,jsonb) to service_role;
grant execute on function public.finalize_playoff_seeds(integer,timestamptz) to service_role;
commit;
