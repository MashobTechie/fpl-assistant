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
lib/fpl/            client.ts (server-only API client), cache.ts, types.ts
lib/projections/    engine.ts (the maths), constants.ts (rules + priors)
lib/squad/          optimizer.ts (exact XI), resolve.ts (orchestration)
lib/ai/             analyst.ts (Claude call), prompts.ts, schema.ts (Zod)
lib/supabase/       client.ts, server.ts, session.ts
app/api/analysis/   POST — projections + reasoning, cached per squad+gameweek
app/api/players/    GET — all ~600 players projected, for the manual picker
app/dashboard/      the product
proxy.ts            auth redirects (Next 16 renamed middleware -> proxy)
supabase/schema.sql profiles, squads, analyses — all under RLS
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
  cold, 0.016s warm. The durable fix is snapshotting to Postgres on a schedule.
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
npm run dry-run               # live FPL data -> projections -> the Claude prompt, no API call
npm run validate:projections <bootstrap.json> <fixtures.json>
```

`dry-run` is the fastest way to check a projection change: it prints the optimal
XI and the exact prompt without spending an API call.

## Status

Built and verified against live FPL data: FPL client, projection engine, XI
optimiser, squad resolution, both API routes, auth, and the full dashboard UI.
Build, lint and typecheck pass. `/api/players` verified end-to-end in the
running app.

**Not verified:** the Claude call and the Supabase-backed flows (auth, persistence,
analysis caching) have never executed — the build environment had neither an
`ANTHROPIC_API_KEY` nor a Supabase project. They are written against the
documented APIs but are unrun code. First real run should exercise
`/api/analysis` end-to-end.

**Not built** (deliberately deferred after the vertical slice): the standalone
player-comparison tool, the full transfer planner UI, chip strategy, price-rise
prediction, paid tiers. The analyst already returns transfer ideas; there is no
dedicated planner screen yet.

## Where to pick up

In rough priority order:

1. **Fill in real credentials.** `.env.local` exists but holds placeholders,
   which is why nothing Supabase-backed has ever run. Needs a Supabase project
   (paste `supabase/schema.sql` into its SQL editor) and an `ANTHROPIC_API_KEY`,
   with a spend limit set in the Console first.
2. **Run `/api/analysis` for real.** It is the one path never executed.
   Everything else was verified against live FPL data.
3. **Push to GitHub.** Resolved 2026-08-20: this is its own git repo, not a
   `ctrl_lab` subfolder, so that the Vercel project root is the repo root. The
   initial commit is in; the remote is not yet created (`gh` is not installed
   on this machine).
4. **Deploy to Vercel**, then the deferred features: player-comparison screen,
   a real transfer-planner UI, chip strategy, price-rise prediction.

Tune the projection maths with `npm run dry-run`, which costs nothing.

## Context

Season 2026/27, which began 2026-08-21. Note that pre-season means every player
carries `last_season` or `price_prior` as their data basis and confidence is
capped — the UI surfaces this rather than hiding it.

The FPL API is undocumented and unofficial. Fine for a build; worth a decision
before charging money on top of it.
