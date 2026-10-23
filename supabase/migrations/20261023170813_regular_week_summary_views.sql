-- Additive only. Review and apply manually; this migration changes no existing rows.
begin;

create table public.regular_week_summary_views (
 user_id uuid not null references public.users(id),
 season integer not null references public.seasons(season),
 week integer not null check (week between 1 and 18),
 seen_at timestamptz not null default clock_timestamp(),
 primary key (user_id,season,week)
);

alter table public.regular_week_summary_views enable row level security;
revoke all on public.regular_week_summary_views from public,anon,authenticated,service_role;
grant select,insert on public.regular_week_summary_views to authenticated,service_role;

create policy regular_week_summary_views_own_read
 on public.regular_week_summary_views for select to authenticated
 using (user_id=(select auth.uid()));

create policy regular_week_summary_views_own_insert
 on public.regular_week_summary_views for insert to authenticated
 with check (
  user_id=(select auth.uid())
  and exists (
   select 1 from public.settings s
   where s.id=1 and s.current_season=regular_week_summary_views.season
    and s.phase='regular' and s.regular_finalized_at is null
    and not s.regular_writes_paused
    and regular_week_summary_views.week=s.current_week-1
  )
  and exists (
   select 1 from public.season_participants p
   where p.season=regular_week_summary_views.season
    and p.user_id=(select auth.uid()) and p.confirmed
  )
 );

commit;
