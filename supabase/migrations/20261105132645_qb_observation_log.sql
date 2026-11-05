-- Manual review. This migration installs the journal and its owner-only tick.
-- pg_net, pgcrypto, Vault secrets, and the cron schedule are provisioned separately.
begin;

create schema qb_observation authorization postgres;
revoke all on schema qb_observation from public, anon, authenticated, service_role;

create table qb_observation.runs (
  run_id uuid primary key default gen_random_uuid(),
  season integer not null,
  week integer not null,
  revision bigint not null,
  opened_at timestamptz not null,
  period integer not null,
  first_kickoff_at timestamptz not null,
  dispatched_at timestamptz not null,
  observed_at timestamptz,
  harvested_at timestamptz,
  status text not null check (status in ('pending','completed','skipped','failed','dispatch_failed','response_failed')),
  reason text,
  errors jsonb not null default '[]',
  counts jsonb,
  http_requests jsonb,
  http_status integer,
  request_id bigint,
  event_ids text[] not null,
  baseline jsonb not null,
  unique (season, week, opened_at, period)
);

create index qb_observation_runs_recent on qb_observation.runs (dispatched_at desc);
create index qb_observation_runs_pending on qb_observation.runs (dispatched_at) where status = 'pending';

create table qb_observation.entries (
  season integer not null,
  week integer not null,
  url text not null,
  run_id uuid not null references qb_observation.runs (run_id),
  decision jsonb not null,
  team text,
  event_id text,
  published_at timestamptz,
  first_detected_at timestamptz not null,
  last_detected_at timestamptz not null,
  scoped_before_freeze boolean not null,
  primary key (season, week, url)
);

create index qb_observation_entries_recent on qb_observation.entries (first_detected_at desc);
create index qb_observation_entries_seen on qb_observation.entries (season, week, last_detected_at desc);
create index qb_observation_entries_chronology on qb_observation.entries
  (season, week, team, event_id, published_at desc) where scoped_before_freeze;

create table qb_observation.origin_backoff (
  origin text primary key,
  retry_at timestamptz not null
);

alter table qb_observation.runs enable row level security;
alter table qb_observation.entries enable row level security;
alter table qb_observation.origin_backoff enable row level security;
revoke all on all tables in schema qb_observation from public, anon, authenticated, service_role;

create function qb_observation.iso(p_time timestamptz) returns text
language sql stable strict set search_path = '' as $$
  select to_char(p_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create function qb_observation.parse_iso(p_time text) returns timestamptz
language plpgsql stable strict set search_path = '' as $$
begin
  if p_time !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception 'Invalid observation timestamp' using errcode = '22023';
  end if;
  return p_time::timestamptz;
end
$$;

create function qb_observation.calendar(p_season integer, p_week integer)
returns table (first_kickoff_at timestamptz, event_ids text[], complete boolean, has_scores boolean)
language sql stable set search_path = '' as $$
  select min(g.game_date), array_agg(g.external_game_id order by g.external_game_id),
    count(*) between 1 and 16 and count(g.game_date) = count(*)
      and bool_and(isfinite(g.game_date) and g.external_game_id ~ '^[0-9]{1,18}$')
      and count(distinct g.external_game_id) = count(*),
    coalesce(bool_or(g.home_score is not null or g.away_score is not null), false)
  from public.games g
  where g.season = p_season and g.week = p_week and g.season_type = 'regular'
$$;

create function qb_observation.baseline(p_season integer, p_week integer) returns jsonb
language sql stable set search_path = '' as $$
  with team_keys as (
    select lower(btrim(t.name)) as name,
      regexp_replace(lower(btrim(t.name)), '^.*[[:space:]]', '') as nickname,
      regexp_replace(upper(btrim(t.espn_abbr)), '^WSH$', 'WAS') as abbr
    from public.teams t
  ), team_catalog as (
    select *, count(*) over (partition by abbr) as abbr_count from team_keys
  ), candidates as (
    select q.espn_athlete_id, btrim(q.name) as name, t.abbr, t.abbr_count,
      count(*) over (partition by q.id) as qb_matches,
      count(*) over (partition by t.abbr) as team_matches
    from public.qbs q
    join team_catalog t on lower(btrim(q.team)) in (t.name, t.nickname)
    where q.active is true and q.is_active_starter is true
  ), watermarks as (
    select e.team, max(e.published_at) as published_at
    from qb_observation.entries e
    where e.season = p_season and e.week = p_week and e.scoped_before_freeze
    group by e.team
  )
  select coalesce(jsonb_object_agg(c.abbr, jsonb_strip_nulls(jsonb_build_object(
    'id', c.espn_athlete_id, 'name', c.name, 'publishedAt', qb_observation.iso(w.published_at)
  ))), '{}')
  from candidates c left join watermarks w on w.team = c.abbr
  where c.qb_matches = 1 and c.team_matches = 1 and c.abbr_count = 1
    and c.abbr in ('ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU',
      'IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS')
    and c.espn_athlete_id ~ '^[0-9]{1,18}$' and c.name ~ '[^[:space:]]' and length(c.name) <= 120
$$;

create function qb_observation.sign(p_text text, p_secret text) returns text
language plpgsql strict set search_path = '' as $$
begin
  -- pg_net writes convert_to(body::text, 'UTF8') to its request queue.
  return encode(extensions.hmac(convert_to(p_text, 'UTF8'), convert_to(p_secret, 'UTF8'), 'sha256'), 'hex');
end
$$;

create function qb_observation.retry_at(p_value text, p_observed_at timestamptz) returns timestamptz
language plpgsql stable strict set search_path = '' as $$
begin
  if p_value ~ '^[0-9]{1,10}$' then
    return p_observed_at + make_interval(secs => p_value::double precision);
  end if;
  if p_value ~ '^[A-Za-z]{3}, [0-9]{2} [A-Za-z]{3} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$' then
    return p_value::timestamptz;
  end if;
  return null;
exception when data_exception then
  return null;
end
$$;

-- This function runs in a subtransaction. One malformed result rolls back every
-- entry and backoff from that response, so it cannot poison the next dispatch.
create function qb_observation.harvest(
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
  -- pg_net assigns created = now() in a transaction that can start before
  -- the HTTP call. Allow the 55s timeout plus the worker's clock tolerance.
  if v_observed_at < date_trunc('milliseconds', p_run.dispatched_at) - interval '30 seconds'
    or v_observed_at > least(p_worker_started_at + interval '85 seconds', clock_timestamp() + interval '30 seconds') then
    raise exception 'Observation timestamp outside request' using errcode = '22023';
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

  for v_decision in select value from jsonb_array_elements(p_body->'decisions') loop
    v_match := v_decision->'match';
    v_previous := v_decision->'previousQB';
    v_new := v_decision->'newQB';
    v_team := v_decision->>'team';
    v_url := regexp_replace(split_part(split_part(v_decision->>'url', '?', 1), '#', 1), '/$', '');
    if jsonb_typeof(v_decision) is distinct from 'object'
      or jsonb_typeof(v_decision->'url') is distinct from 'string'
      or coalesce(v_url, '') !~* '^https://[a-z0-9]+([.-][a-z0-9]+)+/news/[a-zA-Z0-9][a-zA-Z0-9_-]*$'
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
    if v_decision->>'status' = 'proposed' and (
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
      (season, week, url, run_id, decision, team, event_id, published_at,
       first_detected_at, last_detected_at, scoped_before_freeze)
    values (
      p_run.season, p_run.week, v_url, p_run.run_id,
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
      ),
      v_team, v_match->>'id', v_published_at, v_observed_at, v_observed_at, v_scoped
    )
    on conflict (season, week, url) do update
      set last_detected_at = greatest(saved.last_detected_at, excluded.last_detected_at);
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

  update qb_observation.runs set
    status = v_status, reason = left(p_body->>'reason', 200), observed_at = v_observed_at,
    first_kickoff_at = v_cutoff, harvested_at = clock_timestamp(), http_status = p_http_status,
    errors = v_errors, counts = nullif(p_body->'counts','null'), http_requests = nullif(p_body->'httpRequests','null')
  where run_id = p_run.run_id;
end
$$;

create function public.run_qb_observation_tick() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_pending qb_observation.runs;
  v_reply record;
  v_harvested integer := 0;
  v_now timestamptz;
  v_settings public.settings;
  v_opened_at timestamptz;
  v_calendar record;
  v_period integer;
  v_run_id uuid;
  v_baseline jsonb;
  v_url text;
  v_secret text;
  v_request_id bigint;
  v_payload jsonb;
  v_envelope jsonb;
  v_seen_urls jsonb;
  v_backoff jsonb;
  v_reason text;
begin
  if not pg_try_advisory_xact_lock(187057380, 129404723) then
    return jsonb_build_object('status', 'busy');
  end if;

  -- Always harvest first, including after kickoff and across phase changes.
  for v_pending in select * from qb_observation.runs where status = 'pending' order by dispatched_at loop
    v_reason := null;
    if to_regclass('net._http_response') is null then
      v_reason := 'pg_net_unavailable';
    else
      select r.status_code, r.content, r.timed_out, r.error_msg, r.created into v_reply
      from net._http_response r where r.id = v_pending.request_id
        and r.created >= v_pending.dispatched_at - interval '1 second'
      order by r.created desc limit 1;
      if not found then
        if v_pending.dispatched_at > clock_timestamp() - interval '10 minutes' then continue; end if;
        v_reason := 'response_missing';
      elsif v_reply.timed_out then
        v_reason := 'http_timeout';
      elsif v_reply.error_msg is not null or v_reply.status_code is null then
        v_reason := 'http_transport_error';
      elsif v_reply.status_code not between 200 and 299 then
        v_reason := 'http_status';
      elsif coalesce(octet_length(v_reply.content), 0) not between 2 and 131072 then
        v_reason := 'response_size';
      else
        begin
          if to_regclass('vault.decrypted_secrets') is null
            or to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then
            v_reason := 'verification_unavailable';
          else
            select decrypted_secret into strict v_secret from vault.decrypted_secrets where name = 'qb_observation_secret';
            v_envelope := v_reply.content::jsonb;
            if coalesce(v_secret, '') !~ '^[!-~]+$' or length(v_secret) not between 32 and 512 then
              v_reason := 'verification_unavailable';
            elsif jsonb_typeof(v_envelope) is distinct from 'object'
              or v_envelope - array['report','signature'] <> '{}'
              or jsonb_typeof(v_envelope->'report') is distinct from 'string'
              or jsonb_typeof(v_envelope->'signature') is distinct from 'string'
              or v_envelope->>'signature' !~ '^[0-9a-f]{64}$'
              or v_envelope->>'signature' is distinct from qb_observation.sign(v_envelope->>'report', v_secret) then
              v_reason := 'invalid_signature';
            else
              perform qb_observation.harvest(v_pending, (v_envelope->>'report')::jsonb, v_reply.created, v_reply.status_code);
            end if;
          end if;
        exception
          when no_data_found or too_many_rows then v_reason := 'verification_unavailable';
          when data_exception then v_reason := 'invalid_response';
        end;
      end if;
      update qb_observation.runs set http_status = v_reply.status_code
      where run_id = v_pending.run_id and status = 'pending';
    end if;
    if v_reason is not null then
      update qb_observation.runs set status = 'response_failed', reason = v_reason, harvested_at = clock_timestamp()
      where run_id = v_pending.run_id;
    end if;
    v_harvested := v_harvested + 1;
  end loop;

  select * into v_settings from public.settings where id = 1 for share;
  if v_settings.id is null or v_settings.phase <> 'regular' or v_settings.regular_finalized_at is not null
    or v_settings.regular_writes_paused or v_settings.current_season not between 2000 and 2100
    or v_settings.current_week not between 1 and 18 or v_settings.revision not between 0 and 9007199254740991 then
    return jsonb_build_object('status', 'inactive', 'harvested', v_harvested);
  end if;

  select w.started_at into v_opened_at from public.qb_selection_weeks w
    where w.season = v_settings.current_season and w.week = v_settings.current_week for share;
  select * into v_calendar from qb_observation.calendar(v_settings.current_season, v_settings.current_week);
  v_now := clock_timestamp();
  if v_opened_at is null or not isfinite(v_opened_at) or v_opened_at > v_now
    or not v_calendar.complete or v_calendar.has_scores or v_now >= v_calendar.first_kickoff_at then
    return jsonb_build_object('status', 'outside_window', 'harvested', v_harvested);
  end if;

  -- A prior ESPN result can tighten the freeze if the local schedule lags.
  select least(v_calendar.first_kickoff_at, min(r.first_kickoff_at)) into v_calendar.first_kickoff_at
  from qb_observation.runs r where r.season = v_settings.current_season and r.week = v_settings.current_week
    and r.opened_at = v_opened_at and r.observed_at is not null;
  if v_now >= v_calendar.first_kickoff_at then
    return jsonb_build_object('status', 'outside_window', 'harvested', v_harvested);
  end if;

  v_period := floor(extract(epoch from v_now - v_opened_at) / 7200)::integer;
  if exists (
    select 1 from qb_observation.runs r
    where r.season = v_settings.current_season and r.week = v_settings.current_week and r.opened_at = v_opened_at
      and (r.period = v_period or r.status = 'pending')
  ) then
    return jsonb_build_object('status', 'already_dispatched', 'harvested', v_harvested);
  end if;

  v_baseline := qb_observation.baseline(v_settings.current_season, v_settings.current_week);
  insert into qb_observation.runs
    (season, week, revision, opened_at, period, first_kickoff_at, dispatched_at, status, event_ids, baseline)
  values (
    v_settings.current_season, v_settings.current_week, v_settings.revision, v_opened_at, v_period,
    v_calendar.first_kickoff_at, v_now, 'pending', v_calendar.event_ids, v_baseline
  ) returning run_id into v_run_id;

  v_reason := null;
  if to_regclass('vault.decrypted_secrets') is null then
    v_reason := 'vault_unavailable';
  elsif to_regclass('net._http_response') is null then
    v_reason := 'pg_net_unavailable';
  elsif to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then
    v_reason := 'pgcrypto_unavailable';
  else
    begin
      select decrypted_secret into strict v_url from vault.decrypted_secrets where name = 'qb_observation_url';
      select decrypted_secret into strict v_secret from vault.decrypted_secrets where name = 'qb_observation_secret';
      if coalesce(v_url, '') !~ '^https://[A-Za-z0-9]+([.-][A-Za-z0-9]+)+/api/cron/qb-observation$'
        or coalesce(v_secret, '') !~ '^[!-~]+$' or length(v_secret) not between 32 and 512 then
        v_reason := 'invalid_configuration';
      else
        select coalesce(jsonb_agg(e.url order by e.last_detected_at desc, e.url), '[]') into v_seen_urls
        from (
          select url, last_detected_at from qb_observation.entries
          where season = v_settings.current_season and week = v_settings.current_week
          order by last_detected_at desc, url limit 200
        ) e;
        delete from qb_observation.origin_backoff where retry_at <= v_now;
        select coalesce(jsonb_object_agg(b.origin, qb_observation.iso(b.retry_at)), '{}') into v_backoff
        from (select origin, retry_at from qb_observation.origin_backoff order by retry_at desc limit 64) b;
        v_payload := jsonb_build_object(
          'runId', v_run_id, 'season', v_settings.current_season, 'week', v_settings.current_week,
          'revision', v_settings.revision, 'openedAt', qb_observation.iso(v_opened_at),
          'dispatchedAt', qb_observation.iso(v_now), 'firstKickoffAt', qb_observation.iso(v_calendar.first_kickoff_at),
          'eventIds', v_calendar.event_ids, 'baseline', v_baseline,
          'seenUrls', v_seen_urls, 'retryAfterByOrigin', v_backoff
        );
        if clock_timestamp() >= v_calendar.first_kickoff_at then
          update qb_observation.runs set
            status = 'skipped', reason = 'window_elapsed_before_dispatch', harvested_at = clock_timestamp()
          where run_id = v_run_id;
          return jsonb_build_object('status', 'outside_window', 'runId', v_run_id, 'harvested', v_harvested);
        end if;
        v_request_id := net.http_post(
          url := v_url, timeout_milliseconds := 55000, body := v_payload,
          headers := jsonb_build_object('Content-Type', 'application/json',
            'X-QB-Observation-Signature', qb_observation.sign(v_payload::text, v_secret))
        );
        if v_request_id is null then
          raise exception 'Missing queued request id';
        end if;
      end if;
    exception
      when no_data_found or too_many_rows then v_reason := 'missing_or_duplicate_configuration';
      when others then v_reason := 'enqueue_failed';
    end;
  end if;

  if v_reason is not null then
    update qb_observation.runs set status = 'dispatch_failed', reason = v_reason, harvested_at = clock_timestamp()
    where run_id = v_run_id;
    return jsonb_build_object('status', 'dispatch_failed', 'runId', v_run_id, 'harvested', v_harvested);
  end if;
  update qb_observation.runs set request_id = v_request_id where run_id = v_run_id;
  return jsonb_build_object('status', 'dispatched', 'runId', v_run_id, 'harvested', v_harvested);
end
$$;

create function public.read_qb_observation_log(p_limit integer default 20) returns jsonb
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
        'errors', r.errors, 'counts', r.counts, 'httpRequests', r.http_requests, 'httpStatus', r.http_status
      ) order by r.dispatched_at desc, r.run_id)
      from (select * from qb_observation.runs order by dispatched_at desc, run_id limit v_limit) r
    ), '[]'),
    'entries', coalesce((
      select jsonb_agg(e.decision || jsonb_build_object(
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

revoke all on all functions in schema qb_observation from public, anon, authenticated, service_role;
alter function public.run_qb_observation_tick() owner to postgres;
alter function public.read_qb_observation_log(integer) owner to postgres;
revoke all on function public.run_qb_observation_tick() from public, anon, authenticated, service_role;
revoke all on function public.read_qb_observation_log(integer) from public, anon, authenticated, service_role;
grant execute on function public.read_qb_observation_log(integer) to authenticated;

commit;
