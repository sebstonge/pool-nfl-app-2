-- MANUAL REVIEW / SQL Editor ONLY. Never run db push for this migration.
-- Requires the previously installed notification_reminders migration.
begin;

-- Fail rather than invent a season, repair rows, or silently select one of many.
do $$ begin
 if (select count(*) from public.settings) <> 1 or not exists
   (select 1 from public.settings where id=1 and current_season between 2000 and 9999 and current_week>=1)
 then raise exception 'Expected exactly settings(id=1) with a valid existing season/week'; end if;
end $$;
alter table public.settings add column if not exists phase text not null default 'regular';
alter table public.settings add column if not exists regular_finalized_at timestamptz;
alter table public.settings add column if not exists revision bigint not null default 0;
alter table public.settings add column if not exists playoff_reminders_enabled boolean not null default false;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.settings'::regclass and conname='settings_lifecycle_valid') then
  alter table public.settings add constraint settings_lifecycle_valid check
   (id=1 and phase in ('regular','playoffs','offseason') and revision>=0 and current_season between 2000 and 9999 and current_week>=1);
 end if;
end $$;

-- Invoker identity, NOT JWT metadata or a client-set custom GUC. An ordinary
-- admin profile is not a database service role. Other profile fields stay intact.
create or replace function public.guard_user_admin_flag() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','service_role') then
  if (tg_op='INSERT' and new.is_admin is true) or
     (tg_op='UPDATE' and new.is_admin is distinct from old.is_admin) then
   raise exception 'Only trusted server operations may manage is_admin' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists lifecycle_user_admin_flag on public.users;
create trigger lifecycle_user_admin_flag before insert or update on public.users
 for each row execute function public.guard_user_admin_flag();

-- No public or service-role lifecycle setter in this foundation. A future
-- SECURITY DEFINER transaction must prove closure before changing these fields.
-- PostgreSQL owner remains the trusted manual/migration authority.
create or replace function public.guard_lifecycle_settings() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Lifecycle settings cannot be removed'; end if;
 if tg_op='INSERT' then raise exception 'Lifecycle singleton already provisioned'; end if;
 if new.id is distinct from old.id then raise exception 'Lifecycle identity is immutable'; end if;
 if current_user<>'postgres' and
   (new.current_season is distinct from old.current_season or new.phase is distinct from old.phase or
    new.regular_finalized_at is distinct from old.regular_finalized_at or
    new.playoff_reminders_enabled is distinct from old.playoff_reminders_enabled or new.revision is distinct from old.revision)
 then raise exception 'Lifecycle fields require the trusted transition transaction' using errcode='42501'; end if;
 if new.current_week is distinct from old.current_week and
   (old.phase<>'regular' or old.regular_finalized_at is not null)
 then raise exception 'Regular season is closed' using errcode='42501'; end if;
 new.revision:=old.revision+1;
 return new;
end $$;
drop trigger if exists lifecycle_settings on public.settings;
create trigger lifecycle_settings before insert or update or delete on public.settings
 for each row execute function public.guard_lifecycle_settings();
drop trigger if exists lifecycle_settings_truncate on public.settings;
create trigger lifecycle_settings_truncate before truncate on public.settings
 for each statement execute function public.guard_lifecycle_settings();

-- Held until transaction end: a future settings FOR UPDATE closure waits for
-- in-flight writes. Conversely, old tabs wait and then observe the closed state.
create or replace function public.guard_regular_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.settings;
begin
 select * into s from public.settings where id=1 for share;
 if s.id is null or s.phase<>'regular' or s.regular_finalized_at is not null then
  raise exception 'Regular season is closed' using errcode='42501';
 end if;
 return null; -- statement trigger, not a row suppression
end $$;
do $$ declare t text; begin
 foreach t in array array['games','picks','qb_picks','qb_ratings','qb_weekly_stats','weekly_scores','qb_selection_weeks'] loop
  execute format('drop trigger if exists lifecycle_regular_write on public.%I',t);
  execute format('create trigger lifecycle_regular_write before insert or update or delete or truncate on public.%I for each statement execute function public.guard_regular_write()',t);
  -- RLS does not protect TRUNCATE. It is never part of the browser workflows.
  execute format('revoke truncate,trigger on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
revoke truncate,trigger on public.users,public.settings from public,anon,authenticated;

-- Preparation primitive ONLY: locks/checks a revision and returns the current
-- context. It neither validates sporting completion nor finalizes anything.
-- Future orchestration must call inside its own SQL transaction, validate real
-- completion evidence there, and commit all lifecycle changes together.
create or replace function public.lock_regular_lifecycle(p_season integer,p_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.settings;
begin
 select * into s from public.settings where id=1 for update;
 if s.id is null or s.current_season is distinct from p_season or s.revision is distinct from p_revision or
    s.phase<>'regular' or s.regular_finalized_at is not null then
  raise exception 'Stale or closed lifecycle context';
 end if;
 return to_jsonb(s);
end $$;
revoke all on function public.lock_regular_lifecycle(integer,bigint) from public,anon,authenticated;
grant execute on function public.lock_regular_lifecycle(integer,bigint) to service_role;

-- Disabled queueing is a no-op: opening a round must not fail merely because
-- reminders are off. Also covers direct inserts and existing queue upserts.
create or replace function public.guard_lifecycle_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.settings; kind text:=new.notification_type;
begin
 if tg_op='UPDATE' and new.notification_type is distinct from old.notification_type then raise exception 'Notification type is immutable'; end if;
 select * into s from public.settings where id=1 for share;
 if s.id is null then raise exception 'Lifecycle context missing'; end if;
 if kind in ('playoff_open','playoff_h24','playoff_morning') then
  if not s.playoff_reminders_enabled or s.phase<>'playoffs' then return null; end if;
 elsif kind in ('qb_turn','qb_final','rankings_updated','regular_five_hour') then
  if s.phase<>'regular' or s.regular_finalized_at is not null then return null; end if;
 end if;
 return new;
end $$;
drop trigger if exists lifecycle_notification on public.push_notification_events;
create trigger lifecycle_notification before insert or update on public.push_notification_events
 for each row execute function public.guard_lifecycle_notification();

revoke all on function public.guard_user_admin_flag(),public.guard_lifecycle_settings(),public.guard_regular_write(),public.guard_lifecycle_notification() from public,anon,authenticated,service_role;

-- Shared gate for queue, opening trigger and claim (including historical events).
create or replace function public.lifecycle_notification_allowed(p_kind text)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.settings;
begin
 select * into s from public.settings where id=1 for share;
 if s.id is null then raise exception 'Lifecycle context missing'; end if;
 if p_kind in ('playoff_open','playoff_h24','playoff_morning') then
  return s.playoff_reminders_enabled and s.phase='playoffs';
 elsif p_kind in ('qb_turn','qb_final','rankings_updated','regular_five_hour') then
  return s.phase='regular' and s.regular_finalized_at is null;
 end if;
 return true;
end $$;
revoke all on function public.lifecycle_notification_allowed(text) from public,anon,authenticated;
grant execute on function public.lifecycle_notification_allowed(text) to service_role;

create or replace function public.queue_pool_reminder(p_event jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare kind text:=p_event->>'notification_type';
begin
 if kind not in('regular_five_hour','playoff_open','playoff_h24','playoff_morning') or kind is null or
   p_event->>'event_key' is null or p_event->>'user_id' is null or p_event->>'scheduled_for' is null or
   jsonb_typeof(p_event->'reminder_context') is distinct from 'object' then raise exception 'Invalid reminder'; end if;
 if not public.lifecycle_notification_allowed(kind) then return; end if;
 insert into public.push_notification_events(event_key,user_id,notification_type,week,scheduled_for,status,reminder_context)
 values(p_event->>'event_key',(p_event->>'user_id')::uuid,kind,(p_event->>'week')::integer,(p_event->>'scheduled_for')::timestamptz,'pending',p_event->'reminder_context')
 on conflict(event_key) do update set
   scheduled_for=case when kind in('playoff_h24','playoff_morning') then excluded.scheduled_for else public.push_notification_events.scheduled_for end,
   reminder_context=case when kind in('playoff_h24','playoff_morning') then excluded.reminder_context else public.push_notification_events.reminder_context end
 where public.push_notification_events.reminder_attempted_at is null and public.push_notification_events.reminder_cancelled_at is null and public.push_notification_events.sent_at is null;
end $$;
revoke all on function public.queue_pool_reminder(jsonb) from public,anon,authenticated;
grant execute on function public.queue_pool_reminder(jsonb) to service_role;


create or replace function public.playoff_open_reminders() returns trigger
language plpgsql security definer set search_path='' as $$
declare person record; kickoff timestamptz;
begin
 if new.status<>'open' or old.status<>'draft' then return new; end if;
 if not public.lifecycle_notification_allowed('playoff_open') then return new; end if;
 if tg_when='BEFORE' then new.reminder_opened_at:=clock_timestamp();return new; end if;
 select min(game_date) into kickoff from public.playoff_games where round_id=new.id and external_game_id ~ '^[0-9]+$';
 if kickoff is null or kickoff<=now() or exists(select 1 from public.playoff_games where round_id=new.id and (external_game_id is null or external_game_id !~ '^[0-9]+$')) then return new; end if;
 for person in select id from public.users loop
  perform public.queue_pool_reminder(jsonb_build_object('event_key','playoff_open-'||new.id||'-'||person.id,'user_id',person.id,'notification_type','playoff_open','scheduled_for',new.reminder_opened_at,'reminder_context',jsonb_build_object('scope','playoffs','round_id',new.id,'kickoff',kickoff)));
 end loop;
 return new;
end $$;

create or replace function public.claim_pool_reminder(p_event_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare e public.push_notification_events; r public.playoff_rounds; kickoff timestamptz; local_clock time;
begin
 select * into e from public.push_notification_events where event_key=p_event_key for update;
 if e.event_key is null or e.notification_type not in('regular_five_hour','playoff_open','playoff_h24','playoff_morning') or
   e.reminder_context is null or e.status<>'pending' or e.sent_at is not null or e.reminder_attempted_at is not null or e.reminder_cancelled_at is not null or e.scheduled_for>now() then return false; end if;
 if not public.lifecycle_notification_allowed(e.notification_type) then return false; end if;
 if not exists(select 1 from public.users where id=e.user_id) then return false; end if;
 if e.notification_type='regular_five_hour' then
  if not exists(select 1 from public.settings where current_week=e.week) or
    not exists(select 1 from public.qb_selection_weeks where week=e.week and started_at=(e.reminder_context->>'cycle')::timestamptz) or
    exists(select 1 from public.qb_picks where week=e.week and user_id=e.user_id) or
    exists(select 1 from public.games where week=e.week and is_pool_eligible=true and game_date<=now()) then return false; end if;
  local_clock:=(now() at time zone 'America/Toronto')::time;
  if local_clock>='22:00'::time or local_clock<'08:30'::time then return false; end if;
 else
  select * into r from public.playoff_rounds where id=(e.reminder_context->>'round_id')::bigint for share;
  if r.id is null or r.season<>(select current_season from public.settings where id=1) or r.status<>'open' then return false; end if;
  select min(game_date) into kickoff from public.playoff_games where round_id=r.id and external_game_id ~ '^[0-9]+$';
  if kickoff is null or kickoff<=now() or exists(select 1 from public.playoff_games where round_id=r.id and game_status in('in','post')) then return false; end if;
  if e.notification_type='playoff_h24' and (kickoff-interval '24 hours'>now() or kickoff-interval '24 hours'<r.reminder_opened_at) then return false; end if;
  if e.notification_type='playoff_morning' and (((kickoff at time zone 'America/Toronto')::date+time '08:30') at time zone 'America/Toronto'>now() or
    ((kickoff at time zone 'America/Toronto')::date+time '08:30') at time zone 'America/Toronto'<r.reminder_opened_at) then return false; end if;
  if e.notification_type<>'playoff_open' and
    exists(select 1 from public.playoff_qb_picks where round_id=r.id and user_id=e.user_id and (r.round_key<>'super_bowl' or super_bowl_total is not null)) and
    exists(select 1 from public.playoff_team_paths where round_id=r.id and user_id=e.user_id) and
    not exists(select 1 from public.playoff_games g where round_id=r.id and not exists(select 1 from public.playoff_picks p where p.game_id=g.id and p.user_id=e.user_id)) then return false; end if;
 end if;
 update public.push_notification_events set reminder_attempted_at=clock_timestamp() where event_key=e.event_key;
 return true;
end $$;
revoke all on function public.claim_pool_reminder(text) from public,anon,authenticated;
grant execute on function public.claim_pool_reminder(text) to service_role;

commit;
