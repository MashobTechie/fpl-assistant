# FPL Assistant

Data-driven gameweek analysis for Fantasy Premier League. Import a squad, get an
expected-points projection for every player and an analyst's reasoning about the
lineup, captaincy, risks and transfers.

## How it works

The interesting decision is the split between arithmetic and judgement.

A **deterministic projection engine** computes expected points for every player
from per-90 expected goals and assists, expected minutes, fixture difficulty,
clean-sheet probability, defensive-contribution thresholds and bonus-point
rates, under current FPL scoring. No AI is involved.

The **starting XI is then solved exactly** — an optimisation over the nine legal
FPL formations, not a guess.

Only then does **Claude reason over those numbers**: which captain, what the
bench order should be, which risks matter, what trade-off this gameweek turns
on. It receives the projections and cannot invent statistics; where it overrides
the optimal lineup, it must cite something the model cannot see.

That ordering is deliberate. A language model asked to project points from xG
will produce confident and wrong numbers, which would undermine the only claim
this product makes.

## Setup

Requires Node 20+, a Supabase project, and an Anthropic API key.

```bash
npm install
cp .env.example .env.local   # then fill in the three values
```

Apply the database schema by pasting [supabase/schema.sql](supabase/schema.sql)
into the Supabase SQL editor. It creates `profiles`, `squads` and `analyses`,
enables row-level security on all three, and adds a trigger that creates a
profile row on signup.

```bash
npm run dev      # http://localhost:3000
```

## Using it

Sign up, then either:

- **Import by FPL ID** — the number in your points-page URL
  (`fantasy.premierleague.com/entry/1234567/event/1` → `1234567`).
- **Build manually** — search and pick 15 players against the standard quota
  (2 GKP, 5 DEF, 5 MID, 3 FWD) and £100m budget.

Manual entry is not just a fallback. FPL does not publish a manager's picks until
that gameweek's deadline has passed, so importing by ID cannot work for a squad
that is not yet locked in.

## Reading the output

Every projection carries a **data basis** and a **confidence** score, both shown
in the UI:

| Basis | Meaning |
|---|---|
| `current_season` | This season's numbers. Most reliable. |
| `last_season` | Pre-season, or too few games played. The numbers describe a role and squad that may have changed. |
| `price_prior` | No Premier League history at all. The projection is little more than an educated guess from price. |

Early in a season almost everything is `last_season` or `price_prior`. The app
shows this rather than hiding it, and the analyst is instructed to treat
low-confidence rows with visible caution.

## Development

```bash
npm run dry-run    # live FPL data -> projections -> the exact Claude prompt, without calling the API
npm run build && npm run lint && npm run typecheck
```

`dry-run` is the fastest way to check a change to the projection maths.

Model priors — fixture-difficulty multipliers, clean-sheet probabilities,
minutes priors for players with no history — are all in
[lib/projections/constants.ts](lib/projections/constants.ts), separated from the
FPL scoring rules, which are fact. Tune them there.

## Notes

Data comes from the public FPL API, which is undocumented and unofficial. There
is no live payment integration, and no affiliation with the Premier League.
