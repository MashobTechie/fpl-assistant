/**
 * Chip and transfer economics.
 *
 * Chips are worth a fixed, computable number of points in any given gameweek —
 * a Bench Boost is exactly what the bench projects, a Triple Captain is exactly
 * one more multiple of the captain. That arithmetic belongs here, not in the
 * analyst, which then reasons about the only genuinely hard part: whether this
 * week is good enough to spend a chip you can never get back.
 *
 * The transfer side exists because advice that ignores the one-per-week limit
 * is advice nobody can follow. Three ranked suggestions with no acknowledgement
 * that two of them cost four points each is a list, not a plan.
 */

import type { PlayerProjection } from "@/lib/projections/engine";
import type { FplEntryHistory } from "@/lib/fpl/types";
import { optimiseSquad, type OptimisedSquad } from "./optimizer";

/** Points deducted for each transfer beyond the free allowance. */
export const TRANSFER_HIT_COST = 4;
/** FPL lets unused transfers accumulate, but only to this many. */
export const MAX_BANKED_TRANSFERS = 5;

export type ChipName = "bboost" | "3xc" | "freehit" | "wildcard";

export interface ChipValuation {
  chip: ChipName;
  label: string;
  available: boolean;
  /** Extra points this chip would earn *this* gameweek, where computable. */
  gain: number | null;
  /** What the number means, or why there isn't one. */
  basis: string;
  /**
   * The best gameweek to play it inside the horizon, and what it is worth
   * there. A chip is a timing decision above all else — telling a manager what
   * Bench Boost is worth this week, with no view of the next four, invites
   * them to burn it on an ordinary week.
   */
  bestGameweek: number | null;
  bestGain: number | null;
  /** Value in each gameweek of the horizon, so the shape is visible. */
  byGameweek: { gameweek: number; gain: number; doubles: number; blanks: number }[];
  /** Whether waiting beats playing it now, stated plainly. */
  timing: string;
}

export interface TransferBudget {
  /** Free transfers available this gameweek. */
  free: number;
  /** Whether the count is known or inferred from public history. */
  inferred: boolean;
  hitCost: number;
}

const CHIP_LABELS: Record<ChipName, string> = {
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
  freehit: "Free Hit",
  wildcard: "Wildcard",
};

/**
 * Which chips remain, and what each is worth this week.
 *
 * Bench Boost and Triple Captain have exact answers: the bench total, and one
 * further multiple of the best captain. Free Hit and Wildcard depend on a squad
 * the manager does not yet own, so they get a signal rather than a false
 * precision — how much of the squad blanks, and how much of it is unavailable.
 */
/** Expected points a player contributes in one gameweek, doubles included. */
function pointsIn(p: PlayerProjection, gameweek: number): number {
  return p.perFixture
    .filter((f) => f.gameweek === gameweek)
    .reduce((sum, f) => sum + f.expectedPoints, 0);
}

/**
 * Bench Boost and Triple Captain valued for one gameweek.
 *
 * The XI is re-solved for that gameweek rather than reusing this week's, since
 * the four players on the bench in five weeks' time are not the four on it now
 * — which is exactly what makes the chip worth more in some weeks than others.
 */
function valueInGameweek(
  squad: PlayerProjection[],
  gameweek: number,
): { bench: number; triple: number; doubles: number; blanks: number } {
  const xi = optimiseSquad(squad, (p) => pointsIn(p, gameweek));
  const bench = xi.bench.reduce((s, p) => s + pointsIn(p, gameweek), 0);
  const best = [...xi.startingXI].sort(
    (a, b) => pointsIn(b, gameweek) - pointsIn(a, gameweek),
  )[0];

  let doubles = 0;
  let blanks = 0;
  for (const p of squad) {
    const fixtures = p.perFixture.filter((f) => f.gameweek === gameweek).length;
    if (fixtures === 0) blanks++;
    else if (fixtures > 1) doubles++;
  }

  return {
    bench: Number(bench.toFixed(1)),
    triple: best ? Number(pointsIn(best, gameweek).toFixed(1)) : 0,
    doubles,
    blanks,
  };
}

export function valueChips(
  optimal: OptimisedSquad,
  squad: PlayerProjection[],
  gameweek: number,
  history: FplEntryHistory | null,
  horizon = 5,
): ChipValuation[] {
  const gameweeks = Array.from({ length: horizon }, (_, i) => gameweek + i);
  const weekly = gameweeks.map((gw) => ({ gw, ...valueInGameweek(squad, gw) }));

  const pickBest = (get: (w: (typeof weekly)[number]) => number) => {
    const best = [...weekly].sort((a, b) => get(b) - get(a))[0];
    return best ? { gameweek: best.gw, gain: get(best) } : null;
  };

  const bestBench = pickBest((w) => w.bench);
  const bestTriple = pickBest((w) => w.triple);

  /** Says plainly whether to hold, using the horizon rather than this week. */
  const timingFor = (
    now: number,
    best: { gameweek: number; gain: number } | null,
  ): string => {
    if (!best) return "No horizon data to compare against.";
    if (best.gameweek === gameweek) {
      return `This gameweek is the best in the next ${horizon}.`;
    }
    const margin = best.gain - now;
    return margin >= 1
      ? `GW${best.gameweek} is worth ${margin.toFixed(1)} more than this week — hold it.`
      : `GW${best.gameweek} is marginally better, but the gap is under a point.`;
  };

  const weeklyRows = weekly.map((w) => ({
    gameweek: w.gw,
    gain: w.bench,
    doubles: w.doubles,
    blanks: w.blanks,
  }));
  const used = new Set((history?.chips ?? []).map((c) => c.name as ChipName));
  const worstBlank = [...weekly].sort((a, b) => b.blanks - a.blanks)[0] ?? null;

  const benchGain = optimal.bench.reduce((s, p) => s + p.nextGameweekPoints, 0);

  const best = [...optimal.startingXI].sort(
    (a, b) => b.nextGameweekPoints - a.nextGameweekPoints,
  )[0];
  // The armband already doubles, so a Triple Captain adds one further multiple.
  const tripleGain = best ? best.nextGameweekPoints : 0;

  const blanking = squad.filter(
    (p) => !p.perFixture.some((f) => f.gameweek === gameweek),
  );
  const unavailable = squad.filter((p) => p.status !== "a");

  return [
    {
      chip: "bboost",
      label: CHIP_LABELS.bboost,
      available: !used.has("bboost"),
      gain: Number(benchGain.toFixed(1)),
      basis: `The four bench players project ${benchGain.toFixed(1)} between them.`,
      bestGameweek: bestBench?.gameweek ?? null,
      bestGain: bestBench?.gain ?? null,
      byGameweek: weeklyRows,
      timing: timingFor(Number(benchGain.toFixed(1)), bestBench),
    },
    {
      chip: "3xc",
      label: CHIP_LABELS["3xc"],
      available: !used.has("3xc"),
      gain: Number(tripleGain.toFixed(1)),
      basis: best
        ? `One further multiple of ${best.webName}, who projects ${best.nextGameweekPoints.toFixed(1)}.`
        : "No starting XI to captain.",
      bestGameweek: bestTriple?.gameweek ?? null,
      bestGain: bestTriple?.gain ?? null,
      byGameweek: weekly.map((w) => ({
        gameweek: w.gw,
        gain: w.triple,
        doubles: w.doubles,
        blanks: w.blanks,
      })),
      timing: timingFor(Number(tripleGain.toFixed(1)), bestTriple),
    },
    {
      chip: "freehit",
      label: CHIP_LABELS.freehit,
      available: !used.has("freehit"),
      // A Free Hit's value depends on a squad the manager does not own, so any
      // single figure would be invented. The trigger is stated instead.
      gain: null,
      basis:
        blanking.length > 0
          ? `${blanking.length} of the fifteen have no fixture this gameweek.`
          : "Every player has a fixture, so there is no blank to rescue.",
      bestGameweek: worstBlank && worstBlank.blanks > 0 ? worstBlank.gw : null,
      bestGain: null,
      byGameweek: weekly.map((w) => ({
        gameweek: w.gw,
        gain: 0,
        doubles: w.doubles,
        blanks: w.blanks,
      })),
      timing:
        worstBlank && worstBlank.blanks > 0
          ? `GW${worstBlank.gw} is the worst blank ahead — ${worstBlank.blanks} of the fifteen have no fixture.`
          : `No blanks in the next ${horizon} gameweeks, so nothing forces a Free Hit yet.`,
    },
    {
      chip: "wildcard",
      label: CHIP_LABELS.wildcard,
      available: !used.has("wildcard"),
      gain: null,
      basis:
        unavailable.length > 0
          ? `${unavailable.length} of the fifteen are flagged or unavailable.`
          : "The squad is fully available, so nothing forces a rebuild.",
      bestGameweek: null,
      bestGain: null,
      byGameweek: weekly.map((w) => ({
        gameweek: w.gw,
        gain: 0,
        doubles: w.doubles,
        blanks: w.blanks,
      })),
      timing:
        unavailable.length >= 4
          ? `${unavailable.length} players are unavailable — a rebuild is close to forced.`
          : "A Wildcard is worth holding until several transfers are needed at once.",
    },
  ];
}

/**
 * How many transfers this manager can make for free.
 *
 * FPL does not publish this on any endpoint reachable without the manager's own
 * login, so it is reconstructed from the public history: one free transfer per
 * gameweek, unused ones banked up to five, minus what was spent. Flagged as
 * inferred so the analyst never states it as fact.
 */
export function transferBudget(
  history: FplEntryHistory | null,
  gameweek: number,
): TransferBudget {
  if (!history || history.current.length === 0) {
    // Before a first deadline there is no limit at all; afterwards, one.
    return { free: gameweek <= 1 ? 15 : 1, inferred: true, hitCost: TRANSFER_HIT_COST };
  }

  let free = 1;
  for (const week of [...history.current].sort((a, b) => a.event - b.event)) {
    if (week.event >= gameweek) break;
    // A wildcard or free hit week does not consume the standing allowance.
    free = Math.min(MAX_BANKED_TRANSFERS, Math.max(0, free - week.event_transfers) + 1);
  }

  return { free, inferred: true, hitCost: TRANSFER_HIT_COST };
}
