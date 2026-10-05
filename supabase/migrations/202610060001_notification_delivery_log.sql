-- Additive transport telemetry only. No queue, trigger, cron or existing data changes.
-- Review locally; do not install remotely during this task.
begin;
create table public.push_notification_deliveries (
 id uuid primary key default gen_random_uuid(),
 event_key text,
 user_id uuid not null,
 scope text not null check (scope in ('regular','playoffs')),
 notification_type text not null,
 title text not null,
 body text not null,
 created_at timestamptz not null default clock_timestamp(),
 attempted_at timestamptz,
 completed_at timestamptz,
 accepted_at timestamptz,
 attempted_count integer check (attempted_count >= 0),
 accepted_count integer check (accepted_count >= 0),
 failed_count integer check (failed_count >= 0),
 failure_reason text,
 check ((attempted_count is null and accepted_count is null and failed_count is null)
   or (attempted_count is not null and accepted_count is not null and failed_count is not null
       and attempted_count = accepted_count + failed_count))
);
-- No FK: historical evidence survives the existing queue's intentional deletions.
alter table public.push_notification_deliveries enable row level security;
revoke all on public.push_notification_deliveries from public,anon,authenticated,service_role;
grant select,insert,update on public.push_notification_deliveries to service_role;
create index push_notification_deliveries_recent on public.push_notification_deliveries(scope,created_at desc);
create index push_notification_deliveries_event on public.push_notification_deliveries(event_key);
commit;
