-- AI Horizon Radar collaborative prototype
-- Run this file in a new Supabase project's SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.signals (
  signal_id text primary key,
  signal_date date not null default current_date,
  geography text not null default 'Global',
  pestec_class text not null,
  ai_domain text not null,
  sector text not null,
  foresight_character text not null check (foresight_character in ('Weak signal', 'Trend', 'Wild card', 'Emerging issue', 'Discontinuity')),
  response_stage text not null check (response_stage in ('Act', 'Prepare', 'Watch')),
  title text not null,
  description text not null default '',
  main_actors text not null default '',
  direction text not null check (direction in ('Opportunity', 'Risk', 'Mixed')),
  indicators text not null default '',
  innovation_stages text[] not null default '{}',
  innovation_impact text not null default '',
  source text not null default '',
  evidence_type text not null default '',
  origin text not null default 'database',
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workshops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,48}$'),
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  ratings_version integer not null default 0 check (ratings_version >= 0),
  opens_at timestamptz,
  closes_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.editor_accounts (
  email text primary key check (email = lower(trim(email))),
  created_at timestamptz not null default now()
);

create table if not exists public.dashboard_content (
  content_key text primary key,
  content text not null check (char_length(trim(content)) between 20 and 5000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint dashboard_content_known_key check (
    content_key in ('qualitative_synthesis')
  )
);

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  signal_id text not null references public.signals(signal_id) on delete cascade,
  participant_id uuid not null references auth.users(id) on delete cascade,
  workshop_version integer not null default 0 check (workshop_version >= 0),
  impact text check (impact in ('Low', 'Medium', 'High')),
  uncertainty text check (uncertainty in ('Low', 'Medium', 'High')),
  recommended_response text check (recommended_response in ('Watch', 'Prepare', 'Act')),
  important boolean not null default false,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workshop_id, signal_id, participant_id),
  check (impact is not null or uncertainty is not null or recommended_response is not null or important or nullif(trim(note), '') is not null)
);

create index if not exists ratings_workshop_signal_idx on public.ratings(workshop_id, signal_id);
create index if not exists signals_active_date_idx on public.signals(is_archived, signal_date desc);

alter table public.signals enable row level security;
alter table public.workshops enable row level security;
alter table public.ratings enable row level security;
alter table public.editor_accounts enable row level security;
alter table public.dashboard_content enable row level security;

create or replace function public.is_editor()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
    and exists (
      select 1 from public.editor_accounts e
      where e.email = lower(auth.jwt()->>'email')
    );
$$;

revoke all on function public.is_editor() from public;
grant execute on function public.is_editor() to authenticated;

create or replace function public.set_qualitative_synthesis(p_content text)
returns table (content text, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned_content text := trim(coalesce(p_content, ''));
begin
  if not public.is_editor() then
    raise exception 'Editor access is required.' using errcode = '42501';
  end if;

  if char_length(cleaned_content) < 20 or char_length(cleaned_content) > 5000 then
    raise exception 'The qualitative synthesis must contain 20–5000 characters.'
      using errcode = '22023';
  end if;

  insert into public.dashboard_content (
    content_key,
    content,
    updated_at,
    updated_by
  )
  values (
    'qualitative_synthesis',
    cleaned_content,
    now(),
    auth.uid()
  )
  on conflict (content_key) do update
  set content = excluded.content,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  return query
    select dc.content, dc.updated_at
    from public.dashboard_content dc
    where dc.content_key = 'qualitative_synthesis';
end;
$$;

revoke all on function public.set_qualitative_synthesis(text) from public;
grant execute on function public.set_qualitative_synthesis(text) to authenticated;

-- Anyone may read active signals. Only permanent authenticated users may edit.
create policy "Active signals are publicly readable"
  on public.signals for select
  to anon, authenticated
  using (is_archived = false);

-- Editors must also be allowed to see the post-update row when archiving a
-- signal. Without this policy PostgreSQL rejects is_archived = true because
-- the public SELECT policy hides the new row state during the UPDATE.
create policy "Permanent users can read all signals"
  on public.signals for select
  to authenticated
  using ((select public.is_editor()));

create policy "Permanent users can create signals"
  on public.signals for insert
  to authenticated
  with check ((select public.is_editor()));

create policy "Permanent users can update signals"
  on public.signals for update
  to authenticated
  using ((select public.is_editor()))
  with check ((select public.is_editor()));

create policy "Dashboard content is publicly readable"
  on public.dashboard_content for select
  to anon, authenticated
  using (true);

create policy "Editors can create dashboard content"
  on public.dashboard_content for insert
  to authenticated
  with check ((select public.is_editor()));

create policy "Editors can update dashboard content"
  on public.dashboard_content for update
  to authenticated
  using ((select public.is_editor()))
  with check ((select public.is_editor()));

-- Open workshops are discoverable by their non-sensitive slug.
create policy "Open workshops are readable"
  on public.workshops for select
  to anon, authenticated
  using (status = 'open');

create policy "Permanent users manage workshops"
  on public.workshops for all
  to authenticated
  using ((select public.is_editor()))
  with check ((select public.is_editor()));

-- Anonymous participants see and modify only their own raw rows.
create policy "Participants read their own ratings"
  on public.ratings for select
  to authenticated
  using (participant_id = auth.uid());

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

create policy "Participants delete their own ratings"
  on public.ratings for delete
  to authenticated
  using (participant_id = auth.uid());

-- Returns anonymous group-level summaries without exposing raw participant IDs
-- or individual strategic notes.
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

-- Editors can clear the current assessment round for one workshop. Incrementing
-- ratings_version tells participant browsers to discard the matching local
-- assessments and prevents stale browser state from reappearing in aggregates.
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

-- Initial workshop used by config.example.js.
insert into public.workshops (slug, title, status)
values ('prototype', 'Prototype workshop', 'open')
on conflict (slug) do nothing;

insert into public.dashboard_content (content_key, content)
values (
  'qualitative_synthesis',
  'Across the current {{signal_count}}-signal set, AI is shifting from a tool-centric productivity story to a system-level innovation management challenge: value increasingly depends on redesigned workflows, AI-ready data, assurance gates, regulatory and procurement evidence, and the ability to govern agents, open models and multimodal systems across the full innovation process. The landscape is broadly distributed across PESTEC categories, showing that technological progress is tightly coupled with political compliance and sovereignty, economic compute concentration and operating-model redesign, environmental energy and water constraints, social skills and trust dynamics, and cultural questions of authenticity, disclosure and IP. Innovation teams need a dual posture: act now on governance, workflow redesign, cyber/content risks and infrastructure constraints; prepare capabilities for evaluation, data quality, skills, licensing and responsible scaling; and watch further-horizon discontinuities and wild cards such as deceptive agents and embodied-AI standardisation.'
)
on conflict (content_key) do nothing;
