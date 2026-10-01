-- Run in the Supabase SQL Editor to create public, slug-addressed workspaces.
create table if not exists public.visualizer_workspaces (
  slug text primary key
    check (slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  source text not null default ''
    check (octet_length(source) <= 100000),
  programs jsonb not null default '[]'::jsonb,
  active_program_id text,
  updated_at timestamptz not null default now()
);

-- Keep this setup script safe to rerun on workspaces created with the older schema.
alter table public.visualizer_workspaces
  add column if not exists programs jsonb not null default '[]'::jsonb;
alter table public.visualizer_workspaces
  add column if not exists active_program_id text;
alter table public.visualizer_workspaces
  drop constraint if exists visualizer_workspaces_programs_check;
alter table public.visualizer_workspaces
  add constraint visualizer_workspaces_programs_check
  check (jsonb_typeof(programs) = 'array' and octet_length(programs::text) <= 700000);

alter table public.visualizer_workspaces enable row level security;
revoke all on table public.visualizer_workspaces from anon, authenticated;
grant select, insert, update on table public.visualizer_workspaces to anon;

drop policy if exists "Anyone can read shared workspaces" on public.visualizer_workspaces;
create policy "Anyone can read shared workspaces"
  on public.visualizer_workspaces for select to anon using (true);

drop policy if exists "Anyone can create shared workspaces" on public.visualizer_workspaces;
create policy "Anyone can create shared workspaces"
  on public.visualizer_workspaces for insert to anon with check (true);

drop policy if exists "Anyone can update shared workspaces" on public.visualizer_workspaces;
create policy "Anyone can update shared workspaces"
  on public.visualizer_workspaces for update to anon using (true) with check (true);
