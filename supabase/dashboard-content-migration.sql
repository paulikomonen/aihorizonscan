-- Run once in Supabase Dashboard -> SQL Editor.
-- Adds public dashboard content that only approved editor accounts may change.

begin;

create table if not exists public.dashboard_content (
  content_key text primary key,
  content text not null check (char_length(trim(content)) between 20 and 5000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint dashboard_content_known_key check (
    content_key in ('qualitative_synthesis')
  )
);

alter table public.dashboard_content enable row level security;

drop policy if exists "Dashboard content is publicly readable" on public.dashboard_content;
create policy "Dashboard content is publicly readable"
  on public.dashboard_content for select
  to anon, authenticated
  using (true);

drop policy if exists "Editors can create dashboard content" on public.dashboard_content;
create policy "Editors can create dashboard content"
  on public.dashboard_content for insert
  to authenticated
  with check ((select public.is_editor()));

drop policy if exists "Editors can update dashboard content" on public.dashboard_content;
create policy "Editors can update dashboard content"
  on public.dashboard_content for update
  to authenticated
  using ((select public.is_editor()))
  with check ((select public.is_editor()));

drop function if exists public.set_qualitative_synthesis(text);

create function public.set_qualitative_synthesis(p_content text)
returns jsonb
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

  return (
    select jsonb_build_object(
      'content', dc.content,
      'updated_at', dc.updated_at
    )
    from public.dashboard_content dc
    where dc.content_key = 'qualitative_synthesis'
  );
end;
$$;

revoke all on function public.set_qualitative_synthesis(text) from public;
grant execute on function public.set_qualitative_synthesis(text) to authenticated;

insert into public.dashboard_content (content_key, content)
values (
  'qualitative_synthesis',
  'Across the current {{signal_count}}-signal set, AI is shifting from a tool-centric productivity story to a system-level innovation management challenge: value increasingly depends on redesigned workflows, AI-ready data, assurance gates, regulatory and procurement evidence, and the ability to govern agents, open models and multimodal systems across the full innovation process. The landscape is broadly distributed across PESTEC categories, showing that technological progress is tightly coupled with political compliance and sovereignty, economic compute concentration and operating-model redesign, environmental energy and water constraints, social skills and trust dynamics, and cultural questions of authenticity, disclosure and IP. Innovation teams need a dual posture: act now on governance, workflow redesign, cyber/content risks and infrastructure constraints; prepare capabilities for evaluation, data quality, skills, licensing and responsible scaling; and watch further-horizon discontinuities and wild cards such as deceptive agents and embodied-AI standardisation.'
)
on conflict (content_key) do nothing;

commit;
