@AGENTS.md

# FPL Assistant

A Fantasy Premier League analysis SaaS. Managers import a squad, and get an
expected-points projection for every player plus an analyst's reasoning about
the lineup, captaincy, risks and transfers.

## The central architectural rule

**The LLM never computes a number.** A deterministic engine
([lib/projections/engine.ts](lib/projections/engine.ts)) produces every
expected-points figure from per-90 xG/xA, expected minutes, fixture difficulty,
clean-sheet probability, defensive-contribution thresholds and bonus rates.
Claude receives those numbers and reasons *about* them.

This is the product. Ask a model to "project points from xG and fixtures" and it
returns confident, plausible, wrong numbers — which destroys the one claim the
app makes. Two consequences to preserve:

- **The starting XI is solved, not guessed.** Optimal-XI selection is a
  constrained optimisation over nine legal formations
  ([lib/squad/optimizer.ts](lib/squad/optimizer.ts)). The LLM may override it,
  but only citing something the model cannot see — an injury flag, a
  `price_prior` data basis, low confidence. The prompt enforces this.
- **Model priors live in one place.** [lib/projections/constants.ts](lib/projections/constants.ts)
  separates FPL scoring rules (fact) from tunable priors (FDR multipliers,
  clean-sheet probabilities, minutes priors). Tune there, not inline.

## Stack

Next.js 16.3 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 ·
Supabase (auth + Postgres) · Anthropic SDK (`claude-opus-5`) · Zod 4.

## Layout

```
lib/fpl/            client.ts (server-only API client), cache.ts, store.ts, types.ts
lib/projections/    engine.ts (the maths), constants.ts (rules + priors)
lib/squad/          optimizer.ts (exact XI), resolve.ts (orchestration),
                    draft.ts (try transfers), planner.ts, chips.ts
lib/ai/             analyst.ts (Claude call), prompts.ts, schema.ts (Zod)
lib/supabase/       client.ts, server.ts, session.ts
lib/draft-session.ts  an unsaved draft, kept in sessionStorage across a reload
app/api/analysis/   POST — projections + reasoning, cached per squad+gameweek
app/api/projections/ POST — the deterministic half: numbers, no LLM, free
app/api/drafts/     GET/POST/DELETE — saved drafts, per squad+gameweek
app/api/cron/       GET  — scheduled snapshot; bearer CRON_SECRET, daily 03:00Z
app/api/players/    GET — all ~600 players projected, for the manual picker
app/dashboard/      the product
proxy.ts            auth redirects (Next 16 renamed middleware -> proxy)
supabase/schema.sql profiles, squads, analyses, drafts — all under RLS
supabase/migrations/  the same schema as ordered migrations; schema.sql is the
                    whole picture, migrations/ is how it got there
```

## Things that will bite

- **Next 16 renamed `middleware` to `proxy`.** A `middleware.ts` file still
  builds but warns. The convention here is `proxy.ts` exporting `proxy`.
- **The FPL API sends no CORS headers.** Never import `lib/fpl/client` into a
  client component; it only works server-side.
- **`bootstrap-static` is ~2.1MB and Next's data cache rejects anything over
  2MB.** `next: { revalidate }` therefore failed *silently* and re-fetched on
  every request. The fix is `cache: "no-store"` plus payload trimming and an
  in-process TTL memo in [lib/fpl/cache.ts](lib/fpl/cache.ts). Measured: 1.74s
  cold, 0.016s warm.
- **FPL data reads through three layers**, cheapest first: the in-process memo,
  then Postgres ([lib/fpl/store.ts](lib/fpl/store.ts)), then FPL itself.
  Measured: 1199ms live, 85ms from Postgres cold, 36ms warm. The middle layer is
  what makes instances agree — without it each serverless instance keeps its own
  copy and two requests a second apart can see prices an hour apart. A live
  fetch writes back, so a stale stored copy self-heals.
- **`getBootstrapLive`/`getFixturesLive` bypass every cache** and exist for the
  snapshot job: a job whose purpose is to refresh the cache must not read from
  the cache it is refreshing.
- **FPL publishes no history.** Price and ownership are overwritten in place, so
  today's `selected_by_percent` is unrecoverable tomorrow.
  `fpl_player_snapshots` keeps one row per player per day — measured 152kB/day,
  ~42MB/season. Daily, not half-hourly: prices move once a day around 01:30 UTC,
  and half-hourly capture would cost 1.49GB a season to store the same numbers
  48 times. The job upserts on `(captured_on, player_id)`, so running it more
  often is harmless.
- **Picks are for the last LOCKED gameweek, not the one being analysed.** These
  are different numbers. `is_next` means that deadline has not passed, and picks
  exist only after one does — asking for the analysed gameweek's picks asks for
  the one set guaranteed not to exist. `resolvePicksGameweek` finds the right
  one by deadline.
- **Season totals change meaning.** Pre-season, `minutes`/`expected_goals` hold
  *last* season's numbers; once underway the same fields hold *this* season's.
  `baseMinutesPerMatch` divides by 38 or by gameweeks played accordingly —
  dividing a 3-gameweek total by 38 would make everyone look benched.
- **Picks are unavailable before a deadline.** `/entry/{id}/event/{gw}/picks/`
  404s until the gameweek deadline passes, so FPL-ID import cannot work for a
  squad that is not yet locked. Manual squad building is the only route in
  before a deadline, not a fallback.
- **Cache the analysis.** One LLM call per dashboard refresh would make this
  expensive for no gain; `/api/analysis` reuses a stored analysis per
  (squad, gameweek, horizon) unless `refresh: true`.
- **Anthropic API specifics:** `client.messages.parse` with
  `output_config: { format: zodOutputFormat(...) }`, adaptive thinking, and the
  system prompt frozen as a cache prefix. This SDK version has no
  `APIStatusError` — the classes are `APIError`, `InternalServerError`, etc.
- **The `cache_control` on the system prompt is currently inert.** The prefix is
  ~518 tokens and the minimum cacheable prefix is ~1024, so it silently does
  nothing. Harmless, and it starts working if the system prompt grows past the
  threshold — do not pad the prompt to chase it, the saving would be ~$0.002.
- **A draft must never be written to `squads`.** That table is unique on
  (user_id, gameweek), so a draft stored there overwrites the real squad and the
  next page load restores moves nobody made. Saved drafts have their own table;
  the analysis of a draft is cached with a key carrying the hit and the chip, so
  it is never served back as the analysis of a real squad with the same fifteen.
- **A saved draft stores the question, not the answer** — the swaps and the
  chip, never the resulting fifteen and never the verdict. Prices move daily, so
  a stored verdict reads as current while describing last week's market, and
  recomputing it is free. A stored fifteen would be worse: make one of the moves
  for real, re-import, and those fifteen are a squad the manager never had.
- **The two kinds of squad are priced differently, and must stay that way.** An
  imported squad transfers against FPL's own bank and selling prices, which
  return only half of any rise. A manual fifteen has neither, so it is priced at
  market value against what is left of the £100m. Pricing an imported squad at
  market value approves moves FPL rejects — that was a real bug.
- **A manual squad's hit is unknowable, not zero.** The free-transfer count is
  reconstructed from public FPL history and a squad built in the app has none.
  `draft.hitUnknown` says so and the UI withholds the figure; do not "fix" it by
  defaulting to one free transfer.
- **Chips are declared by the manager, not read from history.** FPL grants a
  second set in the back half of the season and the public history endpoint does
  not say which half a played chip came from, so a chip that looks spent is a
  warning rather than a refusal.
- **The simulation seed is load-bearing.** `simulatePlayer` seeds on
  (playerId, gameweek) and nothing else, which is what lets a squad and a draft
  of it be compared sample by sample: the players they share draw identical
  numbers and cancel. Randomise it and the draft odds collapse toward 50% with a
  spread wide enough to be meaningless.
- **Summing a double gameweek, not concatenating it.** A player with two
  fixtures scores both, so his samples add elementwise. `flatMap` over the
  fixtures builds a mixture instead — a player who plays one of the two — which
  halved the mean and reported a single match's ceiling. That was a real bug in
  captaincy, where a double gameweek is the main reason to captain someone.

## Cost

Measured: ~1,920 input tokens per analysis, plus 2,000-4,000 output tokens
including adaptive thinking. On `claude-opus-5` ($5/$25 per M) that is roughly
**$0.06-0.11 per analysis** — about 12 analyses to the dollar.

- One manager for a full 38-gameweek season: ~$3.
- `/api/analysis` reuses a stored analysis per (squad, gameweek, horizon), so
  dashboard refreshes are free. Only a changed squad or `refresh: true` bills.
- `ANTHROPIC_MODEL` overrides the model. `claude-haiku-4-5` costs ~$0.017 per
  analysis (~5x cheaper) and is fine for exercising the wiring; the analysis is
  visibly shallower, so ship on Opus. `analyses.model` records what was used.
- **The projection engine costs nothing.** FPL fetch, the maths, the optimal XI
  and `/api/players` all run without an API key. Without a key you lose only the
  written analysis, not the numbers.
- Set a spend limit in the Anthropic Console (Billing -> Limits) before pasting
  a key anywhere. That is the actual hard stop.

## Commands

```bash
npm run dev                   # http://localhost:3000
npm run build && npm run lint && npm run typecheck
npm test                      # unit tests: the maths and the transfer rules
npm run dry-run               # live FPL data -> projections -> the Claude prompt, no API call
npm run smoke                 # the real HTTP routes, signed in, against local Supabase
npm run validate:projections <bootstrap.json> <fixtures.json>
```

`dry-run` is the fastest way to check a projection change: it prints the optimal
XI and the exact prompt without spending an API call.

`smoke` is the fastest way to check anything Supabase-backed. It needs
`npx supabase start` and `npm run dev` running, creates a throwaway user,
signs in exactly as the app does — through `@supabase/ssr` with a cookie jar,
so the cookie is the library's rather than one this script guessed — drives the
routes, and deletes the user afterwards. It never calls `/api/analysis`: a
smoke test that bills an Anthropic request per run is one nobody runs.

Local Supabase is on non-default ports (API 54421, DB 54422, Studio 54423) so
it does not collide with another project's stack.

## Status

Built and verified against live FPL data: FPL client, projection engine, XI
optimiser, squad resolution, all four API routes, auth, and the full dashboard
UI. Build, lint, typecheck, 34 unit tests and 17 smoke checks pass.

Verified 2026-11-20 against a local Supabase, through the HTTP routes with a
real session cookie: auth guards, squad persistence, saved drafts (save, list,
re-save over a name, delete), drafts on both imported and manual squads, the
chip paths, and both composition rules refusing an illegal draft. RLS checked
separately in psql with two users — neither can read, delete or forge the
other's rows.

**Not verified:** the Claude call. `/api/analysis` has still never executed
against the real API, because every run of it costs money and nothing so far
has needed one to prove a point. It is the one path written against the
documented API and never run. `npm run dry-run` prints the exact prompt it
would send, which is how the prompt changes since have been checked.

**Not built** (deliberately deferred after the vertical slice): the standalone
player-comparison tool, chip strategy beyond valuing each chip, price-rise
prediction, paid tiers. Transfers now have a real screen — the sandbox, the
plan and saved drafts — so the "no planner UI" gap is closed; what is missing
is a comparison tool for two players side by side.

## Where to pick up

In rough priority order:

1. **Run `/api/analysis` for real.** The one path never executed. `.env.local`
   has a real `ANTHROPIC_API_KEY` now, so this is a decision to spend about ten
   cents rather than a blocker. Set a spend limit in the Console first. The
   draft, chip and odds figures all reach the prompt and none of that wording
   has been read back by the model yet.
2. **Price-change timing.** `fpl_player_snapshots` has been capturing daily
   since August and nothing reads it for this: "he rises tonight, buy now" and
   "waiting costs you 0.1 of his selling price" are both answerable from it,
   and timing is half of a transfer decision.
3. **Deploy to Vercel.** The remote exists and `main` is pushed. Needs the env
   vars set in the Vercel project, and `supabase/schema.sql` applied to a
   hosted Supabase project rather than the local one.
4. Then the deferred features: a player-comparison screen, chip strategy,
   price-rise prediction.

Tune the projection maths with `npm run dry-run`, which costs nothing.

## Context

Season 2026/27, which began 2026-08-21. Note that pre-season means every player
carries `last_season` or `price_prior` as their data basis and confidence is
capped — the UI surfaces this rather than hiding it.

The FPL API is undocumented and unofficial. Fine for a build; worth a decision
before charging money on top of it.
