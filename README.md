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
into the Supabase SQL editor. It creates `profiles`, `squads`, `analyses` and
`drafts`, enables row-level security on all of them, and adds a trigger that
creates a profile row on signup.

```bash
npm run dev      # http://localhost:3000
```

Working locally against the Supabase CLI instead:

```bash
npx supabase start    # applies supabase/migrations/ to a local stack
npm run dev
npm run smoke         # drives the real routes, signed in, and cleans up after
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

Then try transfers before making them. Tap a shirt to sell, pick who comes in,
and the answer covers both questions: whether FPL would let you make the move,
priced from your real selling prices and bank, and whether it is worth it —
what it gains over the horizon, what any hit costs, and how often it actually
pays off rather than only how much it gains on average. Declare a Wildcard or
Free Hit and the limit is suspended; a Free Hit is judged on its one gameweek,
because that is how long you keep the squad. Drafts can be saved under a name,
which is how you hold two side by side, and an unsaved one survives a reload.
Nothing is ever sent to FPL — you still make the moves there yourself.

## Reading the output

The screen leads with the call: what to do before the deadline, in at most three
sentences and no jargon, with the one button that acts on it. Above it a bar
follows the page down with the gameweek, a live countdown and the running
totals. Everything else — the lineup, captaincy, transfers, chips, last week and
the analyst's full read — sits behind a tab rail underneath, one panel at a
time, so the decision never competes with the evidence for it.

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
npm test           # the maths and the transfer rules
npm run smoke      # the real HTTP routes against local Supabase (needs npm run dev)
npm run build && npm run lint && npm run typecheck
```

`dry-run` is the fastest way to check a change to the projection maths, and
`smoke` the fastest way to check anything that touches the database. Neither
spends an API call.

Model priors — fixture-difficulty multipliers, clean-sheet probabilities,
minutes priors for players with no history — are all in
[lib/projections/constants.ts](lib/projections/constants.ts), separated from the
FPL scoring rules, which are fact. Tune them there.

## Notes

Data comes from the public FPL API, which is undocumented and unofficial. There
is no live payment integration, and no affiliation with the Premier League.
