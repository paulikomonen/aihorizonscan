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

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  signal_id text not null references public.signals(signal_id) on delete cascade,
  participant_id uuid not null references auth.users(id) on delete cascade,
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

-- Anyone may read active signals. Only permanent authenticated users may edit.
create policy "Active signals are publicly readable"
  on public.signals for select
  to anon, authenticated
  using (is_archived = false);

create policy "Permanent users can create signals"
  on public.signals for insert
  to authenticated
  with check ((select public.is_editor()));

create policy "Permanent users can update signals"
  on public.signals for update
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
    and exists (select 1 from public.workshops w where w.id = workshop_id and w.status = 'open')
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
  where w.slug = p_workshop_slug and w.status in ('open', 'closed')
  group by r.signal_id;
$$;

revoke all on function public.get_workshop_aggregates(text) from public;
grant execute on function public.get_workshop_aggregates(text) to anon, authenticated;

-- Initial workshop used by config.example.js.
insert into public.workshops (slug, title, status)
values ('prototype', 'Prototype workshop', 'open')
on conflict (slug) do nothing;
