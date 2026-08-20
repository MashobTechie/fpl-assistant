/**
 * Deterministic expected-points projection.
 *
 * Deliberately contains no AI. The LLM layer consumes this module's output and
 * reasons about it; it never invents the numbers. That split is what lets the
 * app defend a recommendation instead of asserting one.
 *
 * Every projection is E[points] under the FPL scoring rules, built from
 * per-90 rates scaled by expected minutes and fixture difficulty.
 */

import type {
  ElementTypeId,
  FplBootstrap,
  FplElement,
  FplFixture,
  FplTeam,
} from "@/lib/fpl/types";
import { POSITION_NAME } from "@/lib/fpl/types";
import * as K from "./constants";

export interface PointsBreakdown {
  appearance: number;
  goals: number;
  assists: number;
  cleanSheet: number;
  saves: number;
  defensiveContribution: number;
  bonus: number;
  goalsConceded: number;
}

export interface FixtureProjection {
  gameweek: number;
  opponent: string;
  isHome: boolean;
  difficulty: number;
  expectedMinutes: number;
  expectedPoints: number;
  breakdown: PointsBreakdown;
}

/** Where a player's underlying rates came from — drives confidence. */
export type DataBasis = "current_season" | "last_season" | "price_prior";

export interface PlayerProjection {
  playerId: number;
  webName: string;
  position: "GKP" | "DEF" | "MID" | "FWD";
  team: string;
  cost: number; // in £m
  status: string;
  news: string;
  dataBasis: DataBasis;
  /** 0–1. How much weight the reasoning layer should place on this row. */
  confidence: number;
  availability: number;
  expectedMinutes: number;
  perFixture: FixtureProjection[];
  /** Sum of expectedPoints across the horizon (handles blanks and doubles). */
  totalExpectedPoints: number;
  /** Expected points in the target gameweek alone. */
  nextGameweekPoints: number;
  pointsPerMillion: number;
  risks: string[];
  onPenalties: boolean;
}

export interface ProjectionContext {
  /** 0 during pre-season, which changes how season totals are interpreted. */
  completedGameweeks: number;
  teamsById: Map<number, FplTeam>;
  maxCostByPosition: Record<ElementTypeId, number>;
  fixturesByTeam: Map<number, FplFixture[]>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** P(X >= k) for X ~ Poisson(lambda). Used for defensive-contribution points. */
function poissonAtLeast(lambda: number, k: number): number {
  if (!Number.isFinite(k)) return 0;
  if (lambda <= 0) return 0;
  if (k <= 0) return 1;
  // Sum the lower tail term by term; k is small (10–12) so this is cheap.
  let term = Math.exp(-lambda);
  let cumulative = term;
  for (let i = 1; i < k; i++) {
    term = (term * lambda) / i;
    cumulative += term;
  }
  return clamp(1 - cumulative, 0, 1);
}

export function buildContext(
  bootstrap: FplBootstrap,
  fixtures: FplFixture[],
): ProjectionContext {
  const completedGameweeks = bootstrap.events.filter((e) => e.finished).length;

  const teamsById = new Map(bootstrap.teams.map((t) => [t.id, t]));

  const maxCostByPosition = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<
    ElementTypeId,
    number
  >;
  for (const el of bootstrap.elements) {
    if (el.now_cost > maxCostByPosition[el.element_type]) {
      maxCostByPosition[el.element_type] = el.now_cost;
    }
  }

  const fixturesByTeam = new Map<number, FplFixture[]>();
  for (const f of fixtures) {
    if (f.finished || f.event === null) continue;
    for (const teamId of [f.team_h, f.team_a]) {
      const list = fixturesByTeam.get(teamId) ?? [];
      list.push(f);
      fixturesByTeam.set(teamId, list);
    }
  }
  for (const list of fixturesByTeam.values()) {
    list.sort((a, b) => (a.event ?? 0) - (b.event ?? 0));
  }

  return { completedGameweeks, teamsById, maxCostByPosition, fixturesByTeam };
}

/**
 * How available a player is, as a 0–1 multiplier. An explicit FPL-published
 * chance of playing always beats the coarser status flag.
 */
function availabilityOf(player: FplElement): number {
  if (player.chance_of_playing_next_round !== null) {
    return clamp(player.chance_of_playing_next_round / 100, 0, 1);
  }
  return K.STATUS_AVAILABILITY[player.status] ?? 1;
}

/**
 * Expected minutes per match when fit, before the availability discount.
 *
 * Pre-season, season totals still hold LAST season's numbers, so they divide
 * by a full 38 games. Once the season is underway the same fields hold current
 * -season totals and must divide by games actually played — dividing a
 * three-gameweek total by 38 would make every player look like a bench warmer.
 */
function baseMinutesPerMatch(
  player: FplElement,
  ctx: ProjectionContext,
): { minutes: number; basis: DataBasis } {
  if (player.minutes > 0) {
    const games =
      ctx.completedGameweeks > 0 ? ctx.completedGameweeks : K.GAMES_IN_SEASON;
    const basis: DataBasis =
      ctx.completedGameweeks > 0 ? "current_season" : "last_season";
    return { minutes: clamp(player.minutes / games, 0, 90), basis };
  }

  // No league history: price is the only signal that the club rates them.
  const maxCost = ctx.maxCostByPosition[player.element_type] || player.now_cost;
  const ratio = clamp(player.now_cost / maxCost, 0, 1);
  const minutes =
    K.NO_HISTORY_MIN_MINUTES +
    (K.NO_HISTORY_MAX_MINUTES - K.NO_HISTORY_MIN_MINUTES) * Math.pow(ratio, 1.5);
  return { minutes, basis: "price_prior" };
}

/** Per-90 attacking rates, falling back to positional priors for new players. */
function attackingRates(player: FplElement, basis: DataBasis) {
  if (basis === "price_prior") {
    return {
      xg90: K.NO_HISTORY_XG90[player.element_type],
      xa90: K.NO_HISTORY_XA90[player.element_type],
    };
  }
  return {
    xg90: player.expected_goals_per_90 ?? 0,
    xa90: player.expected_assists_per_90 ?? 0,
  };
}

function projectFixture(
  player: FplElement,
  fixture: FplFixture,
  ctx: ProjectionContext,
  base: { minutes: number; basis: DataBasis },
  availability: number,
): FixtureProjection {
  const isHome = fixture.team_h === player.team;
  const opponentId = isHome ? fixture.team_a : fixture.team_h;
  const difficulty = isHome ? fixture.team_h_difficulty : fixture.team_a_difficulty;
  const pos = player.element_type;

  const attackMult =
    (K.FDR_ATTACK_MULTIPLIER[difficulty] ?? 1) *
    (isHome ? K.HOME_ATTACK_MULTIPLIER : K.AWAY_ATTACK_MULTIPLIER);
  const defenceMult = isHome
    ? K.HOME_DEFENCE_MULTIPLIER
    : K.AWAY_DEFENCE_MULTIPLIER;

  const expectedMinutes = base.minutes * availability;
  const minutesShare = expectedMinutes / 90;

  // Probability of appearing at all, and of reaching the 60-minute threshold.
  const pAppear = clamp(base.minutes / 25, 0, 0.98) * availability;
  const pSixty = clamp((base.minutes - 15) / 65, 0, 0.95) * availability;

  const { xg90, xa90 } = attackingRates(player, base.basis);

  const appearance =
    pAppear * K.POINTS_APPEARANCE_SHORT +
    pSixty * (K.POINTS_APPEARANCE_LONG - K.POINTS_APPEARANCE_SHORT);

  const goals = xg90 * minutesShare * attackMult * K.POINTS_PER_GOAL[pos];
  const assists = xa90 * minutesShare * attackMult * K.POINTS_PER_ASSIST;

  const cleanSheetProb = clamp(
    (K.FDR_CLEAN_SHEET_PROB[difficulty] ?? 0.25) * defenceMult,
    0,
    0.75,
  );
  const cleanSheet = pSixty * cleanSheetProb * K.POINTS_PER_CLEAN_SHEET[pos];

  const saves =
    pos === 1
      ? ((player.saves_per_90 ?? 0) * minutesShare) / K.SAVES_PER_POINT
      : 0;

  // Defensive contribution is a threshold, not a rate — needs a distribution.
  const defconLambda = (player.defensive_contribution_per_90 ?? 0) * minutesShare;
  const defensiveContribution =
    poissonAtLeast(defconLambda, K.DEFCON_THRESHOLD[pos]) *
    K.POINTS_DEFENSIVE_CONTRIBUTION;

  // Bonus is driven by the BPS system; last season's rate is the best proxy.
  const bonus90 =
    player.minutes > 0 ? (player.bonus / player.minutes) * 90 : 0;
  const bonus = bonus90 * minutesShare * attackMult;

  const expectedConceded =
    ((K.FDR_GOALS_CONCEDED[difficulty] ?? 1.35) / defenceMult) * minutesShare;
  const goalsConceded =
    pos === 1 || pos === 2
      ? -(expectedConceded / K.GOALS_CONCEDED_PER_MINUS_ONE)
      : 0;

  const breakdown: PointsBreakdown = {
    appearance,
    goals,
    assists,
    cleanSheet,
    saves,
    defensiveContribution,
    bonus,
    goalsConceded,
  };

  const expectedPoints = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const opponent = ctx.teamsById.get(opponentId)?.short_name ?? "???";

  return {
    gameweek: fixture.event ?? 0,
    opponent,
    isHome,
    difficulty,
    expectedMinutes,
    expectedPoints,
    breakdown,
  };
}

function assessConfidence(
  player: FplElement,
  base: { minutes: number; basis: DataBasis },
  ctx: ProjectionContext,
): number {
  let confidence: number;
  if (base.basis === "price_prior") {
    confidence = 0.25;
  } else if (player.minutes > 900) {
    confidence = 0.9;
  } else if (player.minutes > 270) {
    confidence = 0.65;
  } else {
    confidence = 0.4;
  }

  if (player.status !== "a") confidence *= 0.7;
  if (player.chance_of_playing_next_round !== null) confidence *= 0.8;
  // Pre-season rates describe a different team shape than the one about to play.
  if (ctx.completedGameweeks === 0) confidence *= 0.85;

  return clamp(confidence, 0.05, 0.95);
}

function assessRisks(
  player: FplElement,
  base: { minutes: number; basis: DataBasis },
  perFixture: FixtureProjection[],
  availability: number,
): string[] {
  const risks: string[] = [];

  if (player.status !== "a") {
    const label =
      { d: "Doubtful", i: "Injured", s: "Suspended", u: "Unavailable", n: "Not in squad" }[
        player.status
      ] ?? "Flagged";
    risks.push(player.news ? `${label}: ${player.news}` : label);
  } else if (availability < 1) {
    risks.push(`Only ${Math.round(availability * 100)}% chance of playing`);
  }

  if (base.basis === "price_prior") {
    risks.push("No Premier League history — projection is a price-based prior");
  }
  if (base.minutes < 60 && base.basis !== "price_prior") {
    risks.push(`Rotation risk — averaged ${Math.round(base.minutes)} min per match`);
  }
  if (perFixture.length === 0) {
    risks.push("Blank gameweek — no fixture scheduled");
  } else {
    const avgFdr =
      perFixture.reduce((sum, f) => sum + f.difficulty, 0) / perFixture.length;
    if (avgFdr >= 4) risks.push(`Difficult run — average FDR ${avgFdr.toFixed(1)}`);
  }

  return risks;
}

/** Project one player across the next `horizon` gameweeks from `fromGameweek`. */
export function projectPlayer(
  player: FplElement,
  ctx: ProjectionContext,
  fromGameweek: number,
  horizon: number,
): PlayerProjection {
  const base = baseMinutesPerMatch(player, ctx);
  const availability = availabilityOf(player);

  const upcoming = (ctx.fixturesByTeam.get(player.team) ?? []).filter(
    (f) =>
      f.event !== null &&
      f.event >= fromGameweek &&
      f.event < fromGameweek + horizon,
  );

  const perFixture = upcoming.map((f) =>
    projectFixture(player, f, ctx, base, availability),
  );

  const totalExpectedPoints = perFixture.reduce(
    (sum, f) => sum + f.expectedPoints,
    0,
  );
  const nextGameweekPoints = perFixture
    .filter((f) => f.gameweek === fromGameweek)
    .reduce((sum, f) => sum + f.expectedPoints, 0);

  const cost = player.now_cost / 10;
  const team = ctx.teamsById.get(player.team)?.short_name ?? "???";

  return {
    playerId: player.id,
    webName: player.web_name,
    position: POSITION_NAME[player.element_type],
    team,
    cost,
    status: player.status,
    news: player.news,
    dataBasis: base.basis,
    confidence: assessConfidence(player, base, ctx),
    availability,
    expectedMinutes: base.minutes * availability,
    perFixture,
    totalExpectedPoints,
    nextGameweekPoints,
    pointsPerMillion: cost > 0 ? totalExpectedPoints / cost : 0,
    risks: assessRisks(player, base, perFixture, availability),
    onPenalties: player.penalties_order === 1,
  };
}

export function projectMany(
  players: FplElement[],
  ctx: ProjectionContext,
  fromGameweek: number,
  horizon: number,
): PlayerProjection[] {
  return players.map((p) => projectPlayer(p, ctx, fromGameweek, horizon));
}
