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
import type { PastSeasonTotals } from "@/lib/fpl/history";
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
  /** Cards, own goals and penalty events. Negative for all but a saved penalty. */
  discipline: number;
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
/**
 * Where a player's rates come from.
 *
 * `blended` is the normal state for most of a season: some current-season
 * evidence, shrunk toward last season in proportion to how little there is.
 */
export type DataBasis =
  | "current_season"
  | "blended"
  | "last_season"
  | "price_prior";

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
  /**
   * Last season's totals by element code, used to shrink thin current-season
   * samples. Empty when the back-fill has not run, in which case the engine
   * behaves as it did before: current season alone, or a price prior.
   */
  lastSeasonByCode: Map<number, PastSeasonTotals>;
  /** 0 during pre-season, which changes how season totals are interpreted. */
  completedGameweeks: number;
  teamsById: Map<number, FplTeam>;
  maxCostByPosition: Record<ElementTypeId, number>;
  fixturesByTeam: Map<number, FplFixture[]>;
  /**
   * Per-player multiplier for competition at their club, 0-1. 1 means the
   * squad's projected minutes fit inside what a match actually offers; below 1
   * means the club is carrying more minutes than it can give out.
   */
  depthFactorByPlayer: Map<number, number>;
  /** Mean discipline points per 90, by position, for shrinking small samples. */
  disciplinePriorByPosition: Record<ElementTypeId, number>;
  /**
   * How a club's defence compares with the league, from expected goals
   * conceded. Below 1 concedes less than average.
   */
  teamDefenceByTeam: Map<number, number>;
  /** Expected bonus per 90 as a function of BPS per 90, fitted from the season. */
  bonusCurve: { bps90: number; bonus90: number }[];
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

/**
 * Share a club's available minutes among the players competing for them.
 *
 * Projecting each player from his own history alone lets a squad's minutes sum
 * to more than a match contains, which is how three strikers all end up
 * projected to start. This redistributes the excess.
 *
 * Not a flat scale-down: minutes are concentrated on the players whose history
 * already says they start, because signing a striker does not take equal
 * minutes from the first choice and the fourth. Demand is weighted by
 * availability, so an injured player stops consuming a share of the squeeze and
 * his team-mates' projections rise — which is the correct behaviour and falls
 * out of the same arithmetic.
 *
 * Returns a multiplier per player rather than a minutes figure, so the caller's
 * existing availability and status handling stays untouched.
 */
function allocateClubMinutes(
  squad: { id: number; rawMinutes: number; availability: number }[],
): Map<number, number> {
  const factors = new Map<number, number>();

  // Demand a fit squad would place on the match, discounted by availability.
  const effective = squad.map((p) => ({
    ...p,
    demand: p.rawMinutes * p.availability,
  }));
  const totalDemand = effective.reduce((sum, p) => sum + p.demand, 0);

  // A thin squad is left alone: there is no competition to model.
  if (totalDemand <= K.CLUB_MINUTES_PER_MATCH || totalDemand <= 0) {
    for (const p of squad) factors.set(p.id, 1);
    return factors;
  }

  // Water-filling: share the budget by concentrated weight, lock anyone who
  // would exceed a full match at 90, and re-share what is left.
  const locked = new Map<number, number>();
  const allocated = new Map<number, number>();

  for (let pass = 0; pass < 6; pass++) {
    const open = effective.filter((p) => !locked.has(p.id));
    const budget =
      K.CLUB_MINUTES_PER_MATCH -
      [...locked.values()].reduce((sum, m) => sum + m, 0);

    if (open.length === 0 || budget <= 0) break;

    const weights = open.map((p) => Math.pow(p.demand, K.DEPTH_CONCENTRATION));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    if (weightSum <= 0) break;

    let overflowed = false;
    open.forEach((p, i) => {
      const share = (budget * weights[i]) / weightSum;
      if (share > 90) {
        locked.set(p.id, 90);
        overflowed = true;
      } else {
        allocated.set(p.id, share);
      }
    });
    if (!overflowed) break;
  }

  for (const p of effective) {
    const minutes = locked.get(p.id) ?? allocated.get(p.id) ?? 0;
    // Below the threshold the player is unavailable anyway, and dividing by a
    // near-zero demand would produce a meaningless multiplier.
    factors.set(p.id, p.demand < 0.01 ? 1 : clamp(minutes / p.demand, 0, 1));
  }
  return factors;
}

/** Points a player's cards, own goals and penalty events cost over a period. */
function disciplinePoints(player: FplElement): number {
  return (
    player.yellow_cards * K.POINTS_YELLOW_CARD +
    player.red_cards * K.POINTS_RED_CARD +
    player.own_goals * K.POINTS_OWN_GOAL +
    player.penalties_missed * K.POINTS_PENALTY_MISS +
    player.penalties_saved * K.POINTS_PENALTY_SAVE
  );
}

/**
 * A player's discipline cost per 90, pulled toward the average for his
 * position in proportion to how little history supports it.
 *
 * Without the shrinkage a single red card in a short sample implies a rate
 * nobody sustains. With it, a full season of genuine offending survives intact
 * while ten matches of bad luck does not.
 */
function disciplinePer90(player: FplElement, ctx: ProjectionContext): number {
  const prior = ctx.disciplinePriorByPosition[player.element_type] ?? 0;
  const observed = disciplinePoints(player);
  const minutes = player.minutes;
  // Observed points, plus the prior weighted as if it were
  // DISCIPLINE_PRIOR_MINUTES of history, over the combined minutes.
  const priorPoints = prior * (K.DISCIPLINE_PRIOR_MINUTES / 90);
  const combinedNineties = (minutes + K.DISCIPLINE_PRIOR_MINUTES) / 90;
  return (observed + priorPoints) / combinedNineties;
}

/**
 * Expected count of FPL's minus-one deductions, which land every second goal
 * conceded: E[floor(X/2)] for X ~ Poisson(lambda), summed as P(X >= 2k).
 *
 * Halving lambda is the obvious shortcut and is wrong at the low end, where
 * most clean-sheet-relevant fixtures sit: at lambda 1.0 it claims 0.50
 * deductions against a true 0.26.
 */
function expectedDeductions(lambda: number): number {
  let total = 0;
  for (let k = 1; k <= 6; k++) total += poissonAtLeast(lambda, 2 * k);
  return total;
}

/**
 * Expected bonus per 90 for a given BPS per 90, read off a curve fitted to this
 * season's players.
 *
 * Realised bonus is the noisier estimate of the same thing: it is zero for most
 * players in most matches, so a small sample says more about luck than about
 * the player. BPS accrues every match and is the quantity bonus is actually
 * awarded from, so it carries the same signal with far less variance.
 */
function bonusFromBps(bps90: number, curve: ProjectionContext["bonusCurve"]): number {
  if (curve.length === 0) return 0;
  if (bps90 <= curve[0].bps90) return curve[0].bonus90;
  const last = curve[curve.length - 1];
  if (bps90 >= last.bps90) return last.bonus90;

  for (let i = 1; i < curve.length; i++) {
    const hi = curve[i];
    if (bps90 <= hi.bps90) {
      const lo = curve[i - 1];
      const span = hi.bps90 - lo.bps90;
      const t = span > 0 ? (bps90 - lo.bps90) / span : 0;
      return lo.bonus90 + t * (hi.bonus90 - lo.bonus90);
    }
  }
  return last.bonus90;
}

export function buildContext(
  bootstrap: FplBootstrap,
  fixtures: FplFixture[],
  /**
   * Last season by element code. Optional so the CLI scripts, which have no
   * database, keep working — they simply lose the shrinkage.
   */
  lastSeasonByCode: Map<number, PastSeasonTotals> = new Map(),
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

  // Positional discipline averages, from players with enough history to mean
  // something. Weighted by minutes so a full season counts for more than ten.
  const disciplinePriorByPosition = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<
    ElementTypeId,
    number
  >;
  for (const type of [1, 2, 3, 4] as ElementTypeId[]) {
    const cohort = bootstrap.elements.filter(
      (e) => e.element_type === type && e.minutes >= 450,
    );
    const minutes = cohort.reduce((sum, e) => sum + e.minutes, 0);
    disciplinePriorByPosition[type] =
      minutes > 0
        ? (cohort.reduce((sum, e) => sum + disciplinePoints(e), 0) / minutes) * 90
        : 0;
  }

  // How each club's defence compares with the league, from expected goals
  // conceded rather than actual — xGC is the same quantity with less noise.
  // Weighted by minutes, so the players who actually play define the average.
  const teamDefenceByTeam = new Map<number, number>();
  const teamXgc = new Map<number, number>();
  for (const t of bootstrap.teams) {
    const cohort = bootstrap.elements.filter(
      (e) => e.team === t.id && e.minutes >= K.TEAM_DEFENCE_MIN_MINUTES,
    );
    const minutes = cohort.reduce((sum, e) => sum + e.minutes, 0);
    if (minutes > 0) {
      teamXgc.set(
        t.id,
        cohort.reduce(
          (sum, e) => sum + (e.expected_goals_conceded_per_90 ?? 0) * e.minutes,
          0,
        ) / minutes,
      );
    }
  }
  const xgcValues = [...teamXgc.values()].filter((v) => v > 0);
  const leagueXgc =
    xgcValues.length > 0
      ? xgcValues.reduce((a, b) => a + b, 0) / xgcValues.length
      : 0;
  for (const t of bootstrap.teams) {
    const own = teamXgc.get(t.id);
    teamDefenceByTeam.set(
      t.id,
      own && leagueXgc > 0
        ? clamp(own / leagueXgc, K.TEAM_DEFENCE_MIN, K.TEAM_DEFENCE_MAX)
        : 1,
    );
  }

  // Expected bonus against BPS per 90, fitted from this season's players so it
  // tracks however BPS is actually converting into bonus.
  const bonusSamples = bootstrap.elements
    .filter((e) => e.minutes >= K.TEAM_DEFENCE_MIN_MINUTES)
    .map((e) => ({
      bps90: (e.bps / e.minutes) * 90,
      bonus90: (e.bonus / e.minutes) * 90,
    }))
    .sort((a, b) => a.bps90 - b.bps90);

  const bonusCurve: { bps90: number; bonus90: number }[] = [];
  if (bonusSamples.length >= K.BONUS_CURVE_BUCKETS) {
    const size = Math.floor(bonusSamples.length / K.BONUS_CURVE_BUCKETS);
    for (let i = 0; i < K.BONUS_CURVE_BUCKETS; i++) {
      const slice = bonusSamples.slice(
        i * size,
        i === K.BONUS_CURVE_BUCKETS - 1 ? bonusSamples.length : (i + 1) * size,
      );
      if (slice.length === 0) continue;
      bonusCurve.push({
        bps90: slice.reduce((s2, r) => s2 + r.bps90, 0) / slice.length,
        bonus90: slice.reduce((s2, r) => s2 + r.bonus90, 0) / slice.length,
      });
    }
  }

  // Depth needs the rest of the context to exist first: raw minutes depend on
  // maxCostByPosition for players with no league history.
  const partial: ProjectionContext = {
    lastSeasonByCode,
    completedGameweeks,
    teamsById,
    maxCostByPosition,
    fixturesByTeam,
    depthFactorByPlayer: new Map(),
    disciplinePriorByPosition,
    teamDefenceByTeam,
    bonusCurve,
  };

  const byTeam = new Map<number, FplElement[]>();
  for (const el of bootstrap.elements) {
    const list = byTeam.get(el.team) ?? [];
    list.push(el);
    byTeam.set(el.team, list);
  }

  const depthFactorByPlayer = new Map<number, number>();
  for (const squad of byTeam.values()) {
    const rows = squad.map((el) => ({
      id: el.id,
      rawMinutes: baseMinutesPerMatch(el, partial).minutes,
      availability: availabilityOf(el),
    }));
    for (const [id, factor] of allocateClubMinutes(rows)) {
      depthFactorByPlayer.set(id, factor);
    }
  }

  return {
    lastSeasonByCode,
    completedGameweeks,
    teamsById,
    maxCostByPosition,
    fixturesByTeam,
    depthFactorByPlayer,
    disciplinePriorByPosition,
    teamDefenceByTeam,
    bonusCurve,
  };
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
): { minutes: number; basis: DataBasis; weight: number } {
  const past = ctx.lastSeasonByCode.get(player.code);
  const pastMinutes = past && past.minutes > 0 ? past.minutes / K.GAMES_IN_SEASON : null;

  if (ctx.completedGameweeks === 0) {
    // Pre-season the bootstrap still carries last season's totals, or history
    // has been overlaid onto it, so a full 38 games is the right divisor.
    if (player.minutes > 0) {
      return {
        minutes: clamp(player.minutes / K.GAMES_IN_SEASON, 0, 90),
        basis: "last_season",
        weight: 0,
      };
    }
  } else if (player.minutes > 0 || pastMinutes !== null) {
    // Shrink this season toward last season by how much of it exists. One
    // match is evidence, but not thirty-eight matches' worth.
    const current = player.minutes / ctx.completedGameweeks;
    const weight = player.minutes / (player.minutes + K.PRIOR_MINUTES);

    const minutes =
      pastMinutes === null
        ? current
        : weight * current + (1 - weight) * pastMinutes;

    const basis: DataBasis =
      pastMinutes === null
        ? "current_season"
        : weight >= 0.5
          ? "current_season"
          : player.minutes === 0
            ? "last_season"
            : "blended";

    return { minutes: clamp(minutes, 0, 90), basis, weight };
  }

  // No league history: price is the only signal that the club rates them.
  const maxCost = ctx.maxCostByPosition[player.element_type] || player.now_cost;
  const ratio = clamp(player.now_cost / maxCost, 0, 1);
  const minutes =
    K.NO_HISTORY_MIN_MINUTES +
    (K.NO_HISTORY_MAX_MINUTES - K.NO_HISTORY_MIN_MINUTES) * Math.pow(ratio, 1.5);
  return { minutes, basis: "price_prior", weight: 0 };
}

/**
 * Per-90 attacking rates.
 *
 * Blended on the same weight as minutes, for the same reason: a rate computed
 * from ninety minutes is a rate computed from one shot count. Falls back to
 * positional priors only for players with no record at all.
 */
function attackingRates(
  player: FplElement,
  ctx: ProjectionContext,
  base: { basis: DataBasis; weight: number },
) {
  if (base.basis === "price_prior") {
    return {
      xg90: K.NO_HISTORY_XG90[player.element_type],
      xa90: K.NO_HISTORY_XA90[player.element_type],
    };
  }

  const current = {
    xg90: player.expected_goals_per_90 ?? 0,
    xa90: player.expected_assists_per_90 ?? 0,
  };

  const past = ctx.lastSeasonByCode.get(player.code);
  if (!past || past.minutes <= 0 || ctx.completedGameweeks === 0) return current;

  const w = base.weight;
  const per90 = (total: number) => (total / past.minutes) * 90;
  return {
    xg90: w * current.xg90 + (1 - w) * per90(past.expected_goals),
    xa90: w * current.xa90 + (1 - w) * per90(past.expected_assists),
  };
}

function projectFixture(
  player: FplElement,
  fixture: FplFixture,
  ctx: ProjectionContext,
  base: { minutes: number; basis: DataBasis; weight: number },
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

  const { xg90, xa90 } = attackingRates(player, ctx, base);

  const appearance =
    pAppear * K.POINTS_APPEARANCE_SHORT +
    pSixty * (K.POINTS_APPEARANCE_LONG - K.POINTS_APPEARANCE_SHORT);

  const goals = xg90 * minutesShare * attackMult * K.POINTS_PER_GOAL[pos];
  const assists = xa90 * minutesShare * attackMult * K.POINTS_PER_ASSIST;

  // One expected-goals-against figure now drives both the clean sheet and the
  // deductions, so the two can no longer disagree. It combines the fixture with
  // the club's own defensive record: identical opponents used to imply
  // identical clean-sheet odds for the best and worst defences in the league.
  const teamDefence = ctx.teamDefenceByTeam.get(player.team) ?? 1;
  const goalsAgainst =
    ((K.FDR_GOALS_CONCEDED[difficulty] ?? 1.35) * teamDefence) / defenceMult;

  // A clean sheet is simply no goals conceded.
  const cleanSheetProb = clamp(Math.exp(-goalsAgainst), 0, 0.75);
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

  // Bonus comes from BPS, so project it from BPS rather than from bonus itself.
  // Realised bonus is zero for most players in most matches, which makes a
  // short sample mostly luck; BPS accrues every match and carries the same
  // signal with far less variance.
  const bps90 = player.minutes > 0 ? (player.bps / player.minutes) * 90 : 0;
  const bonus90 = bonusFromBps(bps90, ctx.bonusCurve);
  // Only a fraction of the attacking multiplier: the goals that earn BPS are
  // already scaled by the fixture, so the full multiplier double-counted.
  const bonusFixture = 1 + (attackMult - 1) * K.BONUS_FIXTURE_SENSITIVITY;
  const bonus = bonus90 * minutesShare * bonusFixture;

  // FPL deducts a point every second goal conceded, which is E[floor(X/2)] —
  // not half the expected goals. Halving overstates it wherever clean sheets
  // are plausible, which is exactly where defenders are chosen.
  const goalsConceded =
    pos === 1 || pos === 2
      ? -expectedDeductions(goalsAgainst) * minutesShare
      : 0;

  // Cards, own goals and penalty events. Scaled by minutes for the same reason
  // everything else is: a player who plays half a match takes half the risk.
  const discipline = disciplinePer90(player, ctx) * minutesShare;

  const breakdown: PointsBreakdown = {
    appearance,
    goals,
    assists,
    cleanSheet,
    saves,
    defensiveContribution,
    bonus,
    goalsConceded,
    discipline,
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
  base: { minutes: number; basis: DataBasis; weight: number },
  ctx: ProjectionContext,
): number {
  // Confidence follows the evidence actually behind the projection, which
  // early in a season is mostly last season's. Bucketing on current-season
  // minutes alone put every player in the league at 0.40 after one gameweek,
  // including those with three thousand minutes of history feeding the blend.
  const past = ctx.lastSeasonByCode.get(player.code);
  const effectiveMinutes =
    player.minutes + (past?.minutes ?? 0) * K.PRIOR_CONFIDENCE_DISCOUNT;

  let confidence: number;
  if (base.basis === "price_prior") {
    confidence = 0.25;
  } else if (effectiveMinutes > 900) {
    confidence = 0.9;
  } else if (effectiveMinutes > 270) {
    confidence = 0.65;
  } else {
    confidence = 0.4;
  }

  if (player.status !== "a") confidence *= 0.7;
  if (player.chance_of_playing_next_round !== null) confidence *= 0.8;
  // Leaning on the prior costs confidence, in proportion to how far. At full
  // current-season weight this is a no-op; on last season alone it is the same
  // 0.85 that used to apply flatly through pre-season.
  confidence *= 0.85 + 0.15 * base.weight;

  return clamp(confidence, 0.05, 0.95);
}

function assessRisks(
  player: FplElement,
  base: { minutes: number; basis: DataBasis; weight: number },
  perFixture: FixtureProjection[],
  availability: number,
  depthFactor: number,
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
  // A squeeze the player's own history cannot show: the club has more minutes
  // committed than a match contains, so someone loses out.
  if (depthFactor < 0.85) {
    risks.push(
      `Competition for places — squad depth cuts projected minutes by ${Math.round(
        (1 - depthFactor) * 100,
      )}%`,
    );
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
  const raw = baseMinutesPerMatch(player, ctx);
  const availability = availabilityOf(player);

  // Competition for places. Applied to the minutes rather than to the points so
  // that everything downstream — appearance odds, the 60-minute threshold,
  // clean sheets, defensive contribution — moves with it consistently.
  const depthFactor = ctx.depthFactorByPlayer.get(player.id) ?? 1;
  const base = { ...raw, minutes: raw.minutes * depthFactor };

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
    risks: assessRisks(player, base, perFixture, availability, depthFactor),
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
