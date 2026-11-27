-- Owner-controlled and off by default. The existing menu and automation flags
-- remain independent. No pick, QB, catalogue or observation is changed on install.
begin;

alter table qb_observation.regular_menu_config
  add column manual_admin_enabled boolean not null default false;

-- Append one decision per observed run. A future report can reuse the
-- journal entry identifier while remaining distinct from the reviewed run.
create table qb_observation.regular_qb_manual_decisions (
  entry_id uuid not null references qb_observation.entries(id),
  run_id uuid not null references qb_observation.runs(run_id),
  season integer not null,
  week integer not null,
  team_id uuid not null references public.teams(id),
  game_id uuid not null references public.games(id),
  actor_id uuid not null references public.users(id),
  selection text not null check (selection in ('current','suggested','other')),
  previous_athlete_id text not null,
  previous_qb_name text not null,
  qb_id uuid not null references public.qbs(id),
  athlete_id text not null,
  qb_name text not null,
  confirmed_at timestamptz not null,
  primary key (entry_id, run_id)
);
create index regular_qb_manual_decisions_swaps
  on qb_observation.regular_qb_manual_decisions (qb_id, season, week)
  where previous_athlete_id <> athlete_id;
alter table qb_observation.regular_qb_manual_decisions enable row level security;
revoke all on qb_observation.regular_qb_manual_decisions
  from public, anon, authenticated, service_role, authenticator;

-- A confirmation also has to clear the existing wall-clock check at commit.
create constraint trigger manual_regular_qb_freeze
  after insert on qb_observation.regular_qb_manual_decisions
  deferrable initially deferred for each row
  execute function qb_observation.check_regular_menu_freeze();

-- Compare the state reviewed by the Admin without disclosing pick or
-- reservation identifiers. Row versions also detect changes that were reverted.
create function qb_observation.regular_qb_review_state(
  p_season integer, p_week integer, p_revision bigint, p_cutoff timestamptz,
  p_team_id uuid, p_game_id uuid, p_qb_id uuid, p_athlete_id text, p_reserved boolean
) returns text language sql stable set search_path = '' set timezone = 'UTC' as $$
  select encode(sha256(convert_to(jsonb_build_array(
    p_season, p_week, p_revision, p_cutoff, p_team_id, p_game_id, p_qb_id, p_athlete_id, p_reserved,
    (select max(d.confirmed_at) from qb_observation.regular_qb_manual_decisions d
      where d.season = p_season and d.week = p_week and d.team_id = p_team_id),
    (select c.xmin::text from qb_observation.regular_menu_config c where c.singleton),
    (select jsonb_build_array(w.started_at, w.xmin::text) from public.qb_selection_weeks w
      where w.season = p_season and w.week = p_week),
    (select jsonb_build_array(g.external_game_id, g.game_date, g.xmin::text) from public.games g
      where g.id = p_game_id),
    (select jsonb_build_array(o.qb_id, o.expected_athlete_id, o.game_id, o.updated_at, o.xmin::text)
      from qb_observation.regular_menu_overrides o
      where o.season = p_season and o.week = p_week and o.team_id = p_team_id),
    (select jsonb_agg(jsonb_build_array(q.id, q.xmin::text) order by q.id) from public.qbs q
      where qb_observation.regular_team_id(q.team) = p_team_id),
    (select jsonb_agg(jsonb_build_array(p.id, p.xmin::text, r.team_id, r.xmin::text) order by p.id)
      from public.qb_picks p
      left join qb_observation.regular_menu_reservations r on r.pick_id = p.id
      cross join lateral (values (coalesce(r.team_id, qb_observation.regular_team_id(p.selected_team)))) pick(team_id)
      where p.season = p_season and p.week = p_week and (pick.team_id is null or pick.team_id = p_team_id))
  )::text, 'UTF8')), 'hex')
$$;

revoke all on function qb_observation.regular_qb_review_state(integer,integer,bigint,timestamptz,uuid,uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role, authenticator;

-- The legacy player menu reads active catalogue starters by team. Ignore
-- weekly overrides in that mode and refuse teams without a unique starter.
create function qb_observation.regular_qb_catalog_choices(p_season integer, p_week integer)
returns table (team_id uuid, game_id uuid, abbr text, team_name text, qb_id uuid, qb_name text,
  athlete_id text, reserved boolean)
language sql stable set search_path = '' as $$
  select f.team_id, f.game_id, qb_observation.regular_team_abbr(t.espn_abbr), t.name,
    q.id, q.name, q.espn_athlete_id, qb_observation.regular_menu_team_taken(p_season, p_week, f.team_id)
  from qb_observation.regular_menu_fixtures(p_season, p_week) f
  join public.teams t on t.id = f.team_id
  left join lateral (
    select c.id, c.name, c.espn_athlete_id, count(*) over () as starter_count
    from public.qbs c
    where qb_observation.regular_team_id(c.team) = f.team_id and c.active and c.is_active_starter
  ) q on q.starter_count = 1 and q.espn_athlete_id ~ '^[0-9]{1,18}$' and q.name ~ '[^[:space:]]'
$$;

revoke all on function qb_observation.regular_qb_catalog_choices(integer,integer)
  from public, anon, authenticated, service_role, authenticator;

create or replace function public.read_regular_qb_menu_admin() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_context record;
  v_config qb_observation.regular_menu_config;
  v_manual boolean;
begin
  if not exists (select 1 from public.users where id = (select auth.uid()) and is_admin) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select * into v_config from qb_observation.regular_menu_config;
  select * into v_context from qb_observation.regular_menu_context();
  v_manual := coalesce(v_config.manual_admin_enabled and not v_config.enabled and not v_config.automation_enabled, false);
  return jsonb_build_object('enabled', coalesce(v_config.enabled, false), 'season', v_context.season,
    'week', v_context.week, 'open', coalesce(v_config.enabled and v_context.can_change, false),
    'manualEnabled', v_manual,
    'manualOpen', v_manual and coalesce(v_context.can_change, false),
    'reviewed', coalesce((
      select jsonb_agg(jsonb_build_object('entryId', d.entry_id, 'runId', d.run_id,
        'outcome', case when d.previous_athlete_id = d.athlete_id then 'maintained' else 'confirmed' end))
      from qb_observation.regular_qb_manual_decisions d
      join qb_observation.entries e on e.id = d.entry_id and e.run_id = d.run_id
      where d.season = v_context.season and d.week = v_context.week
    ), '[]'::jsonb),
    'canCheck', coalesce(v_context.can_check, false),
    'firstKickoffAt', qb_observation.iso(v_context.first_kickoff_at), 'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'abbr', c.abbr, 'name', c.team_name, 'qbId', c.qb_id, 'qbName', c.qb_name, 'qbEspnId', c.athlete_id,
        'available', c.qb_id is not null and not c.reserved, 'reserved', c.reserved,
        'reviewState', case when v_manual and v_context.can_change and c.qb_id is not null
          then qb_observation.regular_qb_review_state(v_context.season, v_context.week, v_context.revision,
            v_context.first_kickoff_at, c.team_id, c.game_id, c.qb_id, c.athlete_id, c.reserved) end
      ) order by c.team_name)
      from (
        select team_id, game_id, abbr, team_name, qb_id, qb_name, athlete_id, reserved
        from qb_observation.regular_menu_choices(v_context.season, v_context.week)
        where v_config.enabled
        union all
        select team_id, game_id, abbr, team_name, qb_id, qb_name, athlete_id, reserved
        from qb_observation.regular_qb_catalog_choices(v_context.season, v_context.week)
        where not coalesce(v_config.enabled, false)
      ) c
    ), '[]'::jsonb));
end
$$;

create or replace function qb_observation.current_projection(p_entry qb_observation.entries) returns boolean
language sql stable set search_path = '' as $$
  select p_entry.decision->>'reason' in ('nflverse_projection','sleeper_unavailable','sleeper_return_review',
    'source_conflict','source_missing')
    and p_entry.dismissed_at is null and not exists (
      select 1 from qb_observation.regular_qb_manual_decisions d
      where d.entry_id = p_entry.id and d.run_id = p_entry.run_id
    ) and exists (
    select 1
    from public.settings s
    join qb_observation.runs r on r.run_id = p_entry.run_id
    join public.qb_selection_weeks w on w.season = r.season and w.week = r.week
    where s.id = 1 and s.phase = 'regular' and not s.regular_writes_paused and s.regular_finalized_at is null
      and r.season = s.current_season and r.week = s.current_week and r.revision = s.revision
      and r.opened_at = w.started_at and r.status = 'completed'
      and r.observed_at >= r.opened_at and r.observed_at < r.first_kickoff_at
      and r.observed_at > statement_timestamp() - interval '3 hours'
      and statement_timestamp() < r.first_kickoff_at
      and not exists (
        select 1 from qb_observation.runs newer where newer.season = r.season and newer.week = r.week
          and newer.opened_at = r.opened_at and newer.revision = r.revision and newer.status = 'completed'
          and newer.dispatched_at > r.dispatched_at
      )
  )
$$;

create or replace function public.capture_regular_qb_selection_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
declare selected public.qbs;
begin
 select * into selected from public.qbs where id=new.qb_id for share;
 if selected.id is null or coalesce(selected.name,'') !~ '[^[:space:]]' or
   coalesce(selected.espn_athlete_id,'') !~ '[^[:space:]]' or coalesce(selected.team,'') !~ '[^[:space:]]' then
  raise exception 'Selected QB identity unavailable' using errcode='23514';
 end if;
 -- A confirmed catalogue swap keeps the same team-slot UUID. Require
 -- the athlete observed by the participant so a stale menu cannot book
 -- the replacement without a new, explicit choice.
 if new.selected_espn_athlete_id is distinct from selected.espn_athlete_id and exists(
   select 1 from qb_observation.regular_qb_manual_decisions d where d.qb_id=new.qb_id
     and d.previous_athlete_id<>d.athlete_id and (d.season,d.week)<=(new.season,new.week)
 ) then
  raise exception 'Le titulaire de cette équipe a changé. Recharge la page et confirme ton choix.'
    using errcode='23514';
 end if;
 -- Always replace client values, including nonempty spoofed values.
 new.selected_qb_name:=selected.name;
 new.selected_espn_athlete_id:=selected.espn_athlete_id;
 new.selected_team:=selected.team;
 return new;
end $$;

-- Only the server can pass ESPN evidence. The independently verified
-- actor must still be an Admin at commit, regardless of the caller's role.
create function public.manage_regular_qb_recommendation(
  p_actor_id uuid, p_selection text, p_entry_id uuid, p_run_id uuid, p_expected_state text,
  p_team text, p_confirmed boolean, p_athlete_id text, p_athlete_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_config qb_observation.regular_menu_config;
  v_context record;
  v_choice record;
  v_entry qb_observation.entries;
  v_previous public.qbs;
  v_target public.qbs;
  v_team text := qb_observation.regular_team_abbr(p_team);
  v_outcome text;
  v_stale constant text := 'Recommandation QB périmée. Rafraîchis la page.';
begin
  if not exists (select 1 from public.users where id = p_actor_id and is_admin) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_confirmed is distinct from true or p_selection is null or p_selection not in ('current','suggested','other')
    or p_entry_id is null or p_run_id is null or coalesce(p_expected_state,'') !~ '^[0-9a-f]{64}$'
    or not qb_observation.source_team(v_team)
    or (p_selection = 'current' and (p_athlete_id is not null or p_athlete_name is not null))
    or (p_selection <> 'current' and (coalesce(p_athlete_id,'') !~ '^[0-9]{1,18}$'
      or coalesce(p_athlete_name,'') !~ '[^[:space:]]' or length(p_athlete_name) > 120)) then
    raise exception 'Confirmation et identité QB valides requises' using errcode = '22023';
  end if;

  -- Match publication and lifecycle's sources-before-settings order. Take
  -- the picks table before qbs so an in-flight snapshot either commits first
  -- or sees the new starter. Do not add an advisory lock before these tables.
  lock table public.games in share mode;
  lock table public.qb_picks in share mode;
  lock table public.qbs in share row exclusive mode;
  lock table public.teams in share mode;
  lock table public.playoff_qb_picks, public.playoff_round_results in share mode;
  select * into v_config from qb_observation.regular_menu_config for share;
  if not coalesce(v_config.manual_admin_enabled and not v_config.enabled and not v_config.automation_enabled, false) then
    raise exception 'Actions manuelles QB désactivées' using errcode = '42501';
  end if;

  select * into v_entry from qb_observation.entries where id = p_entry_id;
  if not found or v_entry.run_id is distinct from p_run_id or v_entry.team is distinct from v_team then
    raise exception '%', v_stale using errcode = '40001';
  end if;
  perform pg_advisory_xact_lock(1654741114, v_entry.season * 100 + v_entry.week);
  perform 1 from public.settings where id = 1 for share;
  perform 1 from public.users where id = p_actor_id and is_admin for share;
  if not found then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform 1 from public.qb_selection_weeks where season = v_entry.season and week = v_entry.week for share;
  perform 1 from qb_observation.regular_menu_reservations r where r.season = v_entry.season and r.week = v_entry.week
    order by r.team_id for share;

  select * into v_context from qb_observation.regular_menu_context();
  if not coalesce(v_context.can_change, false)
    or v_context.season is distinct from v_entry.season or v_context.week is distinct from v_entry.week
    or qb_observation.regular_menu_frozen(v_entry.season, v_entry.week, v_context.first_kickoff_at) then
    raise exception '%', v_stale using errcode = '40001';
  end if;

  select e.* into v_entry from qb_observation.entries e
    join qb_observation.runs r on r.run_id = e.run_id
    cross join qb_observation.calendar(v_context.season, v_context.week) cal
    where e.id = p_entry_id and r.run_id = p_run_id and e.team = v_team and qb_observation.current_projection(e)
      and r.event_ids = cal.event_ids and r.observed_at > clock_timestamp() - interval '3 hours'
      and e.first_detected_at < v_context.first_kickoff_at and e.decision->>'status' = 'ambiguous'
    for update of e;
  if not found then
    raise exception '%', v_stale using errcode = '40001';
  end if;

  select c.* into v_choice from qb_observation.regular_qb_catalog_choices(v_context.season,v_context.week) c
    join public.games g on g.id = c.game_id and g.external_game_id = v_entry.event_id
    where c.abbr = v_team and c.qb_id is not null;
  if not found or v_entry.decision->'previousQB'->>'id' is distinct from v_choice.athlete_id
    or v_entry.decision->'previousQB'->>'name' is distinct from btrim(v_choice.qb_name)
    or p_expected_state is distinct from qb_observation.regular_qb_review_state(
      v_context.season, v_context.week, v_context.revision, v_context.first_kickoff_at,
      v_choice.team_id, v_choice.game_id, v_choice.qb_id, v_choice.athlete_id, v_choice.reserved
    ) then
    raise exception '%', v_stale using errcode = '40001';
  end if;

  select * into strict v_previous from public.qbs q where q.id = v_choice.qb_id;
  v_target := v_previous;
  if p_selection <> 'current' then
    if p_selection = 'suggested' and (
      v_entry.decision->>'reason' in ('source_conflict','source_missing')
      or v_entry.decision->'newQB'->>'id' is distinct from p_athlete_id
      or v_entry.decision->>'espnAthleteId' is distinct from p_athlete_id
      or regexp_replace(lower(v_entry.decision->'newQB'->>'name'),'[^a-z0-9]','','g') is distinct from
        regexp_replace(lower(p_athlete_name),'[^a-z0-9]','','g')
    ) then
      raise exception '%', v_stale using errcode = '40001';
    end if;
    if p_athlete_id is distinct from v_previous.espn_athlete_id then
      if exists (select 1 from public.qbs q where q.id <> v_previous.id and q.espn_athlete_id = p_athlete_id) then
        raise exception 'Cet identifiant ESPN est lié à une autre fiche QB du catalogue.' using errcode = '23514';
      end if;
      -- Regular results use the immutable selected/actual athlete snapshots.
      -- Playoff selections and results still dereference the catalogue UUID.
      if exists (
        select 1 from public.qb_picks p where p.qb_id = v_previous.id
          and (coalesce(p.selected_espn_athlete_id,'') !~ '^[0-9]{1,18}$'
            or coalesce(p.selected_qb_name,'') !~ '[^[:space:]]'
            or coalesce(p.selected_team,'') !~ '[^[:space:]]')
      ) then
        raise exception 'Une sélection historique de cette fiche QB n’a pas d’identité complète.'
          using errcode = '23514';
      end if;
      if exists (select 1 from public.playoff_qb_picks p where p.qb_id = v_previous.id)
        or exists (select 1 from public.playoff_round_results r where r.selected_qb_id = v_previous.id) then
        raise exception 'Cette fiche QB est utilisée par l’historique des séries.' using errcode = '23514';
      end if;
    end if;
  end if;

  if clock_timestamp() >= least(v_context.first_kickoff_at, v_entry.last_detected_at + interval '3 hours')
    or qb_observation.regular_menu_frozen(v_entry.season, v_entry.week, v_context.first_kickoff_at) then
    raise exception '%', v_stale using errcode = '40001';
  end if;

  -- The UUID and team still represent the same offer. Changing its
  -- athlete can never free an already-reserved team or rewrite a snapshot.
  if p_selection <> 'current' and p_athlete_id is distinct from v_previous.espn_athlete_id then
    update public.qbs set name = btrim(p_athlete_name), espn_athlete_id = p_athlete_id
      where id = v_previous.id returning * into strict v_target;
    v_outcome := 'confirmed';
  else
    v_outcome := 'maintained';
  end if;

  insert into qb_observation.regular_qb_manual_decisions
    (entry_id, run_id, season, week, team_id, game_id, actor_id, selection,
      previous_athlete_id, previous_qb_name, qb_id, athlete_id, qb_name, confirmed_at)
  values
    (v_entry.id, v_entry.run_id, v_context.season, v_context.week, v_choice.team_id, v_choice.game_id,
      p_actor_id, p_selection, v_previous.espn_athlete_id, v_previous.name,
      v_target.id, v_target.espn_athlete_id, v_target.name, clock_timestamp());
  return jsonb_build_object('season', v_context.season, 'week', v_context.week, 'team', v_team,
    'selection', p_selection, 'qbId', v_target.id, 'qbName', v_target.name,
    'espnAthleteId', v_target.espn_athlete_id, 'outcome', v_outcome);
end
$$;

alter function public.manage_regular_qb_recommendation(uuid,text,uuid,uuid,text,text,boolean,text,text) owner to postgres;
revoke all on function public.manage_regular_qb_recommendation(uuid,text,uuid,uuid,text,text,boolean,text,text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.manage_regular_qb_recommendation(uuid,text,uuid,uuid,text,text,boolean,text,text)
  to service_role;

-- Reuse Supabase's existing publication when it can safely publish updates.
-- The player page also refreshes when opened or refocused.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication p where p.pubname = 'supabase_realtime' and not p.puballtables)
    and not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'qbs'
    )
    and exists (
      select 1 from pg_catalog.pg_class c where c.oid = 'public.qbs'::regclass and (
        c.relreplident = 'f' or exists (
          select 1 from pg_catalog.pg_index i where i.indrelid = c.oid and
            ((c.relreplident = 'd' and i.indisprimary) or (c.relreplident = 'i' and i.indisreplident))
        )
      )
    ) then
    alter publication supabase_realtime add table public.qbs;
  end if;
end
$$;

commit;
