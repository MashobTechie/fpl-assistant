-- Saved transfer drafts. See supabase/schema.sql for the full schema.

-- ------------------------------------------------------------------- drafts
--
-- A saved draft stores the question, never the answer.
--
-- Only the swaps and the chip go in: not the resulting fifteen, and not the
-- verdict. Three reasons, each one a bug avoided.
--
-- Prices and projections move every day, so a stored verdict would be read as
-- current while describing a week-old market. Recomputing it costs nothing —
-- the engine needs no API key — and is always right.
--
-- A stored fifteen would outlive the squad it was built from. Make one of the
-- moves in FPL for real, re-import, and those fifteen are a squad the manager
-- never had. Re-applying the swaps against whatever the squad is now either
-- works or fails loudly, and loudly is the honest outcome.
--
-- And the squads table is deliberately one row per user per gameweek: a draft
-- written there would overwrite the real squad, which is the whole reason
-- drafts were never persisted until now.

create table if not exists public.drafts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  gameweek     integer not null check (gameweek between 1 and 38),
  -- The manager's own label. Saving two is the point: "Haaland or Watkins" is
  -- a question you answer by holding both drafts side by side.
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  fpl_entry_id integer,
  -- [{ "out": id, "in": id }], against the squad as it stood when saved.
  transfers    jsonb not null,
  -- A Wildcard or Free Hit played with these moves, which makes them free.
  chip         text check (chip in ('wildcard', 'freehit')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Saving under a name already used for this gameweek replaces it, which is
  -- what "save" means the second time you refine the same idea.
  unique (user_id, gameweek, name)
);

create index if not exists drafts_user_gameweek_idx
  on public.drafts (user_id, gameweek desc, updated_at desc);

alter table public.drafts enable row level security;

drop policy if exists "drafts are readable by their owner" on public.drafts;
create policy "drafts are readable by their owner"
  on public.drafts for select using (auth.uid() = user_id);
drop policy if exists "drafts are insertable by their owner" on public.drafts;
create policy "drafts are insertable by their owner"
  on public.drafts for insert with check (auth.uid() = user_id);
drop policy if exists "drafts are updatable by their owner" on public.drafts;
create policy "drafts are updatable by their owner"
  on public.drafts for update using (auth.uid() = user_id);
drop policy if exists "drafts are deletable by their owner" on public.drafts;
create policy "drafts are deletable by their owner"
  on public.drafts for delete using (auth.uid() = user_id);
