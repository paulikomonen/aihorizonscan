-- Allow approved editors to archive signals under row-level security.
-- Run once in Supabase Dashboard -> SQL Editor for an existing project.

begin;

drop policy if exists "Permanent users can read all signals" on public.signals;

create policy "Permanent users can read all signals"
  on public.signals for select
  to authenticated
  using ((select public.is_editor()));

commit;
