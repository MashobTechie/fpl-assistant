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
import type { OptimisedSquad } from "./optimizer";

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
export function valueChips(
  optimal: OptimisedSquad,
  squad: PlayerProjection[],
  gameweek: number,
  history: FplEntryHistory | null,
): ChipValuation[] {
  const used = new Set((history?.chips ?? []).map((c) => c.name as ChipName));

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
    },
    {
      chip: "3xc",
      label: CHIP_LABELS["3xc"],
      available: !used.has("3xc"),
      gain: Number(tripleGain.toFixed(1)),
      basis: best
        ? `One further multiple of ${best.webName}, who projects ${best.nextGameweekPoints.toFixed(1)}.`
        : "No starting XI to captain.",
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
