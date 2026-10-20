-- PREPARED FOR MANUAL REVIEW ONLY. Do not apply remotely without approval.
-- New selections freeze the catalog identity. Existing NULL snapshots are left
-- untouched: never infer a historical selection from today's mutable catalog.
begin;

alter table public.qb_picks
 add column selected_qb_name text,
 add column selected_espn_athlete_id text,
 add column selected_team text;
alter table public.qb_picks add constraint qb_picks_selected_identity_complete check (
 (selected_qb_name is null and selected_espn_athlete_id is null and selected_team is null)
 or (selected_qb_name is not null and selected_qb_name ~ '[^[:space:]]'
  and selected_espn_athlete_id is not null and selected_espn_athlete_id ~ '[^[:space:]]'
  and selected_team is not null and selected_team ~ '[^[:space:]]')
);

-- SECURITY DEFINER permits the row lock without giving members UPDATE rights
-- on qbs. FOR SHARE freezes all identity fields until this selection commits.
create function public.capture_regular_qb_selection_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
declare selected public.qbs;
begin
 select * into selected from public.qbs where id=new.qb_id for share;
 if selected.id is null or coalesce(selected.name,'') !~ '[^[:space:]]' or
   coalesce(selected.espn_athlete_id,'') !~ '[^[:space:]]' or coalesce(selected.team,'') !~ '[^[:space:]]' then
  raise exception 'Selected QB identity unavailable' using errcode='23514';
 end if;
 -- Always replace client values, including nonempty spoofed values.
 new.selected_qb_name:=selected.name;
 new.selected_espn_athlete_id:=selected.espn_athlete_id;
 new.selected_team:=selected.team;
 return new;
end $$;
create trigger regular_qb_selection_snapshot_insert before insert on public.qb_picks
 for each row execute function public.capture_regular_qb_selection_snapshot();

-- Exceptional corrections are a privileged operation, not a new selection.
-- A receipt authorizes one exact change in the same transaction; no caller-set
-- session flag can bypass the normal snapshot guard.
create table public.regular_qb_snapshot_corrections (
 id uuid primary key default gen_random_uuid(),
 pick_id uuid not null references public.qb_picks(id),
 actor_id uuid not null references public.users(id),
 reason text not null check (reason ~ '[^[:space:]]'),
 before_pick jsonb not null check (jsonb_typeof(before_pick)='object'),
 after_snapshot jsonb not null check (
  jsonb_typeof(after_snapshot)='object'
  and after_snapshot ?& array['selected_qb_name','selected_espn_athlete_id','selected_team']
  and after_snapshot-array['selected_qb_name','selected_espn_athlete_id','selected_team']='{}'::jsonb
  and jsonb_typeof(after_snapshot->'selected_qb_name')='string'
  and jsonb_typeof(after_snapshot->'selected_espn_athlete_id')='string'
  and jsonb_typeof(after_snapshot->'selected_team')='string'
  and after_snapshot->>'selected_qb_name' ~ '[^[:space:]]'
  and after_snapshot->>'selected_espn_athlete_id' ~ '[^[:space:]]'
  and after_snapshot->>'selected_team' ~ '[^[:space:]]'
 ),
 transaction_id bigint not null,
 requested_at timestamptz not null default clock_timestamp(),
 applied_at timestamptz,
 unique(pick_id,transaction_id)
);
alter table public.regular_qb_snapshot_corrections owner to postgres;
alter table public.regular_qb_snapshot_corrections enable row level security;
revoke all on table public.regular_qb_snapshot_corrections from public,anon,authenticated,service_role;
grant select on table public.regular_qb_snapshot_corrections to service_role;

-- Invoker identity is deliberate: an admin profile or client JWT claim is not
-- postgres/service_role. A one-time legacy completion requires separately
-- reviewed historical evidence and explicit values; UPDATE never reads qbs.
-- Existing lifecycle/pause guards still govern even a privileged completion.
create function public.guard_regular_qb_selection_snapshot() returns trigger
language plpgsql security invoker set search_path='' as $$
declare correction_id uuid;
begin
 if new.qb_id is distinct from old.qb_id or new.season is distinct from old.season or
   new.week is distinct from old.week or new.user_id is distinct from old.user_id then
  raise exception 'QB selection identity is immutable' using errcode='23514';
 end if;
 if new.selected_qb_name is not distinct from old.selected_qb_name and
   new.selected_espn_athlete_id is not distinct from old.selected_espn_athlete_id and
   new.selected_team is not distinct from old.selected_team then return new; end if;
 if old.selected_qb_name is null and old.selected_espn_athlete_id is null and old.selected_team is null
   and current_user in ('postgres','service_role') and
   coalesce(new.selected_qb_name,'') ~ '[^[:space:]]' and
   coalesce(new.selected_espn_athlete_id,'') ~ '[^[:space:]]' and
   coalesce(new.selected_team,'') ~ '[^[:space:]]' then return new; end if;
 if current_user='postgres' then
  update public.regular_qb_snapshot_corrections r set applied_at=clock_timestamp()
  where r.pick_id=old.id and r.transaction_id=txid_current() and r.applied_at is null
   and r.before_pick=to_jsonb(old)
   and to_jsonb(new)=r.before_pick||r.after_snapshot
  returning r.id into correction_id;
  if correction_id is not null then return new; end if;
 end if;
 raise exception 'QB selection snapshot is immutable; reviewed legacy completion requires postgres/service_role' using errcode='42501';
end $$;
create trigger regular_qb_selection_snapshot_update before update on public.qb_picks
 for each row execute function public.guard_regular_qb_selection_snapshot();
revoke all on function public.capture_regular_qb_selection_snapshot(),public.guard_regular_qb_selection_snapshot()
 from public,anon,authenticated,service_role;

-- Server/owner-only exceptional correction. The full pick is a compare-and-swap
-- token, including immutable context, creation time and all three old fields.
-- The caller must first read to_jsonb(qb_picks); the RPC never infers identity
-- from the current catalog or rewrites official results/scores.
create function public.correct_regular_qb_selection_snapshot(
 p_pick_id uuid,p_actor uuid,p_expected jsonb,p_snapshot jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 s public.settings;
 chosen public.qb_picks;
 prior public.regular_qb_snapshot_corrections;
 correction_id uuid;
 persisted jsonb;
 expected_after jsonb;
begin
 if p_pick_id is null or p_actor is null or coalesce(p_reason,'') !~ '[^[:space:]]' then
  raise exception 'Pick, administrator and explicit correction reason required' using errcode='23514';
 end if;
 if jsonb_typeof(p_expected) is distinct from 'object' or
   jsonb_typeof(p_snapshot) is distinct from 'object' then
  raise exception 'Full expected pick and explicit snapshot objects required' using errcode='23514';
 end if;
 if not(p_snapshot ?& array['selected_qb_name','selected_espn_athlete_id','selected_team']) or
   p_snapshot-array['selected_qb_name','selected_espn_athlete_id','selected_team']<>'{}'::jsonb or
   jsonb_typeof(p_snapshot->'selected_qb_name') is distinct from 'string' or
   jsonb_typeof(p_snapshot->'selected_espn_athlete_id') is distinct from 'string' or
   jsonb_typeof(p_snapshot->'selected_team') is distinct from 'string' or
   coalesce(p_snapshot->>'selected_qb_name','') !~ '[^[:space:]]' or
   coalesce(p_snapshot->>'selected_espn_athlete_id','') !~ '[^[:space:]]' or
   coalesce(p_snapshot->>'selected_team','') !~ '[^[:space:]]' then
  raise exception 'Exactly three complete nonblank snapshot strings required' using errcode='23514';
 end if;
 -- Use the same sources-before-settings lock order as lifecycle/publication.
 lock table public.qb_picks in share row exclusive mode;
 select * into s from public.settings where id=1 for share;
 if s.id is null or s.regular_writes_paused or s.phase<>'regular' or s.regular_finalized_at is not null then
  raise exception 'Snapshot correction requires active regular season outside maintenance';
 end if;
 perform 1 from public.users where id=p_actor and is_admin=true for share;
 if not found then raise exception 'Administrator required' using errcode='42501'; end if;
 select * into chosen from public.qb_picks where id=p_pick_id for update;
 if chosen.id is null or chosen.season is distinct from s.current_season then
  raise exception 'Active-season QB selection required';
 end if;
 if not exists(select 1 from public.season_participants
   where season=chosen.season and user_id=chosen.user_id and confirmed) then
  raise exception 'Confirmed season participant required';
 end if;
 if chosen.selected_qb_name is null or chosen.selected_espn_athlete_id is null or chosen.selected_team is null then
  raise exception 'Complete the reviewed legacy snapshot before requesting an exceptional correction';
 end if;
 expected_after:=p_expected||p_snapshot;
 select * into prior from public.regular_qb_snapshot_corrections
 where pick_id=p_pick_id and actor_id=p_actor and reason=p_reason
  and before_pick=p_expected and after_snapshot=p_snapshot and applied_at is not null
 order by requested_at desc,id desc limit 1;
 if prior.id is not null then
  if to_jsonb(chosen) is distinct from expected_after then
   raise exception 'Previously applied correction no longer matches the current pick';
  end if;
  return jsonb_build_object('already_corrected',true,'correction_id',prior.id,'pick_id',p_pick_id,'pick',to_jsonb(chosen));
 end if;
 if to_jsonb(chosen) is distinct from p_expected then
  raise exception 'Stale complete QB selection snapshot' using errcode='40001';
 end if;
 if expected_after=p_expected then raise exception 'Correction must change the selected snapshot'; end if;
 insert into public.regular_qb_snapshot_corrections(pick_id,actor_id,reason,before_pick,after_snapshot,transaction_id)
 values(p_pick_id,p_actor,p_reason,p_expected,p_snapshot,txid_current()) returning id into correction_id;
 update public.qb_picks set selected_qb_name=p_snapshot->>'selected_qb_name',
  selected_espn_athlete_id=p_snapshot->>'selected_espn_athlete_id',selected_team=p_snapshot->>'selected_team'
 where id=p_pick_id;
 select to_jsonb(q) into persisted from public.qb_picks q where q.id=p_pick_id;
 if persisted is distinct from expected_after or not exists(
   select 1 from public.regular_qb_snapshot_corrections where id=correction_id
    and transaction_id=txid_current() and applied_at is not null) then
  raise exception 'Exceptional snapshot correction did not persist exactly';
 end if;
 -- qb_picks is part of regular_publication_state. Any prior publication is now
 -- stale naturally; do not recalculate or delete ratings, scores or attestations.
 return jsonb_build_object('already_corrected',false,'correction_id',correction_id,'pick_id',p_pick_id,'pick',persisted);
end $$;
alter function public.correct_regular_qb_selection_snapshot(uuid,uuid,jsonb,jsonb,text) owner to postgres;
revoke all on function public.correct_regular_qb_selection_snapshot(uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.correct_regular_qb_selection_snapshot(uuid,uuid,jsonb,jsonb,text) to service_role;

-- Preserve final publication controls/scoring; validate selection/replacement
-- against the identity frozen for this season, week and QB selection.
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
 pts as(select p.user_id,g.week,sum(case when p.picked_team=case when f.home_score>f.away_score then g.home_team when f.away_score>f.home_score then g.away_team else null end then case when p.predicted_spread=abs(f.home_score-f.away_score) then 2 else 1 end else 0 end)::int base_points
 from public.picks p join public.games g on g.id=p.game_id join final_games f on f.id=g.id group by p.user_id,g.week),
 scores as(select p.*,case when (r->>'passer_rating')::numeric>0 then (r->>'passer_rating')::numeric/100 else 1 end m
 from pts p join public.qb_picks qp on qp.user_id=p.user_id and qp.week=p.week and qp.season=p_season join jsonb_array_elements(p_proof->'ratings') r on (r->>'qb_id')::uuid=qp.qb_id and (r->>'week')::int=p.week)
 select jsonb_agg(jsonb_build_object('user_id',user_id,'week',week,'base_points',base_points,'multiplier',round(m,3),'final_score',round(base_points*m,3)) order by week,user_id) into calculated from scores;
 if calculated is null or calculated is distinct from p_proof->'results' then raise exception 'Final recalculation mismatch'; end if;
 if exists(select 1 from public.weekly_scores w where w.season=p_season and not exists(select 1 from jsonb_array_elements(calculated) r where (r->>'user_id')::uuid=w.user_id and (r->>'week')::int=w.week)) then raise exception 'Unattributed historical weekly scores: no destructive cleanup'; end if;
 update public.games g set home_score=x.home_score,away_score=x.away_score from jsonb_to_recordset(p_proof->'games') as x(id uuid,home_score int,away_score int) where g.id=x.id;
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

commit;
