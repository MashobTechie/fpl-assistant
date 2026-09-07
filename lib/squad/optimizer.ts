/**
 * Exact starting-XI selection.
 *
 * Choosing the XI is a constrained optimisation, not a judgement call: given
 * expected points per player, exactly one lineup maximises the total under
 * FPL's formation rules. We solve it by enumeration (there are only nine legal
 * formations) rather than asking the LLM, which would have to be trusted to
 * respect the constraints. The reasoning layer explains and second-guesses
 * this lineup; it does not compute it.
 */

import {
  simulateFixture,
  summarise,
  type PointsDistribution,
} from "@/lib/projections/distribution";
import type { PlayerProjection } from "@/lib/projections/engine";
import * as K from "@/lib/projections/constants";
import { POSITION_ID } from "@/lib/fpl/types";

export interface Formation {
  defenders: number;
  midfielders: number;
  forwards: number;
}

/** Every legal FPL outfield split: 3–5 DEF, 2–5 MID, 1–3 FWD, ten outfielders. */
export function legalFormations(): Formation[] {
  const formations: Formation[] = [];
  for (let d = 3; d <= 5; d++) {
    for (let m = 2; m <= 5; m++) {
      const f = 10 - d - m;
      if (f >= 1 && f <= 3) formations.push({ defenders: d, midfielders: m, forwards: f });
    }
  }
  return formations;
}

export interface OptimisedSquad {
  startingXI: PlayerProjection[];
  bench: PlayerProjection[];
  /** Bench order matters: goalkeeper first, then outfielders by descending xPts. */
  formation: Formation;
  formationLabel: string;
  expectedPoints: number;
}

/**
 * Picks the highest expected-points XI from a 15-player squad.
 *
 * `scoreOf` selects which horizon to optimise for — the target gameweek for a
 * lineup decision, the multi-week total for a transfer decision.
 */
export function optimiseSquad(
  squad: PlayerProjection[],
  scoreOf: (p: PlayerProjection) => number = (p) => p.nextGameweekPoints,
): OptimisedSquad {
  const byScore = (a: PlayerProjection, b: PlayerProjection) => scoreOf(b) - scoreOf(a);

  const keepers = squad.filter((p) => p.position === "GKP").sort(byScore);
  const defenders = squad.filter((p) => p.position === "DEF").sort(byScore);
  const midfielders = squad.filter((p) => p.position === "MID").sort(byScore);
  const forwards = squad.filter((p) => p.position === "FWD").sort(byScore);

  if (keepers.length === 0) {
    throw new Error("Squad contains no goalkeeper — cannot build a legal XI");
  }

  let best: OptimisedSquad | null = null;

  for (const formation of legalFormations()) {
    if (
      defenders.length < formation.defenders ||
      midfielders.length < formation.midfielders ||
      forwards.length < formation.forwards
    ) {
      continue; // squad can't field this shape
    }

    const xi = [
      keepers[0],
      ...defenders.slice(0, formation.defenders),
      ...midfielders.slice(0, formation.midfielders),
      ...forwards.slice(0, formation.forwards),
    ];
    const expectedPoints = xi.reduce((sum, p) => sum + scoreOf(p), 0);

    if (!best || expectedPoints > best.expectedPoints) {
      const startingIds = new Set(xi.map((p) => p.playerId));
      const benchKeepers = keepers.slice(1);
      const benchOutfield = squad
        .filter((p) => !startingIds.has(p.playerId) && p.position !== "GKP")
        .sort(byScore);

      best = {
        startingXI: xi,
        bench: [...benchKeepers, ...benchOutfield],
        formation,
        formationLabel: `${formation.defenders}-${formation.midfielders}-${formation.forwards}`,
        expectedPoints,
      };
    }
  }

  if (!best) {
    throw new Error("Squad cannot field any legal formation");
  }
  return best;
}

/**
 * Captaincy shortlist, richest-first. Captaincy doubles a score, so the ranking
 * is just expected points — but ceiling and certainty are what separate close
 * calls, and those are the judgement the reasoning layer adds on top.
 */
export interface CaptaincyCandidate {
  player: PlayerProjection;
  distribution: PointsDistribution;
}

/**
 * Captaincy shortlist, ranked on the upper tail rather than the mean.
 *
 * The armband doubles one score, so it is a bet on a haul. A forward projected
 * 5.5 who returns 2 or 14 beats a midfielder projected 5.8 who returns 5 or 6
 * every week, and ranking on expected points says the opposite — which is the
 * one decision where a mean is actively the wrong statistic.
 *
 * Ranked on the ninetieth percentile with the mean as a tie-break, so a
 * genuinely higher projection still wins between players of similar shape.
 */
export function captaincyCandidates(
  startingXI: PlayerProjection[],
  gameweek: number,
  limit = 5,
): CaptaincyCandidate[] {
  return [...startingXI]
    .map((player) => {
      const type = POSITION_ID[player.position];
      const fixtures = player.perFixture.filter((f) => f.gameweek === gameweek);

      // A double gameweek is two independent matches, so the samples add.
      const samples = fixtures.flatMap((f, i) =>
        simulateFixture(
          f,
          K.POINTS_PER_GOAL[type],
          K.POINTS_PER_ASSIST,
          K.POINTS_PER_CLEAN_SHEET[type],
          player.playerId * 7919 + gameweek * 131 + i,
        ),
      );

      const distribution =
        samples.length > 0
          ? summarise(samples)
          : {
              mean: player.nextGameweekPoints,
              floor: 0,
              median: player.nextGameweekPoints,
              ceiling: player.nextGameweekPoints,
              pHaul: 0,
              pBlank: 1,
            };

      return { player, distribution };
    })
    .sort(
      (a, b) =>
        b.distribution.ceiling - a.distribution.ceiling ||
        b.distribution.mean - a.distribution.mean,
    )
    .slice(0, limit);
}
