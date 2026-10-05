-- Local schema fixture from the two supplied exports. No production rows.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
create table public.users(id uuid not null, email text, display_name text, is_admin boolean default false, created_at timestamp with time zone default now(), real_name text, must_change_password boolean not null default false);
CREATE UNIQUE INDEX users_display_name_unique ON public.users USING btree (display_name);
CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);
CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id);
alter table public.users enable row level security;
grant all on public.users to anon,authenticated,service_role;
create policy "Users can insert own profile" on public.users for INSERT to authenticated with check ((auth.uid() = id));
create policy "Users can read users" on public.users for SELECT to authenticated using (true);
create policy "Users can update own profile" on public.users for UPDATE to authenticated using ((auth.uid() = id)) with check ((auth.uid() = id));
create table public.games(id uuid not null default gen_random_uuid(), external_game_id text not null, week integer not null, season integer not null default 2026, home_team text not null, away_team text not null, home_score integer, away_score integer, game_date timestamp with time zone, is_pool_eligible boolean default false, created_at timestamp with time zone default now(), season_type text not null default 'regular'::text);
CREATE UNIQUE INDEX games_external_game_id_key ON public.games USING btree (external_game_id);
CREATE UNIQUE INDEX games_pkey ON public.games USING btree (id);
alter table public.games enable row level security;
grant all on public.games to anon,authenticated,service_role;
create policy "Users can read games" on public.games for SELECT to authenticated using (true);
create policy "admin manage games" on public.games for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true)))));
create policy "admin update games" on public.games for UPDATE to authenticated using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true)))));
create table public.picks(id uuid not null default gen_random_uuid(), user_id uuid not null, game_id uuid not null, picked_team text not null, predicted_spread integer not null, created_at timestamp with time zone default now(), updated_at timestamp with time zone default now());
CREATE UNIQUE INDEX picks_pkey ON public.picks USING btree (id);
CREATE UNIQUE INDEX picks_user_id_game_id_key ON public.picks USING btree (user_id, game_id);
alter table public.picks enable row level security;
grant all on public.picks to anon,authenticated,service_role;
create policy "Users can delete own picks" on public.picks for DELETE to authenticated using ((auth.uid() = user_id));
create policy "Users can insert own picks" on public.picks for INSERT to authenticated with check ((auth.uid() = user_id));
create policy "Users can read all picks" on public.picks for SELECT to authenticated using (true);
create policy "Users can update own picks" on public.picks for UPDATE to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create table public.qb_picks(id uuid not null default gen_random_uuid(), user_id uuid not null, qb_id uuid not null, week integer not null, created_at timestamp with time zone default now());
CREATE UNIQUE INDEX qb_picks_pkey ON public.qb_picks USING btree (id);
CREATE UNIQUE INDEX qb_picks_qb_id_week_key ON public.qb_picks USING btree (qb_id, week);
CREATE UNIQUE INDEX qb_picks_user_id_week_key ON public.qb_picks USING btree (user_id, week);
alter table public.qb_picks enable row level security;
grant all on public.qb_picks to anon,authenticated,service_role;
create policy "Users can delete own qb pick" on public.qb_picks for DELETE to authenticated using ((auth.uid() = user_id));
create policy "Users can insert own qb pick" on public.qb_picks for INSERT to authenticated with check ((auth.uid() = user_id));
create policy "Users can read all qb picks" on public.qb_picks for SELECT to authenticated using (true);
create policy "Users can update own qb pick" on public.qb_picks for UPDATE to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create table public.qb_ratings(id uuid not null default gen_random_uuid(), qb_id uuid not null, week integer not null, passer_rating numeric, actual_qb_name text, actual_espn_athlete_id text, created_at timestamp with time zone default now());
CREATE UNIQUE INDEX qb_ratings_pkey ON public.qb_ratings USING btree (id);
CREATE UNIQUE INDEX qb_ratings_qb_id_week_key ON public.qb_ratings USING btree (qb_id, week);
alter table public.qb_ratings enable row level security;
grant all on public.qb_ratings to anon,authenticated,service_role;
create policy "Authenticated users can insert qb ratings" on public.qb_ratings for INSERT to authenticated with check (true);
create policy "Authenticated users can update qb ratings" on public.qb_ratings for UPDATE to authenticated using (true) with check (true);
create policy "Users can read qb ratings" on public.qb_ratings for SELECT to authenticated using (true);
create policy "admin upsert qb ratings" on public.qb_ratings for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true)))));
create table public.qb_selection_weeks(week integer not null, started_at timestamp with time zone not null default now());
CREATE UNIQUE INDEX qb_selection_weeks_pkey ON public.qb_selection_weeks USING btree (week);
alter table public.qb_selection_weeks enable row level security;
grant all on public.qb_selection_weeks to anon,authenticated,service_role;
create policy "admin_manage_qb_selection_weeks" on public.qb_selection_weeks for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true)))));
create policy "authenticated_read_qb_selection_weeks" on public.qb_selection_weeks for SELECT to authenticated using (true);
create table public.qb_weekly_stats(id bigint not null, week integer not null, espn_athlete_id text not null, qb_name text not null, team text, passer_rating numeric not null, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now());
CREATE UNIQUE INDEX qb_weekly_stats_pkey ON public.qb_weekly_stats USING btree (id);
CREATE UNIQUE INDEX qb_weekly_stats_week_athlete_unique ON public.qb_weekly_stats USING btree (week, espn_athlete_id);
alter table public.qb_weekly_stats enable row level security;
grant all on public.qb_weekly_stats to anon,authenticated,service_role;
create policy "qb_weekly_stats_admin_insert" on public.qb_weekly_stats for INSERT to authenticated with check ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true)))));
create policy "qb_weekly_stats_admin_update" on public.qb_weekly_stats for UPDATE to authenticated using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true)))));
create policy "qb_weekly_stats_read" on public.qb_weekly_stats for SELECT to authenticated using (true);
create table public.qbs(id uuid not null default gen_random_uuid(), espn_athlete_id text, name text not null, team text, active boolean default true, logo text, is_active_starter boolean default true);
CREATE UNIQUE INDEX qbs_espn_athlete_id_key ON public.qbs USING btree (espn_athlete_id);
CREATE UNIQUE INDEX qbs_pkey ON public.qbs USING btree (id);
alter table public.qbs enable row level security;
grant all on public.qbs to anon,authenticated,service_role;
create policy "Users can read qbs" on public.qbs for SELECT to authenticated using (true);
create table public.settings(id integer not null, current_week integer not null default 1, current_season integer not null default 2026);
CREATE UNIQUE INDEX settings_pkey ON public.settings USING btree (id);
alter table public.settings enable row level security;
grant all on public.settings to anon,authenticated,service_role;
create policy "Users can read settings" on public.settings for SELECT to authenticated using (true);
create policy "admin update settings" on public.settings for UPDATE to authenticated using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true)))));
create table public.teams(id uuid not null default gen_random_uuid(), name text not null, logo text, created_at timestamp with time zone default now(), espn_abbr text, wins smallint default 0, losses smallint default 0, ties smallint default 0, division_rank smallint, division_name text);
CREATE UNIQUE INDEX teams_name_key ON public.teams USING btree (name);
CREATE UNIQUE INDEX teams_pkey ON public.teams USING btree (id);
alter table public.teams enable row level security;
grant all on public.teams to anon,authenticated,service_role;
create policy "Admins can update teams" on public.teams for UPDATE to authenticated using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true)))));
create policy "Users can read teams" on public.teams for SELECT to authenticated using (true);
create table public.weekly_scores(id uuid not null default gen_random_uuid(), user_id uuid not null, week integer not null, base_points integer default 0, multiplier numeric default 1, final_score numeric default 0, created_at timestamp with time zone default now());
CREATE UNIQUE INDEX weekly_scores_pkey ON public.weekly_scores USING btree (id);
CREATE UNIQUE INDEX weekly_scores_user_id_week_key ON public.weekly_scores USING btree (user_id, week);
alter table public.weekly_scores enable row level security;
grant all on public.weekly_scores to anon,authenticated,service_role;
create policy "Authenticated users can insert weekly scores" on public.weekly_scores for INSERT to authenticated with check (true);
create policy "Authenticated users can update weekly scores" on public.weekly_scores for UPDATE to authenticated using (true) with check (true);
create policy "Users can read weekly scores" on public.weekly_scores for SELECT to authenticated using (true);
create policy "admin upsert weekly scores" on public.weekly_scores for ALL to authenticated using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true))))) with check ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = auth.uid()) AND (users.is_admin = true)))));
insert into settings values(1,5,2026);
create table push_notification_events(event_key text primary key,user_id uuid,notification_type text,week integer,scheduled_for timestamptz,status text,sent_at timestamptz);
create table playoff_rounds(id bigint primary key,season integer,status text,round_key text);
create table playoff_games(id bigint primary key,round_id bigint,external_game_id text,game_date timestamptz,game_status text);
create table playoff_qb_picks(round_id bigint,user_id uuid,super_bowl_total integer);
create table playoff_team_paths(round_id bigint,user_id uuid);
create table playoff_picks(game_id bigint,user_id uuid);
