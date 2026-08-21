/**
 * Carrying last season forward when FPL zeroes the current one.
 *
 * At the first deadline of a season FPL resets every per-player total to zero.
 * Measured on 2026-08-21: within an hour of the GW1 lock, all 600 players read
 * 0 minutes, 0 BPS, 0 xG and 0 cards.
 *
 * The projection engine reads exactly those fields, so the reset silently
 * demoted every player to the price-based prior — Haaland and a £4.5m reserve
 * projected from the same positional guess with the same 0.21 confidence, and
 * the depth, discipline, team-defence and bonus models all went inert because
 * their inputs were zero. Nothing errored. The numbers just stopped meaning
 * anything, which is the worst failure this product can have.
 *
 * The fix restores the situation that held all pre-season: the bootstrap
 * carries last season's totals. Overlaying here rather than inside the engine
 * means every downstream model keeps working unchanged, and the data basis a
 * player reports stays honest — `last_season` is exactly what these are.
 */

import type { FplBootstrap, FplElement } from "./types";

/** Per-90 rates are derived, since history_past stores season totals only. */
const per90 = (total: number, minutes: number) =>
  minutes > 0 ? (total / minutes) * 90 : 0;

const num = (v: number | string | null | undefined): number => {
  if (typeof v === "number") return v;
  const parsed = Number.parseFloat(String(v ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};

export interface PastSeasonTotals {
  minutes: number;
  starts: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  bps: number;
  defensive_contribution: number;
  expected_goals: number;
  expected_assists: number;
  expected_goals_conceded: number;
  total_points: number;
}

/**
 * Whether the live payload has been zeroed.
 *
 * Deliberately a whole-league check rather than per player: an individual with
 * no minutes is ordinary — a new signing, an injury — while every player in the
 * game reading zero can only be the season rollover.
 */
export function seasonTotalsAreEmpty(bootstrap: FplBootstrap): boolean {
  return bootstrap.elements.every((e) => (e.minutes ?? 0) === 0);
}

/**
 * Overlay last season's totals onto a zeroed bootstrap.
 *
 * Players with no history are left untouched, so they keep falling through to
 * the price prior — which is the correct treatment for someone who has never
 * played in the league.
 */
export function applyLastSeason(
  bootstrap: FplBootstrap,
  historyByCode: Map<number, PastSeasonTotals>,
): { bootstrap: FplBootstrap; restored: number } {
  let restored = 0;

  const elements = bootstrap.elements.map((el): FplElement => {
    const past = historyByCode.get(el.code);
    if (!past || past.minutes <= 0) return el;
    restored++;

    const m = past.minutes;
    return {
      ...el,
      minutes: m,
      starts: past.starts,
      goals_scored: past.goals_scored,
      assists: past.assists,
      clean_sheets: past.clean_sheets,
      own_goals: past.own_goals,
      penalties_saved: past.penalties_saved,
      penalties_missed: past.penalties_missed,
      yellow_cards: past.yellow_cards,
      red_cards: past.red_cards,
      saves: past.saves,
      bonus: past.bonus,
      bps: past.bps,
      defensive_contribution: past.defensive_contribution,
      total_points: past.total_points,
      expected_goals: String(past.expected_goals),
      expected_assists: String(past.expected_assists),
      // history_past stores totals, so the rates the engine reads are derived.
      expected_goals_per_90: per90(past.expected_goals, m),
      expected_assists_per_90: per90(past.expected_assists, m),
      expected_goals_conceded_per_90: per90(past.expected_goals_conceded, m),
      saves_per_90: per90(past.saves, m),
      starts_per_90: per90(past.starts, m),
      defensive_contribution_per_90: per90(past.defensive_contribution, m),
    };
  });

  return { bootstrap: { ...bootstrap, elements }, restored };
}

/** Normalise one `history_past` entry, whose numerics arrive as strings. */
export function toTotals(raw: Record<string, unknown>): PastSeasonTotals {
  const n = (k: string) => num(raw[k] as number | string);
  return {
    minutes: n("minutes"),
    starts: n("starts"),
    goals_scored: n("goals_scored"),
    assists: n("assists"),
    clean_sheets: n("clean_sheets"),
    goals_conceded: n("goals_conceded"),
    own_goals: n("own_goals"),
    penalties_saved: n("penalties_saved"),
    penalties_missed: n("penalties_missed"),
    yellow_cards: n("yellow_cards"),
    red_cards: n("red_cards"),
    saves: n("saves"),
    bonus: n("bonus"),
    bps: n("bps"),
    defensive_contribution: n("defensive_contribution"),
    expected_goals: n("expected_goals"),
    expected_assists: n("expected_assists"),
    expected_goals_conceded: n("expected_goals_conceded"),
    total_points: n("total_points"),
  };
}
