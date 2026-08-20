-- FPL Assistant schema.
-- Apply in the Supabase SQL editor, or via `supabase db push`.
--
-- Every table is owned by a user and protected by row-level security: the
-- anon key is what reaches the browser, so RLS is the actual access control,
-- not a second layer behind one.

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  fpl_entry_id integer,
  team_name    text,
  manager_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.profiles.fpl_entry_id is
  'The manager''s FPL ID, from the URL of their points page. Not unique: two users may track the same team.';

alter table public.profiles enable row level security;

create policy "profiles are readable by their owner"
  on public.profiles for select using (auth.uid() = id);
create policy "profiles are insertable by their owner"
  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles are updatable by their owner"
  on public.profiles for update using (auth.uid() = id);

-- Create a profile row automatically whenever a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ squads

create table if not exists public.squads (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  gameweek     integer not null check (gameweek between 1 and 38),
  fpl_entry_id integer,
  -- The 15 picks as imported. Stored verbatim so an analysis can always be
  -- reproduced against the squad it actually described.
  picks        jsonb not null,
  bank         numeric(5, 1),
  squad_value  numeric(5, 1),
  source       text not null default 'fpl_import'
                 check (source in ('fpl_import', 'manual')),
  created_at   timestamptz not null default now(),

  -- One squad per user per gameweek; re-importing replaces it.
  unique (user_id, gameweek)
);

create index if not exists squads_user_gameweek_idx
  on public.squads (user_id, gameweek desc);

alter table public.squads enable row level security;

create policy "squads are readable by their owner"
  on public.squads for select using (auth.uid() = user_id);
create policy "squads are insertable by their owner"
  on public.squads for insert with check (auth.uid() = user_id);
create policy "squads are updatable by their owner"
  on public.squads for update using (auth.uid() = user_id);
create policy "squads are deletable by their owner"
  on public.squads for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------- analyses

create table if not exists public.analyses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Analyses outlive the squad they describe: keep the history readable even
  -- if the squad row is replaced by a re-import.
  squad_id    uuid references public.squads (id) on delete set null,
  gameweek    integer not null check (gameweek between 1 and 38),
  horizon     integer not null default 5,
  model       text not null,
  -- The projection engine's output, so a past analysis can be read against the
  -- numbers it was actually given rather than today's.
  projections jsonb not null,
  analysis    jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists analyses_user_gameweek_idx
  on public.analyses (user_id, gameweek desc, created_at desc);

alter table public.analyses enable row level security;

create policy "analyses are readable by their owner"
  on public.analyses for select using (auth.uid() = user_id);
create policy "analyses are insertable by their owner"
  on public.analyses for insert with check (auth.uid() = user_id);
create policy "analyses are deletable by their owner"
  on public.analyses for delete using (auth.uid() = user_id);
