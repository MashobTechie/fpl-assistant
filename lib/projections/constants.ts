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

/** Baseline clean-sheet probability by FDR, before the home/away adjustment. */
export const FDR_CLEAN_SHEET_PROB: Record<number, number> = {
  1: 0.5,
  2: 0.4,
  3: 0.29,
  4: 0.19,
  5: 0.12,
};

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
