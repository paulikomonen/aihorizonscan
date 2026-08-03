-- Expose workshop strategic notes anonymously in the group aggregate.
-- Participant IDs and raw rating rows remain private.

begin;

drop function if exists public.get_workshop_aggregates(text);

create function public.get_workshop_aggregates(p_workshop_slug text)
returns table (
  signal_id text,
  rating_count bigint,
  avg_impact numeric,
  avg_uncertainty numeric,
  watch_count bigint,
  prepare_count bigint,
  act_count bigint,
  important_count bigint,
  strategic_notes text[]
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.signal_id,
    count(*) as rating_count,
    round(avg(case r.impact when 'Low' then 1 when 'Medium' then 2 when 'High' then 3 end), 2) as avg_impact,
    round(avg(case r.uncertainty when 'Low' then 1 when 'Medium' then 2 when 'High' then 3 end), 2) as avg_uncertainty,
    count(*) filter (where r.recommended_response = 'Watch') as watch_count,
    count(*) filter (where r.recommended_response = 'Prepare') as prepare_count,
    count(*) filter (where r.recommended_response = 'Act') as act_count,
    count(*) filter (where r.important) as important_count,
    coalesce(
      array_agg(btrim(r.note) order by r.updated_at desc)
        filter (where nullif(btrim(r.note), '') is not null),
      array[]::text[]
    ) as strategic_notes
  from public.ratings r
  join public.workshops w on w.id = r.workshop_id
  where w.slug = p_workshop_slug
    and w.status in ('open', 'closed')
    and r.workshop_version = w.ratings_version
  group by r.signal_id;
$$;

revoke all on function public.get_workshop_aggregates(text) from public;
grant execute on function public.get_workshop_aggregates(text) to anon, authenticated;

commit;
