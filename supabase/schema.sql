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

drop policy if exists "profiles are readable by their owner" on public.profiles;
create policy "profiles are readable by their owner"
  on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles are insertable by their owner" on public.profiles;
create policy "profiles are insertable by their owner"
  on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles are updatable by their owner" on public.profiles;
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

drop policy if exists "squads are readable by their owner" on public.squads;
create policy "squads are readable by their owner"
  on public.squads for select using (auth.uid() = user_id);
drop policy if exists "squads are insertable by their owner" on public.squads;
create policy "squads are insertable by their owner"
  on public.squads for insert with check (auth.uid() = user_id);
drop policy if exists "squads are updatable by their owner" on public.squads;
create policy "squads are updatable by their owner"
  on public.squads for update using (auth.uid() = user_id);
drop policy if exists "squads are deletable by their owner" on public.squads;
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
  -- Fingerprint of the 15 picks this analysis actually described.
  --
  -- squads carries unique (user_id, gameweek), so changing your squad before a
  -- deadline reuses the same squad row and the same id. Keying the analysis
  -- cache on squad_id alone therefore returned the previous squad's reasoning
  -- for a squad it no longer described — while reporting cached: true.
  squad_hash  text not null,
  model       text not null,
  -- The projection engine's output, so a past analysis can be read against the
  -- numbers it was actually given rather than today's.
  projections jsonb not null,
  analysis    jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists analyses_user_gameweek_idx
  on public.analyses (user_id, gameweek desc, created_at desc);

-- The analysis-cache lookup: the exact squad, gameweek and horizon.
create index if not exists analyses_cache_idx
  on public.analyses (user_id, squad_hash, gameweek, horizon, created_at desc);

alter table public.analyses enable row level security;

drop policy if exists "analyses are readable by their owner" on public.analyses;
create policy "analyses are readable by their owner"
  on public.analyses for select using (auth.uid() = user_id);
drop policy if exists "analyses are insertable by their owner" on public.analyses;
create policy "analyses are insertable by their owner"
  on public.analyses for insert with check (auth.uid() = user_id);
drop policy if exists "analyses are deletable by their owner" on public.analyses;
create policy "analyses are deletable by their owner"
  on public.analyses for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------- analysis usage
--
-- Spend control. Every Claude call costs real money, and `refresh: true`
-- deliberately bypasses the analysis cache, so without a ceiling one client in
-- a loop bills indefinitely.
--
-- Why a table rather than an in-process counter: each serverless instance has
-- its own memory, so a Map-based limit multiplies by however many instances
-- happen to be warm. Postgres is the only thing all instances agree on.
--
-- Why a dedicated table rather than counting rows in `analyses`: the count
-- would be read before the Claude call and the row written 5-20 seconds after
-- it, and every request arriving in that window reads the same stale count.
-- The counter below is incremented and read in a single atomic statement.

create table if not exists public.analysis_usage (
  user_id uuid    not null references auth.users (id) on delete cascade,
  -- UTC, so the window does not shift with the caller's timezone.
  day     date    not null default (now() at time zone 'utc')::date,
  count   integer not null default 0 check (count >= 0),
  primary key (user_id, day)
);

alter table public.analysis_usage enable row level security;

-- Readable so the UI can show remaining quota. Deliberately NOT writable:
-- the app connects as the signed-in user, so an update policy here would let
-- anyone reset their own counter. All writes go through the definer functions
-- below, which run as the table owner rather than as the caller.
drop policy if exists "usage is readable by its owner" on public.analysis_usage;
create policy "usage is readable by its owner"
  on public.analysis_usage for select using (auth.uid() = user_id);

/**
 * Claim one analysis against today's allowance.
 *
 * Returns the caller's new count for the day. The caller compares it with the
 * limit: at or under, proceed; over, refuse and call release_analysis. The
 * increment and the read happen in one statement so concurrent requests
 * serialise instead of all seeing the same pre-call total.
 */
create or replace function public.reserve_analysis()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'reserve_analysis requires an authenticated caller';
  end if;

  insert into public.analysis_usage as u (user_id, day, count)
  values (auth.uid(), (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day)
    do update set count = u.count + 1
  returning u.count into v_count;

  return v_count;
end;
$$;

/**
 * Hand back a reservation that was never billed — the request was refused for
 * exceeding the limit, or the Claude call failed. Without this a failed
 * request would consume allowance the user never got an analysis for.
 */
create or replace function public.release_analysis()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.analysis_usage
     set count = greatest(count - 1, 0)
   where user_id = auth.uid()
     and day = (now() at time zone 'utc')::date;
end;
$$;

revoke all on function public.reserve_analysis() from public;
revoke all on function public.release_analysis() from public;
grant execute on function public.reserve_analysis() to authenticated;
grant execute on function public.release_analysis() to authenticated;
