-- Run once in the Supabase SQL editor for an existing AI Horizon Radar project.
-- Existing ratings remain in assessment round 0 until an editor clears them.

alter table public.workshops
  add column if not exists ratings_version integer not null default 0;

alter table public.ratings
  add column if not exists workshop_version integer not null default 0;

alter table public.workshops
  drop constraint if exists workshops_ratings_version_check;
alter table public.workshops
  add constraint workshops_ratings_version_check check (ratings_version >= 0);

alter table public.ratings
  drop constraint if exists ratings_workshop_version_check;
alter table public.ratings
  add constraint ratings_workshop_version_check check (workshop_version >= 0);

drop policy if exists "Participants rate open workshops" on public.ratings;
create policy "Participants rate open workshops"
  on public.ratings for insert
  to authenticated
  with check (
    participant_id = auth.uid()
    and exists (
      select 1 from public.workshops w
      where w.id = workshop_id and w.status = 'open'
        and w.ratings_version = workshop_version
        and (w.opens_at is null or w.opens_at <= now())
        and (w.closes_at is null or w.closes_at >= now())
    )
  );

drop policy if exists "Participants update their own ratings" on public.ratings;
create policy "Participants update their own ratings"
  on public.ratings for update
  to authenticated
  using (participant_id = auth.uid())
  with check (
    participant_id = auth.uid()
    and exists (
      select 1 from public.workshops w
      where w.id = workshop_id
        and w.status = 'open'
        and w.ratings_version = workshop_version
    )
  );

create or replace function public.get_workshop_aggregates(p_workshop_slug text)
returns table (
  signal_id text,
  rating_count bigint,
  avg_impact numeric,
  avg_uncertainty numeric,
  watch_count bigint,
  prepare_count bigint,
  act_count bigint,
  important_count bigint
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
    count(*) filter (where r.important) as important_count
  from public.ratings r
  join public.workshops w on w.id = r.workshop_id
  where w.slug = p_workshop_slug
    and w.status in ('open', 'closed')
    and r.workshop_version = w.ratings_version
  group by r.signal_id;
$$;

revoke all on function public.get_workshop_aggregates(text) from public;
grant execute on function public.get_workshop_aggregates(text) to anon, authenticated;

create or replace function public.clear_workshop_ratings(p_workshop_slug text)
returns table (deleted_count bigint, ratings_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_workshop_id uuid;
  removed bigint;
  next_version integer;
begin
  if not public.is_editor() then
    raise exception 'Editor access is required.' using errcode = '42501';
  end if;

  select id into target_workshop_id
  from public.workshops
  where slug = p_workshop_slug;

  if target_workshop_id is null then
    raise exception 'Workshop % was not found.', p_workshop_slug using errcode = 'P0002';
  end if;

  delete from public.ratings where workshop_id = target_workshop_id;
  get diagnostics removed = row_count;

  update public.workshops as w
  set ratings_version = w.ratings_version + 1,
      updated_at = now()
  where w.id = target_workshop_id
  returning w.ratings_version into next_version;

  return query select removed, next_version;
end;
$$;

revoke all on function public.clear_workshop_ratings(text) from public;
grant execute on function public.clear_workshop_ratings(text) to authenticated;
