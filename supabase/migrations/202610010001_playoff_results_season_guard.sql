-- MANUAL ONLY, after 202609290001_playoff_scoring.sql.
-- Read-only contract guard; no data or RLS changes. Safe to reapply on its own.
begin;

create or replace function public.read_playoff_results(p_round_ids bigint[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare season_count integer;
begin
  if exists (
    select 1 from unnest(p_round_ids) as requested(id)
    left join public.playoff_rounds r on r.id=requested.id
    where r.id is null
  ) then
    raise exception 'Unknown Playoffs round ID' using errcode='22023';
  end if;

  select count(distinct r.season) into season_count
  from public.playoff_rounds r where r.id=any(p_round_ids);
  if season_count > 1 then
    raise exception 'Playoffs results must belong to a single season' using errcode='22023';
  end if;

  return jsonb_build_object(
    'results',coalesce((select jsonb_agg(to_jsonb(s) order by s.round_id,s.user_id) from public.playoff_round_results s where s.round_id=any(p_round_ids)),'[]'),
    'runs',coalesce((select jsonb_agg(jsonb_build_object('round_id',r.round_id,'processed_at',r.processed_at,'standings',r.standings,'finalized_at',r.finalized_at) order by r.round_id) from public.playoff_round_runs r where r.round_id=any(p_round_ids)),'[]')
  );
end $$;

revoke all on function public.read_playoff_results(bigint[]) from public,anon;
grant execute on function public.read_playoff_results(bigint[]) to authenticated,service_role;
commit;
