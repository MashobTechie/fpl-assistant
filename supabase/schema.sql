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
  -- Which build of the projection engine produced the numbers this analysis
  -- reasons about. Part of the cache key: when the maths changes, previous
  -- analyses describe figures the app no longer produces and must not be
  -- served as though they still hold.
  engine_version text not null default '1',
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
  on public.analyses (user_id, squad_hash, engine_version, gameweek, horizon, created_at desc);

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

-- ------------------------------------------------------------ FPL snapshots
--
-- Two tables solving two different problems.
--
-- Unlike profiles/squads/analyses, this is public reference data with no
-- owner, so the RLS shape differs: history is world-readable, and the serving
-- cache is readable by nobody through the API. Both are written only by the
-- snapshot job, which uses the service role and bypasses RLS entirely.

/**
 * Daily history of every player.
 *
 * FPL overwrites these fields in place and exposes no history endpoint: today's
 * ownership figure is unrecoverable tomorrow. Each row is therefore a piece of
 * the past that only exists because it was captured.
 *
 * Keyed on (captured_on, player_id), so running the job more often than daily
 * refreshes the day's row rather than accumulating duplicates. Prices move once
 * a day, around 01:30 UTC, so a finer grain would store the same number many
 * times over — measured, half-hourly capture costs 1.49 GB a season against
 * 0.03 GB for daily.
 */
create table if not exists public.fpl_player_snapshots (
  captured_on          date    not null,
  player_id            integer not null,
  gameweek             integer,
  now_cost             integer not null,
  cost_change_event    integer,
  selected_by_percent  numeric(5, 2),
  transfers_in_event   integer,
  transfers_out_event  integer,
  total_points         integer,
  minutes              integer,
  form                 numeric(5, 2),
  status               text,
  captured_at          timestamptz not null default now(),
  primary key (captured_on, player_id)
);

create index if not exists fpl_snapshots_player_idx
  on public.fpl_player_snapshots (player_id, captured_on desc);

alter table public.fpl_player_snapshots enable row level security;

-- Public reference data: readable by anyone, written by the job alone.
drop policy if exists "player history is public" on public.fpl_player_snapshots;
create policy "player history is public"
  on public.fpl_player_snapshots for select using (true);

/**
 * The current FPL payloads, overwritten in place.
 *
 * This is the serving layer. Without it every serverless instance keeps its own
 * in-memory copy, so two requests a second apart can see prices an hour apart.
 * It also means an FPL outage degrades the app to slightly stale data instead
 * of stopping it.
 *
 * Deliberately has RLS enabled and NO policy: nothing should read this through
 * the public API. The server reads it with the service role.
 */
create table if not exists public.fpl_cache (
  key        text primary key,
  payload    jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.fpl_cache enable row level security;

-- ------------------------------------------------------- last-season history
--
-- FPL zeroes every season total at the first deadline of a new season. Measured
-- 2026-08-21: within an hour of the GW1 lock, all 600 players read 0 minutes,
-- 0 BPS, 0 xG and 0 cards. The projection engine reads those fields, so every
-- player silently fell back to a price-based guess — Haaland and a £4.5m
-- reserve became the same projection with the same confidence.
--
-- Previous seasons remain available per player at /element-summary/{id}/, but
-- that is one request per player, so it is fetched once and kept here.
--
-- Keyed on element_code, not element id: FPL reassigns ids between seasons and
-- only the code is stable.

create table if not exists public.fpl_player_history (
  element_code            integer not null,
  season_name             text    not null,
  minutes                 integer not null,
  starts                  integer,
  goals_scored            integer,
  assists                 integer,
  clean_sheets            integer,
  goals_conceded          integer,
  own_goals               integer,
  penalties_saved         integer,
  penalties_missed        integer,
  yellow_cards            integer,
  red_cards               integer,
  saves                   integer,
  bonus                   integer,
  bps                     integer,
  defensive_contribution  integer,
  expected_goals          numeric(8, 2),
  expected_assists        numeric(8, 2),
  expected_goals_conceded numeric(8, 2),
  total_points            integer,
  end_cost                integer,
  fetched_at              timestamptz not null default now(),
  primary key (element_code, season_name)
);

create index if not exists fpl_history_season_idx
  on public.fpl_player_history (season_name, element_code);

alter table public.fpl_player_history enable row level security;

drop policy if exists "player history is public" on public.fpl_player_history;
create policy "player history is public"
  on public.fpl_player_history for select using (true);
