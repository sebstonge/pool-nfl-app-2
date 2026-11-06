-- Install after 20261105132645_qb_observation_log.sql. Owner-controlled and off
-- by default. No external request or change to an existing pick on installation.
begin;

create table qb_observation.regular_menu_config (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into qb_observation.regular_menu_config default values;

create table qb_observation.regular_menu_overrides (
  season integer not null,
  week integer not null,
  team_id uuid not null references public.teams(id),
  game_id uuid not null references public.games(id),
  qb_id uuid references public.qbs(id),
  expected_athlete_id text,
  source_entry_id uuid references qb_observation.entries(id),
  note text not null,
  actor_id uuid not null references public.users(id),
  updated_at timestamptz not null,
  primary key (season, week, team_id),
  check ((qb_id is null) = (expected_athlete_id is null))
);

create table qb_observation.regular_menu_reservations (
  season integer not null,
  week integer not null,
  team_id uuid not null references public.teams(id),
  pick_id uuid not null unique references public.qb_picks(id)
    on delete cascade deferrable initially deferred,
  primary key (season, week, team_id)
);

alter table qb_observation.regular_menu_config enable row level security;
alter table qb_observation.regular_menu_overrides enable row level security;
alter table qb_observation.regular_menu_reservations enable row level security;
revoke all on qb_observation.regular_menu_config, qb_observation.regular_menu_overrides,
  qb_observation.regular_menu_reservations from public, anon, authenticated, service_role;

-- Eligibility now trusts the officially credited athlete. Legacy permissive
-- policies must not allow a player to fabricate or replace that evidence.
create policy regular_qb_ratings_admin_insert on public.qb_ratings
  as restrictive for insert to authenticated
  with check (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_admin));
create policy regular_qb_ratings_admin_update on public.qb_ratings
  as restrictive for update to authenticated
  using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_admin))
  with check (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_admin));

-- Rolling back during an active week could expose an athlete already reserved
-- on a different offer. Stop Cron if needed and disable before the next pick.
create function qb_observation.guard_regular_menu_config() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.enabled and not new.enabled and exists (
    select 1 from public.settings s
    where s.id = 1 and s.phase = 'regular' and s.regular_finalized_at is null and (
      exists (select 1 from qb_observation.regular_menu_overrides o
        where o.season = s.current_season and o.week = s.current_week) or
      exists (select 1 from qb_observation.regular_menu_reservations r
        where r.season = s.current_season and r.week = s.current_week)
    )
  ) then
    raise exception 'Attends la fin de la semaine active avant de désactiver les réservations QB'
      using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger protect_active_regular_menu before update of enabled on qb_observation.regular_menu_config
  for each row execute function qb_observation.guard_regular_menu_config();

create function qb_observation.regular_team_abbr(p_label text) returns text
language sql immutable strict set search_path = '' as $$
  select case upper(btrim(p_label))
    when 'WSH' then 'WAS' when 'LA' then 'LAR' else upper(btrim(p_label)) end
$$;

create function qb_observation.regular_team_id(p_label text) returns uuid
language sql stable strict set search_path = '' as $$
  select case when count(*) = 1 then min(t.id::text)::uuid end
  from public.teams t
  where lower(btrim(p_label)) in (
    lower(btrim(t.name)), regexp_replace(lower(btrim(t.name)), '^.*[[:space:]]', '')
  ) or qb_observation.regular_team_abbr(t.espn_abbr) = qb_observation.regular_team_abbr(p_label)
$$;

create function qb_observation.regular_menu_fixtures(p_season integer, p_week integer)
returns table (team_id uuid, game_id uuid) language sql stable set search_path = '' as $$
  select side.team_id, min(g.id::text)::uuid
  from public.games g
  cross join lateral (values (qb_observation.regular_team_id(g.home_team)),
                             (qb_observation.regular_team_id(g.away_team))) side(team_id)
  where g.season = p_season and g.week = p_week and g.season_type = 'regular'
  group by side.team_id having side.team_id is not null and count(*) = 1
$$;

create function qb_observation.regular_menu_context()
returns table (season integer, week integer, revision bigint, regular_active boolean,
  first_kickoff_at timestamptz, can_check boolean, can_change boolean)
language sql stable set search_path = '' as $$
  select s.current_season, s.current_week, s.revision, s.phase = 'regular' and s.regular_finalized_at is null,
    least(cal.first_kickoff_at, proof.kickoff_at), availability.can_check,
    availability.can_check and proof.kickoff_at is not null
  from public.settings s
  left join public.qb_selection_weeks w on w.season = s.current_season and w.week = s.current_week
  cross join lateral qb_observation.calendar(s.current_season, s.current_week) cal
  cross join lateral (
    select min(r.first_kickoff_at) as kickoff_at
    from qb_observation.runs r
    where r.season = s.current_season and r.week = s.current_week and r.revision = s.revision
      and r.opened_at = w.started_at and r.status = 'completed' and r.observed_at < r.first_kickoff_at
      and r.event_ids = cal.event_ids
  ) proof
  cross join lateral (
    select count(*) as team_count from qb_observation.regular_menu_fixtures(s.current_season, s.current_week)
  ) f
  cross join lateral (
    select coalesce(s.phase = 'regular' and s.regular_finalized_at is null and not s.regular_writes_paused
      and w.started_at <= clock_timestamp() and isfinite(w.started_at)
      and cal.complete and not cal.has_scores and f.team_count = 2 * cardinality(cal.event_ids)
      and clock_timestamp() < least(cal.first_kickoff_at, proof.kickoff_at), false) as can_check
  ) availability
  where s.id = 1
$$;

-- Pre-installation picks reserve the immutable team from their snapshot. A
-- current pick whose team cannot be proven closes availability conservatively.
create function qb_observation.regular_menu_team_taken(p_season integer, p_week integer, p_team_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1
    from public.qb_picks p
    left join qb_observation.regular_menu_reservations r on r.pick_id = p.id
    cross join lateral (values (coalesce(r.team_id, qb_observation.regular_team_id(p.selected_team)))) pick(team_id)
    where p.season = p_season and p.week = p_week and (pick.team_id is null or pick.team_id = p_team_id)
  )
$$;

-- A proven official result consumes the actual athlete. Until proven, keep
-- the selection blocked, including legacy selections without a full snapshot.
create function qb_observation.regular_menu_athlete_used(
  p_season integer, p_week integer, p_user uuid, p_qb_id uuid, p_athlete_id text
) returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1
    from public.qb_picks p
    left join public.qb_ratings r on r.season = p.season and r.week = p.week and r.qb_id = p.qb_id
    where p.season = p_season and p.week < p_week and p.user_id = p_user and
      case
        when r.passer_rating between 0 and 158.3 and btrim(coalesce(r.actual_espn_athlete_id, '')) ~ '^[0-9]{1,18}$'
          then btrim(r.actual_espn_athlete_id) = p_athlete_id
        when btrim(coalesce(p.selected_espn_athlete_id, '')) ~ '^[0-9]{1,18}$'
          then btrim(p.selected_espn_athlete_id) = p_athlete_id
        else p.qb_id = p_qb_id
      end
  )
$$;

create function qb_observation.regular_menu_choices(p_season integer, p_week integer)
returns table (team_id uuid, game_id uuid, abbr text, team_name text, qb_id uuid, qb_name text,
  qb_team text, athlete_id text, logo text, reserved boolean)
language sql stable set search_path = '' as $$
  select f.team_id, f.game_id, qb_observation.regular_team_abbr(t.espn_abbr), t.name,
    q.id, q.name, q.team, q.espn_athlete_id, q.logo,
    qb_observation.regular_menu_team_taken(p_season, p_week, f.team_id)
  from qb_observation.regular_menu_fixtures(p_season, p_week) f
  join public.teams t on t.id = f.team_id
  left join qb_observation.regular_menu_overrides o
    on o.season = p_season and o.week = p_week and o.team_id = f.team_id
  left join lateral (
    select c.id, c.name, c.team, c.espn_athlete_id, c.logo
    from public.qbs c
    where qb_observation.regular_team_id(c.team) = f.team_id
      and c.espn_athlete_id ~ '^[0-9]{1,18}$' and c.name ~ '[^[:space:]]'
      and ((o.team_id is not null and o.game_id = f.game_id and c.id = o.qb_id
        and c.espn_athlete_id = o.expected_athlete_id)
        or (o.team_id is null and c.active and c.is_active_starter))
      and (o.team_id is not null or not exists (
        select 1 from public.qbs other
        where other.id <> c.id and other.active and other.is_active_starter
          and qb_observation.regular_team_id(other.team) = f.team_id
      ))
  ) q on true
$$;

-- This runs after the immutable snapshot capture, alphabetically. The lock
-- serializes a pick with an offer change for the same week. The durable team
-- key also protects the reservation from exceptional snapshot corrections.
create function qb_observation.guard_regular_menu_pick() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_enabled boolean;
  v_context record;
  v_team_id uuid;
  v_actor uuid := (select auth.uid());
begin
  select c.enabled into v_enabled from qb_observation.regular_menu_config c for share;
  if not coalesce(v_enabled, false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if v_actor is not null or exists (
      select 1 from public.settings s where s.id = 1 and s.phase = 'regular'
        and s.regular_finalized_at is null and s.current_season = old.season and s.current_week = old.week
    ) then
      raise exception 'Un choix QB soumis ne peut pas être annulé' using errcode = '42501';
    end if;
    return old;
  end if;

  if new.season is null or new.season not between 2000 and 2100 or
     new.week is null or new.week not between 1 and 18 then
    raise exception 'Semaine ou participant QB invalide' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(1654741114, new.season * 100 + new.week);
  perform 1 from public.settings s where s.id = 1 for share;
  select * into v_context from qb_observation.regular_menu_context();
  if not coalesce(v_context.regular_active, false) or
     new.season is distinct from v_context.season or new.week is distinct from v_context.week or
     v_actor is null or new.user_id is distinct from v_actor or not exists (
       select 1 from public.season_participants p
       where p.season = new.season and p.user_id = v_actor and p.confirmed
     ) then
    raise exception 'Semaine ou participant QB invalide' using errcode = '42501';
  end if;

  select c.team_id into v_team_id
  from qb_observation.regular_menu_choices(new.season, new.week) c
  where c.qb_id = new.qb_id and c.athlete_id = new.selected_espn_athlete_id
    and c.qb_team = new.selected_team and not c.reserved;
  if v_team_id is null or qb_observation.regular_menu_athlete_used(
    new.season, new.week, v_actor, new.qb_id, new.selected_espn_athlete_id
  ) then
    raise exception 'Ce QB ou cette équipe ne sont plus admissibles. Recharge la page.'
      using errcode = '23514';
  end if;

  insert into qb_observation.regular_menu_reservations (season, week, team_id, pick_id)
    values (new.season, new.week, v_team_id, new.id);
  return new;
end
$$;

create trigger regular_qb_weekly_menu_insert before insert or delete on public.qb_picks
  for each row execute function qb_observation.guard_regular_menu_pick();

create function public.read_regular_qb_menu(p_season integer, p_week integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_context record;
  v_enabled boolean;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select enabled into v_enabled from qb_observation.regular_menu_config;
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('enabled', false, 'qbs', '[]'::jsonb);
  end if;
  select * into v_context from qb_observation.regular_menu_context();
  if not coalesce(v_context.regular_active, false) or p_season is distinct from v_context.season
    or p_week is distinct from v_context.week or not exists (
      select 1 from public.season_participants p
      where p.season = p_season and p.user_id = v_actor and p.confirmed
    ) then
    return jsonb_build_object('enabled', true, 'qbs', '[]'::jsonb);
  end if;
  return jsonb_build_object('enabled', true, 'qbs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.qb_id, 'name', c.qb_name, 'team', c.qb_team, 'espn_athlete_id', c.athlete_id, 'logo', c.logo,
      'active', true, 'is_active_starter', true, 'menu_game_id', c.game_id,
      'menu_is_home', qb_observation.regular_team_id(g.home_team) = c.team_id
    ) order by c.qb_name, c.qb_id)
    from qb_observation.regular_menu_choices(p_season, p_week) c
    join public.games g on g.id = c.game_id
    where c.qb_id is not null and not c.reserved
      and not qb_observation.regular_menu_athlete_used(p_season, p_week, v_actor, c.qb_id, c.athlete_id)
  ), '[]'::jsonb));
end
$$;

create function public.read_regular_qb_menu_admin() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_context record;
  v_enabled boolean;
begin
  if not exists (select 1 from public.users where id = (select auth.uid()) and is_admin) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select enabled into v_enabled from qb_observation.regular_menu_config;
  select * into v_context from qb_observation.regular_menu_context();
  return jsonb_build_object('enabled', coalesce(v_enabled, false), 'season', v_context.season,
    'week', v_context.week, 'open', coalesce(v_enabled and v_context.can_change, false),
    'canCheck', coalesce(v_context.can_check, false),
    'firstKickoffAt', qb_observation.iso(v_context.first_kickoff_at), 'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'abbr', c.abbr, 'name', c.team_name, 'qbId', c.qb_id, 'qbName', c.qb_name,
        'available', c.qb_id is not null and not c.reserved, 'reserved', c.reserved
      ) order by c.team_name)
      from qb_observation.regular_menu_choices(v_context.season, v_context.week) c
    ), '[]'::jsonb));
end
$$;

create function public.manage_regular_qb_menu(
  p_season integer, p_week integer, p_team text, p_action text,
  p_qb_id uuid default null, p_note text default null, p_entry_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_enabled boolean;
  v_context record;
  v_choice record;
  v_existing qb_observation.regular_menu_overrides;
  v_qb public.qbs;
  v_entry qb_observation.entries;
  v_athlete text;
  v_name text;
  v_expected_current text;
  v_team text := qb_observation.regular_team_abbr(p_team);
  v_note text := nullif(btrim(p_note), '');
begin
  if not exists (select 1 from public.users where id = v_actor and is_admin) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_season is null or p_season not between 2000 and 2100 or p_week is null or p_week not between 1 and 18
    or coalesce(v_team, '') !~ '^[A-Z]{2,3}$' or p_action is null or p_action not in ('assign', 'unavailable')
    or (p_action = 'assign' and (p_qb_id is null) = (p_entry_id is null))
    or (p_action = 'unavailable' and (p_qb_id is not null or p_entry_id is not null))
    or v_note is null or length(v_note) > 500 then
    raise exception 'Paramètres du titulaire QB invalides' using errcode = '22023';
  end if;

  -- Calendar/catalog locks precede settings, as in the lifecycle publishers.
  -- Hold the calendar steady between the last kickoff check and the write.
  lock table public.games in share mode;
  lock table public.qbs in row exclusive mode;
  select enabled into v_enabled from qb_observation.regular_menu_config for share;
  perform pg_advisory_xact_lock(1654741114, p_season * 100 + p_week);
  perform 1 from public.settings s where s.id = 1 for share;
  select * into v_context from qb_observation.regular_menu_context();
  if not coalesce(v_enabled and v_context.can_change, false)
    or v_context.season is distinct from p_season or v_context.week is distinct from p_week then
    raise exception 'Menu QB désactivé, gelé ou calendrier non vérifié' using errcode = '23514';
  end if;

  select * into strict v_choice from qb_observation.regular_menu_choices(p_season, p_week) c
    where c.abbr = v_team;
  if p_entry_id is not null then
    -- An exact replay of an already-applied candidate has no side effects.
    select * into v_existing from qb_observation.regular_menu_overrides o
    where o.season = p_season and o.week = p_week and o.team_id = v_choice.team_id
      and o.game_id = v_choice.game_id and o.source_entry_id = p_entry_id
      and o.qb_id = v_choice.qb_id;
    if found then
      return jsonb_build_object('season', p_season, 'week', p_week, 'team', v_team,
        'action', p_action, 'qbId', v_existing.qb_id);
    end if;
    select e.* into v_entry from qb_observation.entries e
    join qb_observation.runs r on r.run_id = e.run_id
    join public.games g on g.id = v_choice.game_id and g.external_game_id = e.event_id
    cross join qb_observation.calendar(p_season, p_week) cal
    where e.id = p_entry_id and e.season = p_season and e.week = p_week and e.team = v_team
      and qb_observation.current_projection(e)
      and r.event_ids = cal.event_ids and r.observed_at > clock_timestamp() - interval '3 hours'
      and e.first_detected_at < v_context.first_kickoff_at and e.decision->>'status' = 'ambiguous'
    for update of e;
    v_athlete := v_entry.decision->'newQB'->>'id';
    v_name := v_entry.decision->'newQB'->>'name';
    v_expected_current := coalesce(v_choice.athlete_id, qb_observation.baseline(p_season,p_week)->v_team->>'id');
    if coalesce(v_athlete, '') !~ '^[0-9]{1,18}$' or v_athlete is distinct from v_entry.decision->>'espnAthleteId'
      or v_expected_current is null or v_entry.decision->'previousQB'->>'id' is distinct from v_expected_current
      or coalesce(v_name, '') !~ '[^[:space:]]' or length(v_name) > 120 then
      raise exception 'Signal QB périmé ou identité non vérifiée' using errcode = '23514';
    end if;
    select * into v_qb from public.qbs where espn_athlete_id = v_athlete for share;
    if not found then
      insert into public.qbs (name, team, espn_athlete_id, active, is_active_starter)
        values (v_name, coalesce(v_choice.qb_team, v_choice.team_name), v_athlete, false, false)
        on conflict (espn_athlete_id) do nothing
        returning * into v_qb;
      if not found then
        select * into v_qb from public.qbs where espn_athlete_id = v_athlete for share;
      end if;
    end if;
  elsif p_qb_id is not null then
    select * into v_qb from public.qbs where id = p_qb_id and active for share;
  end if;

  if p_action = 'assign' and (v_qb.id is null or
     qb_observation.regular_team_id(v_qb.team) is distinct from v_choice.team_id or
     coalesce(v_qb.name, '') !~ '[^[:space:]]' or coalesce(v_qb.espn_athlete_id, '') !~ '^[0-9]{1,18}$') then
    raise exception 'QB absent du catalogue ou autre équipe' using errcode = '23514';
  end if;

  -- Recheck after waiting on the catalog row/unique key. A valid old report
  -- or an in-flight request is no permission to publish after kickoff.
  select * into v_context from qb_observation.regular_menu_context();
  if not coalesce(v_context.can_change, false) or clock_timestamp() >= v_context.first_kickoff_at then
    raise exception 'Menu QB gelé ou calendrier non vérifié' using errcode = '23514';
  end if;
  insert into qb_observation.regular_menu_overrides as saved
    (season, week, team_id, game_id, qb_id, expected_athlete_id, source_entry_id, note, actor_id, updated_at)
    values (p_season, p_week, v_choice.team_id, v_choice.game_id, v_qb.id, v_qb.espn_athlete_id,
      p_entry_id, v_note, v_actor, clock_timestamp())
  on conflict (season, week, team_id) do update
    set game_id = excluded.game_id, qb_id = excluded.qb_id, expected_athlete_id = excluded.expected_athlete_id,
      source_entry_id = excluded.source_entry_id, note = excluded.note,
      actor_id = excluded.actor_id, updated_at = excluded.updated_at
    where (saved.game_id, saved.qb_id, saved.expected_athlete_id, saved.source_entry_id) is distinct from
      (excluded.game_id, excluded.qb_id, excluded.expected_athlete_id, excluded.source_entry_id);
  if p_entry_id is not null then
    update qb_observation.entries set dismissed_at = clock_timestamp(),
      decision = decision || '{"reviewOutcome":"confirmed"}'::jsonb
    where id = p_entry_id;
  end if;
  return jsonb_build_object('season', p_season, 'week', p_week, 'team', v_team,
    'action', p_action, 'qbId', v_qb.id);
end
$$;

create function qb_observation.regular_menu_override_baseline(p_season integer, p_week integer, p_catalog jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select p_catalog || coalesce((
    select jsonb_object_agg(c.abbr, jsonb_strip_nulls(jsonb_build_object(
      'id', c.athlete_id, 'name', c.qb_name, 'publishedAt', p_catalog->c.abbr->>'publishedAt'
    )))
    from qb_observation.regular_menu_choices(p_season, p_week) c
    join qb_observation.regular_menu_overrides o
      on o.season = p_season and o.week = p_week and o.team_id = c.team_id
    where c.qb_id is not null and c.abbr is not null
      and (select enabled from qb_observation.regular_menu_config)
  ), '{}'::jsonb)
$$;

revoke all on all functions in schema qb_observation from public, anon, authenticated, service_role;
revoke all on function public.read_regular_qb_menu(integer,integer), public.read_regular_qb_menu_admin(),
  public.manage_regular_qb_menu(integer,integer,text,text,uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_regular_qb_menu(integer,integer), public.read_regular_qb_menu_admin(),
  public.manage_regular_qb_menu(integer,integer,text,text,uuid,text,uuid) to authenticated;

commit;
