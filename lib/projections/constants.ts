/**
 * FPL scoring rules and the tunable priors behind the projection model.
 *
 * The scoring block is fact — it mirrors the official rules (including the
 * defensive-contribution points introduced in 2025/26). Everything below it is
 * a prior: a defensible starting point, not a fitted parameter. They live here
 * so they can be tuned in one place once real results accumulate.
 */

import type { ElementTypeId } from "@/lib/fpl/types";

// ---------------------------------------------------------------- scoring

export const POINTS_PER_GOAL: Record<ElementTypeId, number> = {
  1: 6, // GKP
  2: 6, // DEF
  3: 5, // MID
  4: 4, // FWD
};

export const POINTS_PER_CLEAN_SHEET: Record<ElementTypeId, number> = {
  1: 4,
  2: 4,
  3: 1,
  4: 0,
};

export const POINTS_PER_ASSIST = 3;
export const POINTS_APPEARANCE_SHORT = 1; // 1–59 minutes
export const POINTS_APPEARANCE_LONG = 2; // 60+ minutes
export const SAVES_PER_POINT = 3; // GKP only
export const GOALS_CONCEDED_PER_MINUS_ONE = 2; // GKP/DEF only
export const POINTS_DEFENSIVE_CONTRIBUTION = 2;

/**
 * Defensive-contribution thresholds per match. Defenders count clearances,
 * blocks, interceptions and tackles; midfielders and forwards also count ball
 * recoveries, against a higher bar.
 */
export const DEFCON_THRESHOLD: Record<ElementTypeId, number> = {
  1: Infinity, // keepers cannot score it
  2: 10,
  3: 12,
  4: 12,
};

// ----------------------------------------------------------------- priors

/**
 * How much a fixture's difficulty scales a team's attacking output.
 * Indexed by FDR 1 (easiest) to 5 (hardest).
 */
export const FDR_ATTACK_MULTIPLIER: Record<number, number> = {
  1: 1.3,
  2: 1.15,
  3: 1.0,
  4: 0.87,
  5: 0.75,
};

// FDR_CLEAN_SHEET_PROB was removed. Clean-sheet probability is now derived from
// the same expected-goals-against figure as the deductions, as exp(-lambda), so
// the two cannot drift apart. A second independent lookup would have been a
// tunable that silently contradicted the first.

/** Expected goals conceded by FDR, before the home/away adjustment. */
export const FDR_GOALS_CONCEDED: Record<number, number> = {
  1: 0.85,
  2: 1.05,
  3: 1.35,
  4: 1.65,
  5: 1.95,
};

export const HOME_ATTACK_MULTIPLIER = 1.08;
export const AWAY_ATTACK_MULTIPLIER = 0.94;
export const HOME_DEFENCE_MULTIPLIER = 1.12; // applied to clean-sheet odds
export const AWAY_DEFENCE_MULTIPLIER = 0.9;

/**
 * Availability multiplier on expected minutes, by FPL status flag. Where FPL
 * publishes an explicit `chance_of_playing_next_round`, that wins over these.
 */
export const STATUS_AVAILABILITY: Record<string, number> = {
  a: 1.0, // available
  d: 0.5, // doubtful
  i: 0.0, // injured
  s: 0.0, // suspended
  u: 0.0, // unavailable
  n: 0.0, // not in squad
};

/**
 * Minutes prior for players with no league history (new signings, promoted
 * clubs). Price is the only real signal available: clubs do not spend on
 * players they intend to bench. Interpolates between these bounds on a
 * position-relative price ratio.
 */
export const NO_HISTORY_MIN_MINUTES = 18;
export const NO_HISTORY_MAX_MINUTES = 80;

/** Per-90 attacking priors for players with no history, by position. */
export const NO_HISTORY_XG90: Record<ElementTypeId, number> = {
  1: 0.0,
  2: 0.05,
  3: 0.16,
  4: 0.35,
};
export const NO_HISTORY_XA90: Record<ElementTypeId, number> = {
  1: 0.0,
  2: 0.07,
  3: 0.17,
  4: 0.13,
};

/** A full Premier League season, used to average pre-season totals. */
export const GAMES_IN_SEASON = 38;

// ------------------------------------------------------- competition for places

/**
 * Minutes a club actually has to give out in one match: eleven shirts, ninety
 * minutes each.
 *
 * This is a hard physical fact, and the projection engine was ignoring it.
 * Every player was projected from his own history alone, so a squad's minutes
 * summed to more than exist — measured against real 2025/26 data, Manchester
 * City's current squad played 41,244 minutes last season against the 37,620 a
 * season contains, and Chelsea's 42,266. Without this constraint three
 * strikers can each be projected to start.
 */
export const CLUB_MINUTES_PER_MATCH = 11 * 90;

/**
 * How sharply a squeezed squad concentrates its minutes on the likely starters.
 *
 * 1.0 would scale every player at a club by the same factor, which is wrong:
 * signing a striker does not take equal minutes from the first choice and the
 * fourth. Above 1.0 the established starter keeps most of his, and the fringe
 * player absorbs the squeeze. 1.6 is a prior, not a fitted value — tune it here
 * once real minutes accumulate.
 */
export const DEPTH_CONCENTRATION = 1.6;

// ---------------------------------------------------- discipline and penalties

/**
 * Scoring events the engine previously ignored entirely.
 *
 * These are FPL rules, not priors — the same fact status as goals and clean
 * sheets. Leaving them out over-projected every player, because discipline is
 * almost always a cost: measured across 267 players with 900+ minutes in
 * 2025/26, the mean effect is -0.19 points per 90, and the spread between the
 * worst offender and the best-rewarded keeper is 41.8 points over a season.
 */
export const POINTS_YELLOW_CARD = -1;
export const POINTS_RED_CARD = -3;
export const POINTS_OWN_GOAL = -2;
export const POINTS_PENALTY_MISS = -2;
export const POINTS_PENALTY_SAVE = 5; // goalkeepers only

/**
 * Minutes of pseudo-history used to pull a player's discipline rate toward the
 * average for his position.
 *
 * Red cards are rare and expensive, so a single one in a short sample implies a
 * rate no player sustains — one red in 900 minutes reads as -0.3 per 90 from
 * that card alone. Shrinking toward the positional mean keeps a genuine
 * offender like Romero (-0.72 per 90 across a full season) while stopping a
 * small sample from inventing one.
 */
export const DISCIPLINE_PRIOR_MINUTES = 900;

// ------------------------------------------------------------ team defence

/**
 * Bounds on how far a club's own defensive record may move a fixture's
 * expected goals against.
 *
 * Fixture difficulty alone treats every defence as average, so Arsenal and a
 * promoted side were given identical clean-sheet odds against the same
 * opponent. The club's expected goals conceded per 90 fixes that, but it is a
 * season-long average being applied to one match, so it is clamped rather than
 * trusted outright.
 */
export const TEAM_DEFENCE_MIN = 0.65;
export const TEAM_DEFENCE_MAX = 1.45;

/** Minimum minutes before a player's xGC counts toward his club's average. */
export const TEAM_DEFENCE_MIN_MINUTES = 450;

// -------------------------------------------------------------------- bonus

/**
 * How much fixture difficulty moves expected bonus.
 *
 * Bonus was being multiplied by the full attacking multiplier, which
 * double-counted: the goals that earn BPS are already scaled by the fixture.
 * An easy fixture does still raise bonus, through more shots, saves and
 * defensive actions, so the effect is kept at a fraction of the attacking one.
 */
export const BONUS_FIXTURE_SENSITIVITY = 0.4;

/** Buckets used to fit expected bonus against BPS per 90. */
export const BONUS_CURVE_BUCKETS = 12;

// ------------------------------------------------------------ engine version

/**
 * Bump whenever a change to this file or the engine moves the numbers.
 *
 * A stored analysis reasons about the projections it was given. Keying the
 * cache on the squad alone meant an engine change left every analysis
 * describing figures the app no longer produces, with nothing to notice it —
 * the squad had not changed, so the cache stayed warm and confidently wrong.
 *
 * History:
 *   1  first version
 *   2  club minutes constraint, discipline, team defence, BPS-based bonus
 */
export const PROJECTION_ENGINE_VERSION = "2";

/**
 * How much current-season evidence it takes to half-outweigh last season.
 *
 * A player's rate this season is blended against last season's with weight
 * `minutes / (minutes + PRIOR_MINUTES)`. At 900 minutes — ten full matches —
 * the two carry equal weight; after one match this season counts for about 9%.
 *
 * The alternative, switching outright the moment a gameweek finishes, throws
 * away thirty-eight matches to rely on one. Measured on 2026-08-28, one
 * gameweek into the season, that put 306 of 616 players on a price prior
 * purely for missing the opening fixture — Saliba and Timber projected at
 * 0.00 xPts despite full seasons behind them — and let a single game set
 * everyone's scoring rate.
 */
export const PRIOR_MINUTES = 900;

/**
 * How much last season's minutes count toward confidence.
 *
 * Real evidence, but it describes a squad, role and manager that may have
 * changed over a summer — so the same minutes are worth less than minutes
 * played this season.
 */
export const PRIOR_CONFIDENCE_DISCOUNT = 0.5;
