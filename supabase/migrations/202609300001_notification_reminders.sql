-- MANUAL ONLY, after 202609290001. Extend the existing push queue, not a second
-- notification store. No notifications are sent by this migration.
begin;
alter table public.push_notification_events add column if not exists reminder_context jsonb;
alter table public.push_notification_events add column if not exists reminder_attempted_at timestamptz;
alter table public.push_notification_events add column if not exists reminder_cancelled_at timestamptz;
alter table public.push_notification_events alter column week drop not null;
alter table public.playoff_rounds add column if not exists reminder_opened_at timestamptz;
create index if not exists pool_reminders_due on public.push_notification_events(scheduled_for)
 where reminder_context is not null and reminder_attempted_at is null and reminder_cancelled_at is null and sent_at is null;

create or replace function public.queue_pool_reminder(p_event jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare kind text:=p_event->>'notification_type';
begin
 if kind not in('regular_five_hour','playoff_open','playoff_h24','playoff_morning') or kind is null or
   p_event->>'event_key' is null or p_event->>'user_id' is null or p_event->>'scheduled_for' is null or
   jsonb_typeof(p_event->'reminder_context') is distinct from 'object' then raise exception 'Invalid reminder'; end if;
 insert into public.push_notification_events(event_key,user_id,notification_type,week,scheduled_for,status,reminder_context)
 values(p_event->>'event_key',(p_event->>'user_id')::uuid,kind,(p_event->>'week')::integer,(p_event->>'scheduled_for')::timestamptz,'pending',p_event->'reminder_context')
 on conflict(event_key) do update set
   scheduled_for=case when kind in('playoff_h24','playoff_morning') then excluded.scheduled_for else public.push_notification_events.scheduled_for end,
   reminder_context=case when kind in('playoff_h24','playoff_morning') then excluded.reminder_context else public.push_notification_events.reminder_context end
 where public.push_notification_events.reminder_attempted_at is null and public.push_notification_events.reminder_cancelled_at is null and public.push_notification_events.sent_at is null;
end $$;
revoke all on function public.queue_pool_reminder(jsonb) from public,anon,authenticated;
grant execute on function public.queue_pool_reminder(jsonb) to service_role;

-- One effective draft -> open transition, committed with the round itself.
create or replace function public.playoff_open_reminders() returns trigger
language plpgsql security definer set search_path='' as $$
declare person record; kickoff timestamptz;
begin
 if new.status<>'open' or old.status<>'draft' then return new; end if;
 if tg_when='BEFORE' then new.reminder_opened_at:=clock_timestamp();return new; end if;
 select min(game_date) into kickoff from public.playoff_games where round_id=new.id and external_game_id ~ '^[0-9]+$';
 if kickoff is null or kickoff<=now() or exists(select 1 from public.playoff_games where round_id=new.id and (external_game_id is null or external_game_id !~ '^[0-9]+$')) then return new; end if;
 for person in select id from public.users loop
  perform public.queue_pool_reminder(jsonb_build_object('event_key','playoff_open-'||new.id||'-'||person.id,'user_id',person.id,'notification_type','playoff_open','scheduled_for',new.reminder_opened_at,'reminder_context',jsonb_build_object('scope','playoffs','round_id',new.id,'kickoff',kickoff)));
 end loop;
 return new;
end $$;
drop trigger if exists playoff_open_reminder_clock on public.playoff_rounds;
create trigger playoff_open_reminder_clock before update of status on public.playoff_rounds for each row execute function public.playoff_open_reminders();
drop trigger if exists playoff_open_reminder_queue on public.playoff_rounds;
create trigger playoff_open_reminder_queue after update of status on public.playoff_rounds for each row execute function public.playoff_open_reminders();

create or replace function public.claim_pool_reminder(p_event_key text)
returns boolean language plpgsql security definer set search_path='' as $$
declare e public.push_notification_events; r public.playoff_rounds; kickoff timestamptz; local_clock time;
begin
 select * into e from public.push_notification_events where event_key=p_event_key for update;
 if e.event_key is null or e.notification_type not in('regular_five_hour','playoff_open','playoff_h24','playoff_morning') or
   e.reminder_context is null or e.status<>'pending' or e.sent_at is not null or e.reminder_attempted_at is not null or e.reminder_cancelled_at is not null or e.scheduled_for>now() then return false; end if;
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
  if r.id is null or r.status<>'open' then return false; end if;
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
-- Existing queue's RLS and UI are unchanged; no new ordinary-user write grants.
commit;
