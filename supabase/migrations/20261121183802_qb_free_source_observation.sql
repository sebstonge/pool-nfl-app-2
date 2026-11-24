-- No job, worker, menu, secret or automation is enabled by installation.
-- Existing installed migrations remain unchanged; source state stays in the private journal.
begin;

alter table qb_observation.runs add column source_state jsonb
  check (source_state is null or (jsonb_typeof(source_state) = 'object'
    and octet_length(source_state::text) <= 98304)),
  add column sleeper_requested_at timestamptz;
alter table qb_observation.regular_menu_config
  add column automation_enabled boolean not null default false;

-- Observation remains independent of the menu and disabled on installation.
create table qb_observation.transport_control (
  singleton boolean primary key default true check (singleton),
  dispatch_enabled boolean not null default false,
  hmac_secret text check (hmac_secret ~ '^[0-9a-f]{64}$'),
  check (not dispatch_enabled or hmac_secret is not null)
);
insert into qb_observation.transport_control default values;

-- Keep signed request identifiers only for their authentication window.
create table qb_observation.exchange_nonces (
  nonce uuid primary key,
  expires_at timestamptz not null
);

alter table qb_observation.transport_control enable row level security;
alter table qb_observation.exchange_nonces enable row level security;
revoke all on qb_observation.transport_control, qb_observation.exchange_nonces
  from public, anon, authenticated, service_role, authenticator;

-- A failed source refresh may still carry a validated cache attempt. Only harvested
-- states are stored; season boundaries never reuse identities or sticky exclusions.
create function qb_observation.latest_source_state(p_season integer) returns jsonb
language sql stable set search_path = '' as $$
  select r.source_state from qb_observation.runs r
  where r.season = p_season and r.source_state is not null
  order by r.observed_at desc, r.dispatched_at desc, r.run_id desc limit 1
$$;

create function qb_observation.source_team(p_value text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_value in ('ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU',
    'IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'), false)
$$;

-- Use both calendars. A recorded score closes the window even if a kickoff
-- timestamp has not yet been corrected in the pool calendar.
create function qb_observation.regular_menu_frozen(
  p_season integer, p_week integer, p_report_cutoff timestamptz default null
) returns boolean language sql volatile set search_path = '' as $$
  select coalesce(c.has_scores or clock_timestamp() >=
    least(c.first_kickoff_at, p_report_cutoff, (
      select min(r.first_kickoff_at)
      from qb_observation.runs r
      join public.qb_selection_weeks w
        on w.season = r.season and w.week = r.week and w.started_at = r.opened_at
      where r.season = p_season and r.week = p_week
        and r.observed_at is not null and r.event_ids = c.event_ids
    )), false)
  from qb_observation.calendar(p_season, p_week) c
$$;

create function qb_observation.normalize_source_state(
  p_state jsonb, p_observed_at timestamptz, p_previous jsonb,
  p_opened_at timestamptz, p_baseline jsonb, p_allow_new boolean,
  p_stale_teams text[] default '{}'
) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_sleeper jsonb := p_state->'sleeper';
  v_player jsonb;
  v_absence jsonb;
  v_signal jsonb;
  v_attempted_at timestamptz;
  v_fetched_at timestamptz;
  v_since timestamptz;
  v_players jsonb := '[]';
  v_absences jsonb;
  v_incoming_absences jsonb := '[]';
  v_prior_absence jsonb;
  v_rearm boolean;
  v_signals jsonb := '[]';
  v_seen text[] := '{}';
  v_output jsonb;
begin
  if jsonb_typeof(p_state) is distinct from 'object' or p_state->'version' is distinct from '1'::jsonb
    or p_state - array['version','sleeper','absences','signals','observedAt'] <> '{}'
    or octet_length(p_state::text) > 98304
    or jsonb_typeof(p_state->'observedAt') is distinct from 'string'
    or qb_observation.parse_iso(p_state->>'observedAt') is distinct from p_observed_at
    or jsonb_typeof(v_sleeper) is distinct from 'object'
    or v_sleeper - array['attemptedAt','fetchedAt','players'] <> '{}'
    or coalesce(jsonb_typeof(v_sleeper->'attemptedAt'),'null') not in ('null','string')
    or coalesce(jsonb_typeof(v_sleeper->'fetchedAt'),'null') not in ('null','string')
    or jsonb_typeof(v_sleeper->'players') is distinct from 'array'
    or jsonb_typeof(p_state->'absences') is distinct from 'array'
    or jsonb_typeof(p_state->'signals') is distinct from 'array' then
    raise exception 'Invalid structured source state' using errcode = '22023';
  end if;
  if jsonb_array_length(v_sleeper->'players') > 256 or jsonb_array_length(p_state->'absences') > 256
    or jsonb_array_length(p_state->'signals') > 32 then
    raise exception 'Invalid structured source state length' using errcode = '22023';
  end if;
  v_attempted_at := qb_observation.parse_iso(v_sleeper->>'attemptedAt');
  v_fetched_at := qb_observation.parse_iso(v_sleeper->>'fetchedAt');
  if v_attempted_at > p_observed_at or v_fetched_at > p_observed_at
    or (v_fetched_at is not null and v_attempted_at is null)
    or (v_fetched_at is null and jsonb_array_length(v_sleeper->'players') > 0) then
    raise exception 'Invalid structured cache timestamp' using errcode = '22023';
  end if;

  for v_player in select value from jsonb_array_elements(v_sleeper->'players') loop
    if jsonb_typeof(v_player) is distinct from 'object'
      or v_player - array['id','name','team','status','injuryStatus'] <> '{}'
      or jsonb_typeof(v_player->'id') is distinct from 'string'
      or coalesce(v_player->>'id','') !~ '^[0-9]{1,18}$'
      or v_player->>'id' = any(v_seen)
      or jsonb_typeof(v_player->'name') is distinct from 'string'
      or coalesce(v_player->>'name','') !~ '[^[:space:]]' or length(v_player->>'name') > 120
      or coalesce(jsonb_typeof(v_player->'team'),'null') not in ('null','string')
      or (v_player->>'team' is not null and not qb_observation.source_team(v_player->>'team'))
      or coalesce(jsonb_typeof(v_player->'status'),'null') not in ('null','string')
      or coalesce(jsonb_typeof(v_player->'injuryStatus'),'null') not in ('null','string')
      or length(v_player->>'status') > 64 or length(v_player->>'injuryStatus') > 64 then
      raise exception 'Invalid structured cache player' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_player->>'id');
    v_players := v_players || jsonb_build_array(jsonb_build_object('id',v_player->>'id','name',v_player->>'name',
      'team',v_player->>'team','status',v_player->>'status','injuryStatus',v_player->>'injuryStatus'));
  end loop;

  v_seen := '{}';
  for v_absence in select value from jsonb_array_elements(p_state->'absences') loop
    if jsonb_typeof(v_absence) is distinct from 'object'
      or v_absence - array['id','name','team','since','reason'] <> '{}'
      or jsonb_typeof(v_absence->'id') is distinct from 'string'
      or coalesce(v_absence->>'id','') !~ '^[0-9]{1,18}$'
      or concat_ws(':',v_absence->>'id',v_absence->>'team') = any(v_seen)
      or jsonb_typeof(v_absence->'name') is distinct from 'string'
      or coalesce(v_absence->>'name','') !~ '[^[:space:]]' or length(v_absence->>'name') > 120
      or not qb_observation.source_team(v_absence->>'team')
      or v_absence->>'reason' is distinct from 'sleeper_unavailable'
      or jsonb_typeof(v_absence->'since') is distinct from 'string' then
      raise exception 'Invalid structured absence' using errcode = '22023';
    end if;
    v_since := qb_observation.parse_iso(v_absence->>'since');
    if v_since is null or v_since > p_observed_at then
      raise exception 'Invalid structured absence timestamp' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, concat_ws(':',v_absence->>'id',v_absence->>'team'));
    select item into v_prior_absence from jsonb_array_elements(coalesce(p_previous->'absences','[]')) item
      where item->>'id' = v_absence->>'id' and item->>'team' = v_absence->>'team';
    v_rearm := coalesce(p_allow_new and not (v_absence->>'team' = any(p_stale_teams))
      and v_prior_absence is not null
      and v_since > qb_observation.parse_iso(v_prior_absence->>'since')
      and v_fetched_at > qb_observation.parse_iso(p_previous->'sleeper'->>'fetchedAt')
      and exists (
        select 1 from jsonb_array_elements(coalesce(p_previous->'sleeper'->'players','[]')) prior_player
        where prior_player->>'id' = v_absence->>'id' and prior_player->>'team' = v_absence->>'team'
          and coalesce(upper(btrim(prior_player->>'status')),'') not in ('OUT','IR','PUP','SUSPENDED')
          and coalesce(upper(btrim(prior_player->>'injuryStatus')),'') not in ('OUT','IR','PUP','SUSPENDED')
      ),false);
    if v_prior_absence is not null and not v_rearm then
      v_incoming_absences := v_incoming_absences || jsonb_build_array(v_prior_absence);
    elsif p_allow_new and not (v_absence->>'team' = any(p_stale_teams)) then
      -- A cache from before this selection window cannot create an authoritative
      -- absence. Neither INACTIVE nor a missing/nullable status is sufficient.
      if v_fetched_at is null or v_fetched_at < p_opened_at
        or v_fetched_at < p_observed_at - interval '36 hours' or v_since < p_opened_at
        or p_baseline->(v_absence->>'team')->>'id' is distinct from v_absence->>'id'
        or not exists (
          select 1 from jsonb_array_elements(v_players) player
          where player->>'id' = v_absence->>'id' and player->>'team' = v_absence->>'team'
            and regexp_replace(lower(player->>'name'),'[^a-z0-9]','','g') =
              regexp_replace(lower(p_baseline->(v_absence->>'team')->>'name'),'[^a-z0-9]','','g')
            and (upper(btrim(player->>'status')) in ('OUT','IR','PUP','SUSPENDED')
              or upper(btrim(player->>'injuryStatus')) in ('OUT','IR','PUP','SUSPENDED'))
        ) then
        raise exception 'Structured absence without current source proof' using errcode = '22023';
      end if;
      v_incoming_absences := v_incoming_absences || jsonb_build_array(jsonb_build_object(
        'id',v_absence->>'id','name',v_absence->>'name','team',v_absence->>'team',
        'since',qb_observation.iso(v_since),'reason','sleeper_unavailable'));
    end if;
  end loop;
  -- Provider silence, a new week and an Active status cannot remove a prior absence.
  -- A transition keeps its original timestamp. Only a newly fetched unavailable
  -- status following a known non-unavailable row may rearm a confirmed return.
  select coalesce(jsonb_agg(chosen.item order by chosen.item->>'id',chosen.item->>'team'), '[]') into v_absences
  from (
    select distinct on (item->>'id',item->>'team') item
    from jsonb_array_elements(v_incoming_absences || coalesce(p_previous->'absences','[]'))
      with ordinality expanded(item,ordinal)
    order by item->>'id', item->>'team', ordinal
  ) chosen;
  if jsonb_array_length(v_absences) > 256 then
    raise exception 'Invalid accumulated absence length' using errcode = '22023';
  end if;

  v_seen := '{}';
  for v_signal in select value from jsonb_array_elements(p_state->'signals') loop
    if jsonb_typeof(v_signal) is distinct from 'object' or v_signal - array['team','key'] <> '{}'
      or not qb_observation.source_team(v_signal->>'team') or v_signal->>'team' = any(v_seen)
      or jsonb_typeof(v_signal->'key') is distinct from 'string'
      or coalesce(v_signal->>'key','') !~ '[^[:space:]]' or length(v_signal->>'key') > 500 then
      raise exception 'Invalid structured signal key' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen,v_signal->>'team');
    v_signals := v_signals || jsonb_build_array(jsonb_build_object('team',v_signal->>'team',
      'key',case when v_signal->>'team' = any(p_stale_teams) then 'review:stale_baseline' else v_signal->>'key' end));
  end loop;
  v_output := jsonb_build_object('version',1,'sleeper',jsonb_build_object(
    'attemptedAt',qb_observation.iso(v_attempted_at),'fetchedAt',qb_observation.iso(v_fetched_at),'players',v_players),
    'absences',v_absences,'signals',v_signals,'observedAt',qb_observation.iso(p_observed_at));
  if octet_length(v_output::text) > 98304 then
    raise exception 'Structured source state too large' using errcode = '22023';
  end if;
  return v_output;
end
$$;

create or replace function qb_observation.harvest(
  p_run qb_observation.runs, p_body jsonb, p_worker_started_at timestamptz, p_http_status integer
) returns void language plpgsql set search_path = '' as $$
declare
  v_observed_at timestamptz;
  v_cutoff timestamptz;
  v_status text := p_body->>'status';
  v_calendar record;
  v_current_context boolean;
  v_decision jsonb;
  v_match jsonb;
  v_previous jsonb;
  v_new jsonb;
  v_url text;
  v_key text;
  v_projection boolean;
  v_structured boolean;
  v_source_state jsonb;
  v_current_baseline jsonb;
  v_stale_teams text[] := '{}';
  v_stale_signal boolean;
  v_transition text;
  v_teams_seen text[] := '{}';
  v_team text;
  v_published_at timestamptz;
  v_match_kickoff timestamptz;
  v_scoped boolean;
  v_errors jsonb := '[]';
  v_error jsonb;
  v_origin text;
  v_retry_at timestamptz;
begin
  if jsonb_typeof(p_body) is distinct from 'object'
    or p_body->'mode' is distinct from '"observation"'::jsonb
    or p_body->'runId' is distinct from to_jsonb(p_run.run_id)
    or p_body->'season' is distinct from to_jsonb(p_run.season)
    or p_body->'week' is distinct from to_jsonb(p_run.week)
    or p_body->'revision' is distinct from to_jsonb(p_run.revision)
    or v_status is null or v_status not in ('completed','skipped','failed')
    or jsonb_typeof(p_body->'decisions') is distinct from 'array'
    or jsonb_typeof(p_body->'errors') is distinct from 'array'
    or jsonb_typeof(p_body->'observedAt') is distinct from 'string'
    or coalesce(jsonb_typeof(p_body->'firstKickoffAt'), 'null') not in ('null','string')
    or coalesce(jsonb_typeof(p_body->'reason'), 'null') not in ('null','string')
    or coalesce(jsonb_typeof(p_body->'counts'), 'null') not in ('null','object')
    or coalesce(jsonb_typeof(p_body->'httpRequests'), 'null') not in ('null','object') then
    raise exception 'Invalid observation response' using errcode = '22023';
  end if;
  if jsonb_array_length(p_body->'decisions') > 32 or jsonb_array_length(p_body->'errors') > 200
    or (v_status <> 'completed' and jsonb_array_length(p_body->'decisions') > 0) then
    raise exception 'Invalid observation response length' using errcode = '22023';
  end if;

  v_observed_at := qb_observation.parse_iso(p_body->>'observedAt');
  -- The report must belong to the issued work within its collection budget.
  if v_observed_at < date_trunc('milliseconds', p_run.dispatched_at) - interval '30 seconds'
    or v_observed_at > least(p_worker_started_at + interval '85 seconds', clock_timestamp() + interval '30 seconds') then
    raise exception 'Observation timestamp outside request' using errcode = '22023';
  end if;
  if p_body ? 'sourceState' and p_body->'sourceState' <> 'null'::jsonb then
    lock table public.games in share mode;
    lock table public.qbs in share mode;
    perform pg_advisory_xact_lock(1654741114,p_run.season * 100 + p_run.week);
    perform 1 from public.settings s where s.id = 1 for share;
  end if;
  select * into v_calendar from qb_observation.calendar(p_run.season, p_run.week);
  v_cutoff := least(p_run.first_kickoff_at, v_calendar.first_kickoff_at,
    qb_observation.parse_iso(p_body->>'firstKickoffAt'));
  if v_status = 'skipped' and p_body->>'reason' = 'first_kickoff_reached' then
    v_cutoff := least(v_cutoff, v_observed_at);
  end if;
  select exists (
    select 1 from public.settings s
    join public.qb_selection_weeks w on w.season = s.current_season and w.week = s.current_week
    where s.id = 1 and s.phase = 'regular' and s.regular_finalized_at is null and not s.regular_writes_paused
      and s.current_season = p_run.season and s.current_week = p_run.week
      and s.revision = p_run.revision and w.started_at = p_run.opened_at
  ) and v_calendar.complete and v_calendar.event_ids = p_run.event_ids into v_current_context;

  if v_current_context then
    -- A validated weekly correction may have committed while this worker was
    -- reading providers. Keep its cache, but never apply the former offer's
    -- new absence or rearm an old absence against the newly confirmed QB.
    v_current_baseline := qb_observation.regular_menu_override_baseline(p_run.season,p_run.week,
      qb_observation.baseline(p_run.season,p_run.week));
    select coalesce(array_agg(previous.key),'{}') into v_stale_teams
    from jsonb_each(p_run.baseline) previous
    where previous.value->>'id' is distinct from v_current_baseline->previous.key->>'id';
  end if;

  if p_body ? 'sourceState' and p_body->'sourceState' <> 'null'::jsonb then
    -- A late or stale response remains a journal entry, never a new global cache
    -- or exclusion. Verification happens before any state becomes selectable.
    if v_current_context and v_observed_at >= p_run.opened_at and v_observed_at < v_cutoff
      and clock_timestamp() < v_cutoff then
      v_source_state := qb_observation.normalize_source_state(p_body->'sourceState', v_observed_at,
        qb_observation.latest_source_state(p_run.season), p_run.opened_at, p_run.baseline,
        v_status = 'completed',v_stale_teams);
    else
      perform qb_observation.normalize_source_state(p_body->'sourceState', v_observed_at,
        qb_observation.latest_source_state(p_run.season),p_run.opened_at,p_run.baseline,false);
    end if;
  end if;

  for v_decision in select value from jsonb_array_elements(p_body->'decisions') loop
    v_match := v_decision->'match';
    v_previous := v_decision->'previousQB';
    v_new := v_decision->'newQB';
    v_team := v_decision->>'team';
    v_url := case when v_decision->>'url' = 'https://api.sleeper.app/v1/players/nfl?position=QB'
      then 'https://api.sleeper.app/v1/players/nfl?position=QB'
      else regexp_replace(split_part(split_part(v_decision->>'url', '?', 1), '#', 1), '/$', '') end;
    v_projection := v_decision->>'reason' = 'nflverse_projection';
    v_structured := v_decision->>'reason' in ('nflverse_projection','sleeper_unavailable',
      'sleeper_return_review','source_conflict','source_missing');
    if jsonb_typeof(v_decision) is distinct from 'object'
      or jsonb_typeof(v_decision->'url') is distinct from 'string'
      or not coalesce(case when v_structured then
        v_url in ('https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv.gz',
          'https://api.sleeper.app/v1/players/nfl?position=QB')
      else v_url ~* '^https://[a-z0-9]+([.-][a-z0-9]+)+/news/[a-zA-Z0-9][a-zA-Z0-9_-]*$' end, false)
      or length(v_url) > 500
      or v_decision->>'status' is null or v_decision->>'status' not in ('proposed','ambiguous','rejected')
      or jsonb_typeof(v_decision->'reason') is distinct from 'string'
      or v_decision->>'reason' !~ '^[a-z][a-z0-9_]{0,63}$'
      or (v_team is not null and v_team !~ '^[A-Z]{2,3}$')
      or coalesce(jsonb_typeof(v_match), 'null') not in ('null','object')
      or coalesce(jsonb_typeof(v_previous), 'null') not in ('null','object')
      or coalesce(jsonb_typeof(v_new), 'null') not in ('null','object')
      or coalesce(jsonb_typeof(v_decision->'publishedAt'), 'null') not in ('null','string')
      or coalesce(jsonb_typeof(v_decision->'espnAthleteId'), 'null') not in ('null','string')
      or coalesce(jsonb_typeof(v_decision->'title'), 'null') not in ('null','string')
      or coalesce(jsonb_typeof(v_decision->'evidence'), 'null') not in ('null','string') then
      raise exception 'Invalid observation decision' using errcode = '22023';
    end if;
    v_published_at := qb_observation.parse_iso(v_decision->>'publishedAt');
    v_match_kickoff := qb_observation.parse_iso(v_match->>'kickoffAt');
    if jsonb_typeof(v_match) = 'object' and (
      not coalesce(v_match->>'id' = any(p_run.event_ids), false)
      or jsonb_typeof(v_match->'id') is distinct from 'string'
      or coalesce(v_match->>'opponent', '') !~ '^[A-Z]{2,3}$'
      or v_team is null or v_match->>'opponent' = v_team or v_match_kickoff is null
    ) then
      raise exception 'Observation match outside request' using errcode = '22023';
    end if;
    if v_structured then
      if v_team = any(v_teams_seen) or not qb_observation.source_team(v_team)
        or v_match_kickoff is null or v_decision->>'status' <> 'ambiguous' or v_published_at is not null
        or p_run.baseline->v_team is null
        or v_previous->>'id' is distinct from p_run.baseline->v_team->>'id'
        or v_previous->>'name' is distinct from p_run.baseline->v_team->>'name'
        or (jsonb_typeof(v_new) = 'object' and (
          coalesce(v_new->>'id','') !~ '^[0-9]{1,18}$'
          or coalesce(v_new->>'name','') !~ '[^[:space:]]' or length(v_new->>'name') > 120
          or v_new->>'id' is distinct from v_decision->>'espnAthleteId'))
        or (coalesce(jsonb_typeof(v_new),'null') = 'null' and v_decision->>'espnAthleteId' is not null)
        or (v_projection and (jsonb_typeof(v_new) is distinct from 'object'
          or v_new->>'id' = v_previous->>'id')) then
        raise exception 'Structured signal outside request' using errcode = '22023';
      end if;
      v_teams_seen := array_append(v_teams_seen,v_team);
    elsif v_decision->>'status' = 'proposed' and (
      v_team is null or v_match_kickoff is null or v_published_at is null
      or p_run.baseline->v_team is null
      or v_previous->>'id' is distinct from p_run.baseline->v_team->>'id'
      or v_previous->>'name' is distinct from p_run.baseline->v_team->>'name'
      or coalesce(v_new->>'id', '') !~ '^[0-9]{1,18}$'
      or coalesce(v_new->>'name', '') !~ '[^[:space:]]'
      or v_new->>'id' is distinct from v_decision->>'espnAthleteId'
      or v_new->>'id' = v_previous->>'id'
    ) then
      raise exception 'Observation proposal outside request' using errcode = '22023';
    end if;
    select qb_observation.iso(max(qb_observation.parse_iso(absence->>'since'))) into v_transition
    from jsonb_array_elements(coalesce(v_source_state->'absences','[]')) absence
    where absence->>'team' = v_team;
    v_key := case when v_projection then concat_ws(':', 'nflverse', v_match->>'id', v_team, v_new->>'id')
      when v_structured then concat_ws(':','structured',v_match->>'id',v_team,v_decision->>'reason',
        v_previous->>'id',coalesce(v_new->>'id','none'),v_transition) else v_url end;
    v_stale_signal := v_structured and v_team = any(v_stale_teams);
    if v_stale_signal then
      -- A stale result gets its own diagnostic entry. Do not overwrite the
      -- earlier, valid signal or make this old-reference candidate confirmable.
      v_key := 'stale:' || v_key;
    end if;

    -- These are the fixture-scoped signals that resolveLatest treats as
    -- chronological evidence, including contradictory or same-QB reports.
    v_scoped := coalesce(v_current_context and v_team is not null and v_match_kickoff is not null
      and v_observed_at >= p_run.opened_at and v_observed_at < least(v_cutoff, v_match_kickoff)
      and v_published_at <= v_observed_at and (
        v_decision->>'status' = 'proposed' or v_decision->>'reason' in (
          'same_qb','qualified_announcement','qb_ineligible','conflicting_announcements',
          'multiple_candidates','starter_denied','contradictory_article'
        )
      ), false);
    insert into qb_observation.entries as saved
      (season, week, url, source_key, run_id, decision, team, event_id, published_at,
       first_detected_at, last_detected_at, scoped_before_freeze)
    values (
      p_run.season, p_run.week, v_url, v_key, p_run.run_id,
      jsonb_build_object(
        'url', v_url, 'team', v_team, 'match', case when v_match_kickoff is not null then
          jsonb_build_object('id', v_match->>'id', 'opponent', v_match->>'opponent',
            'kickoffAt', qb_observation.iso(v_match_kickoff)) end,
        'previousQB', case when jsonb_typeof(v_previous) = 'object' then
          jsonb_build_object('id', left(v_previous->>'id', 20), 'name', left(v_previous->>'name', 120)) end,
        'newQB', case when jsonb_typeof(v_new) = 'object' then
          jsonb_build_object('id', left(v_new->>'id', 20), 'name', left(v_new->>'name', 120)) end,
        'espnAthleteId', left(v_decision->>'espnAthleteId', 20), 'publishedAt', qb_observation.iso(v_published_at),
        'title', left(v_decision->>'title', 500), 'evidence', left(v_decision->>'evidence', 500),
        'status', v_decision->>'status', 'reason', v_decision->>'reason'
      ) || case when v_stale_signal then jsonb_build_object(
        'status','rejected','reason','stale_baseline','originalReason',v_decision->>'reason'
      ) else '{}'::jsonb end,
      v_team, v_match->>'id', v_published_at, v_observed_at, v_observed_at, v_scoped
    )
    on conflict (season, week, source_key) do update
      set last_detected_at = greatest(saved.last_detected_at, excluded.last_detected_at),
          run_id = case when v_structured then excluded.run_id else saved.run_id end,
          decision = case when v_structured then excluded.decision ||
            jsonb_strip_nulls(jsonb_build_object('reviewOutcome', saved.decision->'reviewOutcome'))
            else saved.decision end;
  end loop;

  for v_error in select value from jsonb_array_elements(p_body->'errors') loop
    if jsonb_typeof(v_error) is distinct from 'object'
      or jsonb_typeof(v_error->'message') is distinct from 'string'
      or coalesce(jsonb_typeof(v_error->'url'), 'null') not in ('null','string')
      or coalesce(jsonb_typeof(v_error->'status'), 'null') not in ('null','number')
      or coalesce(jsonb_typeof(v_error->'retryAfter'), 'null') not in ('null','string') then
      raise exception 'Invalid observation error' using errcode = '22023';
    end if;
    v_errors := v_errors || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'url', left(v_error->>'url', 500), 'message', left(v_error->>'message', 300),
      'status', v_error->'status', 'retryAfter', left(v_error->>'retryAfter', 100)
    )));
    v_origin := substring(v_error->>'url' from '^(https://[a-z0-9]+(?:[.-][a-z0-9]+)+)/');
    v_retry_at := qb_observation.retry_at(v_error->>'retryAfter', v_observed_at);
    if v_origin is not null and v_retry_at > clock_timestamp() then
      insert into qb_observation.origin_backoff as saved (origin, retry_at) values (v_origin, v_retry_at)
      on conflict (origin) do update set retry_at = greatest(saved.retry_at, excluded.retry_at);
    end if;
  end loop;

  -- Journal and backoff writes can wait. Lock the run before the last time
  -- check, so a wait on the run itself cannot publish a late availability state.
  if v_source_state is not null then
    perform 1 from qb_observation.runs where run_id = p_run.run_id for update;
    if qb_observation.regular_menu_frozen(p_run.season, p_run.week, v_cutoff) then
      v_source_state := null;
    end if;
  end if;

  update qb_observation.runs set
    source_state = v_source_state, status = v_status, reason = left(p_body->>'reason', 200), observed_at = v_observed_at,
    first_kickoff_at = v_cutoff, harvested_at = clock_timestamp(), http_status = p_http_status,
    errors = v_errors, counts = nullif(p_body->'counts','null'), http_requests = nullif(p_body->'httpRequests','null')
  where run_id = p_run.run_id;
end
$$;

-- Retire the earlier outbound transport, including its manual entry point.
create or replace function qb_observation.tick(p_manual boolean) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('status','inactive','reason','outbound_transport_retired')
$$;
revoke all on function public.request_qb_observation_check()
  from public, anon, authenticated, service_role, authenticator;
revoke all on function public.run_qb_observation_tick()
  from public, anon, authenticated, service_role, authenticator;

create function qb_observation.claim_push() returns jsonb
language plpgsql set search_path = '' set lock_timeout = '750ms' as $$
declare
  v_now timestamptz;
  v_settings public.settings;
  v_opened_at timestamptz;
  v_calendar record;
  v_period integer;
  v_run_id uuid;
  v_baseline jsonb;
  v_seen_urls jsonb;
  v_backoff jsonb;
  v_source_state jsonb;
  v_allow_sleeper_fetch boolean;
begin
  if not coalesce((select dispatch_enabled from qb_observation.transport_control where singleton),false) then
    return jsonb_build_object('status', 'inactive');
  end if;
  -- Match the lifecycle and harvest lock order. No collection is performed
  -- inside this transaction, and the caller caps the statement lock wait.
  lock table public.games in share mode;
  select * into v_settings from public.settings where id = 1 for share;
  if v_settings.id is null or v_settings.phase <> 'regular' or v_settings.regular_finalized_at is not null
    or v_settings.regular_writes_paused or v_settings.current_season not between 2000 and 2100
    or v_settings.current_week not between 1 and 18 or v_settings.revision not between 0 and 9007199254740991 then
    return jsonb_build_object('status', 'inactive');
  end if;
  select w.started_at into v_opened_at from public.qb_selection_weeks w
    where w.season = v_settings.current_season and w.week = v_settings.current_week for share;
  select * into v_calendar from qb_observation.calendar(v_settings.current_season, v_settings.current_week);
  v_now := clock_timestamp();
  if v_opened_at is null or not isfinite(v_opened_at) or v_opened_at > v_now
    or not v_calendar.complete or v_calendar.has_scores or v_now >= v_calendar.first_kickoff_at then
    return jsonb_build_object('status', 'outside_window');
  end if;
  -- A matching completed observation may tighten the local kickoff.
  select least(v_calendar.first_kickoff_at, min(r.first_kickoff_at)) into v_calendar.first_kickoff_at
  from qb_observation.runs r where r.season = v_settings.current_season and r.week = v_settings.current_week
    and r.opened_at = v_opened_at and r.observed_at is not null and r.event_ids = v_calendar.event_ids;
  if v_now >= v_calendar.first_kickoff_at then
    return jsonb_build_object('status', 'outside_window');
  end if;

  update qb_observation.runs set status = 'response_failed', reason = 'report_missing',
    harvested_at = v_now
    where status = 'pending' and request_id is null and dispatched_at < v_now - interval '2 minutes';

  v_period := floor(extract(epoch from v_now - v_opened_at) / 7200)::integer;
  if exists (
    select 1 from qb_observation.runs r
    where r.season = v_settings.current_season and r.week = v_settings.current_week and r.opened_at = v_opened_at
      and (r.period = v_period or r.status = 'pending')
  ) then
    return jsonb_build_object('status', 'already_dispatched');
  end if;

  v_baseline := qb_observation.regular_menu_override_baseline(
    v_settings.current_season, v_settings.current_week,
    qb_observation.baseline(v_settings.current_season, v_settings.current_week));
  v_source_state := qb_observation.latest_source_state(v_settings.current_season);
  v_allow_sleeper_fetch := not exists (
    select 1 from qb_observation.runs r where r.sleeper_requested_at > v_now - interval '24 hours'
  ) and coalesce(qb_observation.parse_iso(v_source_state->'sleeper'->>'attemptedAt')
    <= v_now - interval '24 hours', true);
  select coalesce(jsonb_agg(e.url order by e.last_detected_at desc, e.url), '[]') into v_seen_urls
  from (
    select url, last_detected_at from qb_observation.entries
    where season = v_settings.current_season and week = v_settings.current_week
    order by last_detected_at desc, url limit 200
  ) e;
  delete from qb_observation.origin_backoff where retry_at <= v_now;
  select coalesce(jsonb_object_agg(b.origin, qb_observation.iso(b.retry_at)), '{}') into v_backoff
  from (select origin, retry_at from qb_observation.origin_backoff order by retry_at desc limit 64) b;

  -- Consume the provider quota before the external request. A lost worker or
  -- response must not authorize another daily Sleeper read.
  v_now := clock_timestamp();
  if v_now >= v_calendar.first_kickoff_at then
    return jsonb_build_object('status', 'outside_window');
  end if;
  insert into qb_observation.runs
    (season, week, revision, opened_at, period, first_kickoff_at, dispatched_at,
     status, event_ids, baseline, sleeper_requested_at)
    values (v_settings.current_season, v_settings.current_week, v_settings.revision, v_opened_at,
      v_period, v_calendar.first_kickoff_at, v_now, 'pending', v_calendar.event_ids, v_baseline,
      case when v_allow_sleeper_fetch then v_now end)
    returning run_id into v_run_id;
  return jsonb_build_object('status','claimed','payload',jsonb_build_object(
    'runId', v_run_id, 'season', v_settings.current_season, 'week', v_settings.current_week,
    'revision', v_settings.revision, 'openedAt', qb_observation.iso(v_opened_at),
    'dispatchedAt', qb_observation.iso(v_now), 'firstKickoffAt', qb_observation.iso(v_calendar.first_kickoff_at),
    'eventIds', v_calendar.event_ids, 'baseline', v_baseline, 'seenUrls', v_seen_urls,
    'retryAfterByOrigin', v_backoff, 'sourceState', v_source_state,
    'allowSleeperFetch', v_allow_sleeper_fetch));
end
$$;

-- Publishable API key + possession of the distinct observer key, without a
-- database login or general service role. Authenticate exact UTF-8 before
-- interpreting the payload or modifying the nonce journal.
create function public.qb_observer_exchange(p_message text, p_signature text)
returns jsonb language plpgsql security definer set search_path = ''
set lock_timeout = '3500ms' as $$
declare
  v_secret text;
  v_expected bytea;
  v_provided bytea;
  v_diff integer := 0;
  v_message jsonb;
  v_timestamp timestamptz;
  v_now timestamptz;
  v_nonce uuid;
  v_report jsonb;
  v_run qb_observation.runs;
begin
  if p_message is null or octet_length(p_message) not between 2 and 262144
    or p_signature is null or p_signature !~ '^[0-9a-f]{64}$' then
    raise exception 'QB observer authentication refused' using errcode = '42501';
  end if;
  select hmac_secret into v_secret from qb_observation.transport_control where singleton for share;
  if v_secret is null then
    raise exception 'QB observer authentication refused' using errcode = '42501';
  end if;
  v_expected := decode(qb_observation.sign(p_message,v_secret),'hex');
  v_provided := decode(p_signature,'hex');
  -- Compare all bytes without a shortcut at the first differing byte.
  for i in 0..31 loop
    v_diff := v_diff | (get_byte(v_expected,i) # get_byte(v_provided,i));
  end loop;
  if v_diff <> 0 then
    raise exception 'QB observer authentication refused' using errcode = '42501';
  end if;

  begin
    v_message := p_message::jsonb;
    if jsonb_typeof(v_message) <> 'object'
      or v_message - array['action','timestamp','nonce','report'] <> '{}'::jsonb
      or v_message->>'action' is null or v_message->>'action' not in ('claim','report')
      or jsonb_typeof(v_message->'timestamp') is distinct from 'string'
      or right(v_message->>'timestamp', 1) <> 'Z'
      or jsonb_typeof(v_message->'nonce') is distinct from 'string'
      or coalesce(v_message->>'nonce','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (v_message->>'action' = 'claim' and v_message ? 'report')
      or (v_message->>'action' = 'report' and (
        jsonb_typeof(v_message->'report') is distinct from 'string'
        or octet_length(v_message->>'report') not between 2 and 131072
      )) then
      raise exception 'Invalid QB observer message' using errcode = '22023';
    end if;
    v_timestamp := qb_observation.parse_iso(v_message->>'timestamp');
    v_nonce := (v_message->>'nonce')::uuid;
  exception when data_exception then
    raise exception 'Invalid QB observer message' using errcode = '22023';
  end;

  -- Use the established global lock to serialize claims and report ingestion.
  if not pg_try_advisory_xact_lock(187057380, 129404723) then
    return jsonb_build_object('status','busy');
  end if;
  v_now := clock_timestamp();
  if v_timestamp <= v_now - interval '2 minutes' or v_timestamp > v_now + interval '15 seconds' then
    raise exception 'QB observer authentication refused' using errcode = '42501';
  end if;
  delete from qb_observation.exchange_nonces where expires_at <= v_now;
  insert into qb_observation.exchange_nonces (nonce,expires_at)
    values (v_nonce, v_timestamp + interval '2 minutes') on conflict do nothing;
  if not found then return jsonb_build_object('status','replayed'); end if;

  if v_message->>'action' = 'claim' then
    begin
      return qb_observation.claim_push();
    exception when lock_not_available then
      return jsonb_build_object('status','busy');
    end;
  end if;

  begin
    v_report := (v_message->>'report')::jsonb;
    if jsonb_typeof(v_report) <> 'object' or
      coalesce(v_report->>'runId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or exists (
        select 1 from jsonb_array_elements(v_report->'decisions') d
        where d->>'reason' is null or d->>'reason' not in ('nflverse_projection',
          'sleeper_unavailable','sleeper_return_review','source_conflict','source_missing')
      ) then
      return jsonb_build_object('status','ignored');
    end if;
    select * into v_run from qb_observation.runs r
      where r.run_id = (v_report->>'runId')::uuid and r.request_id is null;
    if not found then return jsonb_build_object('status','ignored'); end if;
    if v_run.status <> 'pending' then
      return jsonb_build_object('status',case when v_run.observed_at is not null then 'already_stored' else 'ignored' end);
    end if;
    if v_now >= v_run.dispatched_at + interval '2 minutes' then
      return jsonb_build_object('status','ignored');
    end if;

    -- The existing harvester checks run identity and bounds all stored data.
    -- After kickoff its availability cache stays null, even if a report
    -- returned from an in-flight collection can still be journaled.
    perform qb_observation.harvest(v_run, v_report, v_run.dispatched_at, 200);
    return jsonb_build_object('status','stored');
  exception when data_exception then
    -- The subtransaction rolls back any partial journal updates. Do not echo
    -- raw signed data, secrets, or invalid report fields in an API error.
    return jsonb_build_object('status','ignored');
  end;
end
$$;
alter function public.qb_observer_exchange(text,text) owner to postgres;
revoke all on function public.qb_observer_exchange(text,text)
  from public, anon, authenticated, service_role, authenticator;
grant execute on function public.qb_observer_exchange(text,text) to anon;

-- First choose the existing offer, then suppress it. Excluding an unavailable
-- starter must never promote another catalog row into a weekly offer.
create function qb_observation.regular_menu_team_excluded(p_season integer,p_week integer,p_team_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select c.enabled and c.automation_enabled from qb_observation.regular_menu_config c),false)
    and exists (
      select 1
      from jsonb_array_elements(coalesce(qb_observation.latest_source_state(p_season)->'absences','[]')) absence
      where qb_observation.regular_team_id(absence->>'team') = p_team_id
        and not exists (
          select 1 from qb_observation.regular_menu_overrides o
          where o.season = p_season and o.week <= p_week and o.team_id = p_team_id
            and o.qb_id is not null and o.updated_at > qb_observation.parse_iso(absence->>'since')
            and (o.week = p_week or o.expected_athlete_id = absence->>'id')
        )
    )
$$;

create or replace function qb_observation.regular_menu_choices(p_season integer, p_week integer)
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
  ) q on not qb_observation.regular_menu_team_excluded(p_season,p_week,f.team_id)
$$;

-- The reference identity survives an exclusion. Availability must not change
-- a validated weekly override back into the mutable catalog's starter.
create or replace function qb_observation.regular_menu_override_baseline(
  p_season integer,p_week integer,p_catalog jsonb
) returns jsonb language sql stable set search_path = '' as $$
  select p_catalog || coalesce((
    select jsonb_object_agg(qb_observation.regular_team_abbr(t.espn_abbr),
      jsonb_strip_nulls(jsonb_build_object(
        'id',q.espn_athlete_id,'name',q.name,
        'publishedAt',p_catalog->qb_observation.regular_team_abbr(t.espn_abbr)->>'publishedAt'
      )))
    from qb_observation.regular_menu_overrides o
    join qb_observation.regular_menu_fixtures(p_season,p_week) f
      on f.team_id = o.team_id and f.game_id = o.game_id
    join public.teams t on t.id = f.team_id
    join public.qbs q on q.id = o.qb_id and q.espn_athlete_id = o.expected_athlete_id
      and qb_observation.regular_team_id(q.team) = f.team_id
      and q.espn_athlete_id ~ '^[0-9]{1,18}$' and q.name ~ '[^[:space:]]'
    where o.season = p_season and o.week = p_week and t.espn_abbr is not null
      and (select enabled from qb_observation.regular_menu_config)
  ),'{}'::jsonb)
$$;

create or replace function qb_observation.current_projection(p_entry qb_observation.entries) returns boolean
language sql stable set search_path = '' as $$
  select p_entry.decision->>'reason' in ('nflverse_projection','sleeper_unavailable','sleeper_return_review',
    'source_conflict','source_missing')
    and p_entry.dismissed_at is null and exists (
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

create or replace function public.dismiss_qb_observation_candidate(p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.users where id = (select auth.uid()) and is_admin is true) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  update qb_observation.entries set dismissed_at = clock_timestamp()
    where id = p_entry_id and dismissed_at is null and decision->>'reason' in ('nflverse_projection','sleeper_unavailable','sleeper_return_review',
      'source_conflict','source_missing');
end
$$;

create or replace function public.manage_regular_qb_menu(
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
    v_expected_current := coalesce(v_choice.athlete_id,
      qb_observation.regular_menu_override_baseline(p_season,p_week,
        qb_observation.baseline(p_season,p_week))->v_team->>'id');
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
  if not coalesce(v_context.can_change, false)
    or qb_observation.regular_menu_frozen(p_season, p_week, v_context.first_kickoff_at) then
    raise exception 'Menu QB gelé ou calendrier non vérifié' using errcode = '23514';
  end if;
  insert into qb_observation.regular_menu_overrides as saved
    (season, week, team_id, game_id, qb_id, expected_athlete_id, source_entry_id, note, actor_id, updated_at)
    values (p_season, p_week, v_choice.team_id, v_choice.game_id, v_qb.id, v_qb.espn_athlete_id,
      p_entry_id, v_note, v_actor, clock_timestamp())
  on conflict (season, week, team_id) do update
    set game_id = excluded.game_id, qb_id = excluded.qb_id, expected_athlete_id = excluded.expected_athlete_id,
      source_entry_id = excluded.source_entry_id, note = excluded.note,
      actor_id = excluded.actor_id, updated_at = excluded.updated_at;
  -- An explicit manual confirmation refreshes its timestamp even for the same QB.
  -- Existing candidate replays retain their earlier no-side-effect short circuit.
  if p_entry_id is not null then
    update qb_observation.entries set dismissed_at = clock_timestamp(),
      decision = decision || '{"reviewOutcome":"confirmed"}'::jsonb
    where id = p_entry_id;
  end if;
  return jsonb_build_object('season', p_season, 'week', p_week, 'team', v_team,
    'action', p_action, 'qbId', v_qb.id);
end
$$;

-- Match the calendar-before-config lock order used by the Admin RPC. This
-- statement trigger runs before PostgreSQL locks the singleton row.
create function qb_observation.lock_regular_menu_config_calendar() returns trigger
language plpgsql set search_path = '' as $$
begin
  lock table public.games in share mode;
  return null;
end
$$;

create trigger lock_regular_menu_config_calendar
  before update of enabled, automation_enabled on qb_observation.regular_menu_config
  for each statement execute function qb_observation.lock_regular_menu_config_calendar();

-- Deferred checks also cover callers holding an explicit transaction open
-- after a successful statement. A commit after kickoff rolls back the change.
-- The commit can run after the Admin RPC has returned to the caller's role.
-- Keep the calendar read inside the private schema without granting caller access.
create function qb_observation.check_regular_menu_freeze() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_season integer;
  v_week integer;
  v_cutoff timestamptz;
begin
  if tg_table_name = 'runs' then
    v_season := new.season;
    v_week := new.week;
    v_cutoff := new.first_kickoff_at;
  elsif tg_table_name = 'regular_menu_overrides' then
    v_season := case when tg_op = 'DELETE' then old.season else new.season end;
    v_week := case when tg_op = 'DELETE' then old.week else new.week end;
  else
    select s.current_season, s.current_week into v_season, v_week
    from public.settings s
    where s.id = 1 and s.phase = 'regular' and s.regular_finalized_at is null
    for share;
    if not found then return null; end if;
  end if;
  if qb_observation.regular_menu_frozen(v_season, v_week, v_cutoff) then
    raise exception 'Menu QB gelé au premier coup d’envoi' using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger regular_menu_source_state_freeze
  after update of source_state on qb_observation.runs
  deferrable initially deferred for each row
  when (new.source_state is not null and new.source_state is distinct from old.source_state)
  execute function qb_observation.check_regular_menu_freeze();

create constraint trigger regular_menu_override_freeze
  after insert or update or delete on qb_observation.regular_menu_overrides
  deferrable initially deferred for each row
  execute function qb_observation.check_regular_menu_freeze();

create constraint trigger regular_menu_flags_freeze
  after update of enabled, automation_enabled on qb_observation.regular_menu_config
  deferrable initially deferred for each row
  when (new.enabled is distinct from old.enabled or new.automation_enabled is distinct from old.automation_enabled)
  execute function qb_observation.check_regular_menu_freeze();

create or replace function public.read_qb_observation_log(p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if not exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_admin is true) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'runId', r.run_id, 'season', r.season, 'week', r.week, 'revision', r.revision,
        'openedAt', qb_observation.iso(r.opened_at), 'firstKickoffAt', qb_observation.iso(r.first_kickoff_at),
        'dispatchedAt', qb_observation.iso(r.dispatched_at), 'observedAt', qb_observation.iso(r.observed_at),
        'harvestedAt', qb_observation.iso(r.harvested_at), 'status', r.status, 'reason', r.reason,
        'errors', r.errors, 'counts', r.counts, 'httpRequests', r.http_requests, 'httpStatus', r.http_status,
        'sourceState', r.source_state
      ) order by r.dispatched_at desc, r.run_id)
      from (select * from qb_observation.runs order by dispatched_at desc, run_id limit v_limit) r
    ), '[]'),
    'entries', coalesce((
      select jsonb_agg(e.decision || jsonb_build_object(
        'entryId', e.id, 'dismissedAt', qb_observation.iso(e.dismissed_at),
        'currentSignal', coalesce(qb_observation.current_projection(e), false),
        'runId', e.run_id, 'season', e.season, 'week', e.week, 'revision', r.revision,
        'firstDetectedAt', qb_observation.iso(e.first_detected_at), 'lastDetectedAt', qb_observation.iso(e.last_detected_at),
        'proposalEligible', e.scoped_before_freeze and e.decision->>'status' = 'proposed' and not exists (
          select 1 from qb_observation.entries newer
          where newer.season = e.season and newer.week = e.week and newer.team = e.team and newer.event_id = e.event_id
            and newer.url <> e.url and newer.scoped_before_freeze
            and (newer.published_at > e.published_at or (newer.published_at = e.published_at and (
              newer.decision->>'espnAthleteId' is distinct from e.decision->>'espnAthleteId'
              or newer.decision->>'status' = 'ambiguous' or newer.url < e.url
            )))
        )
      ) order by e.first_detected_at desc, e.season desc, e.week desc, e.url)
      from (
        select * from qb_observation.entries order by first_detected_at desc, season desc, week desc, url limit v_limit
      ) e join qb_observation.runs r using (run_id)
    ), '[]')
  );
end
$$;

revoke all on all functions in schema qb_observation from public,anon,authenticated,service_role;
revoke all on function public.read_qb_observation_log(integer), public.dismiss_qb_observation_candidate(uuid),
  public.manage_regular_qb_menu(integer,integer,text,text,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_qb_observation_log(integer), public.dismiss_qb_observation_candidate(uuid),
  public.manage_regular_qb_menu(integer,integer,text,text,uuid,text,uuid) to authenticated;

commit;
