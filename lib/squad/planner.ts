/**
 * Planning several gameweeks at once, instead of picking the best move today.
 *
 * Transfers are not independent decisions. An unused free transfer banks, up to
 * five, so skipping this week buys a double move next week; and every transfer
 * is a commitment across the horizon, not a bet on Saturday. Choosing greedily
 * each week is therefore structurally weaker than planning the sequence, and
 * the gap is largest exactly where managers care: a small gain now against a
 * much larger one two weeks out.
 *
 * The reference implementations solve this as a mixed-integer program over the
 * whole horizon, with free transfers carried by a constraint of the shape
 *   A(t+1) <= A(t) - used(t) + 1
 * capped at five. That is the right formulation and it needs a real solver.
 *
 * This is a beam search over the same state, which is not optimal and is close
 * enough to be useful: at each gameweek it expands the candidate moves, scores
 * the resulting squads over the remaining horizon, and carries the best few
 * forward. Keeping a beam rather than the single best line is what lets it find
 * a plan whose first move is second-best this week.
 *
 * It is deliberately honest about being a search: the plan it returns is the
 * best it examined, not the best that exists.
 */

import type { PlayerProjection } from "@/lib/projections/engine";
import { MAX_BANKED_TRANSFERS, TRANSFER_HIT_COST } from "./chips";
import type { SquadEconomics } from "./economics";
import { optimiseSquad } from "./optimizer";
import type { TransferCandidate } from "./transfers";

export interface PlannedMove {
  gameweek: number;
  /** Null for a deliberate blank week, banking the transfer. */
  transfer: { outName: string; inName: string; outId: number; inId: number } | null;
  /** Free transfers in hand at the start of this gameweek. */
  freeTransfers: number;
  /** Points deducted this week, four per transfer beyond the free ones. */
  hitCost: number;
  /** Expected points from the best XI this squad can field this gameweek. */
  expectedPoints: number;
}

export interface TransferPlan {
  moves: PlannedMove[];
  /** Total expected points across the horizon, after hits. */
  totalPoints: number;
  /** The same squad left alone for the whole horizon, for comparison. */
  doNothingPoints: number;
  /** What the plan is worth over doing nothing. */
  gain: number;
}

/** Expected points a player contributes in one gameweek, doubles included. */
function pointsIn(p: PlayerProjection, gameweek: number): number {
  return p.perFixture
    .filter((f) => f.gameweek === gameweek)
    .reduce((sum, f) => sum + f.expectedPoints, 0);
}

/** Best XI this squad can field in one gameweek, as points. */
function weekPoints(squad: PlayerProjection[], gameweek: number): number {
  try {
    return optimiseSquad(squad, (p) => pointsIn(p, gameweek)).expectedPoints;
  } catch {
    // An unfieldable squad cannot arise from a legal swap, but a search that
    // throws is worse than one that scores a dead end at zero.
    return 0;
  }
}

interface State {
  squad: PlayerProjection[];
  bank: number;
  free: number;
  points: number;
  moves: PlannedMove[];
}

const BEAM_WIDTH = 6;
/** Candidate moves considered per gameweek. Beyond this the tail never wins. */
const BRANCHING = 5;

export function planTransfers(
  squad: PlayerProjection[],
  candidates: TransferCandidate[],
  /** Every projection by id, so a swap can build the resulting squad. */
  projections: Map<number, PlayerProjection>,
  economics: SquadEconomics,
  freeTransfers: number,
  gameweek: number,
  horizon: number,
): TransferPlan {
  const gameweeks = Array.from({ length: horizon }, (_, i) => gameweek + i);

  const doNothingPoints = gameweeks.reduce(
    (sum, gw) => sum + weekPoints(squad, gw),
    0,
  );

  let beam: State[] = [
    { squad, bank: economics.bank, free: freeTransfers, points: 0, moves: [] },
  ];

  for (const gw of gameweeks) {
    const next: State[] = [];

    for (const state of beam) {
      // Banking the transfer is always an option, and often the right one.
      next.push({
        ...state,
        free: Math.min(MAX_BANKED_TRANSFERS, state.free + 1),
        points: state.points + weekPoints(state.squad, gw),
        moves: [
          ...state.moves,
          {
            gameweek: gw,
            transfer: null,
            freeTransfers: state.free,
            hitCost: 0,
            expectedPoints: Math.round(weekPoints(state.squad, gw) * 10) / 10,
          },
        ],
      });

      const held = new Set(state.squad.map((p) => p.playerId));
      const usable = candidates
        .filter((c) => held.has(c.out.playerId) && !held.has(c.in.playerId))
        .slice(0, BRANCHING);

      for (const move of usable) {
        const sellPrice = economics.sellPrice[move.out.playerId] ?? move.out.price;
        const bank = state.bank + sellPrice - move.in.price;
        if (bank < -0.001) continue;

        const player = projections.get(move.in.playerId);
        if (!player) continue;

        const swapped = state.squad
          .filter((p) => p.playerId !== move.out.playerId)
          .concat(player);

        const hitCost = state.free > 0 ? 0 : TRANSFER_HIT_COST;
        const scored = weekPoints(swapped, gw);

        next.push({
          squad: swapped,
          bank,
          free: Math.min(MAX_BANKED_TRANSFERS, Math.max(0, state.free - 1) + 1),
          points: state.points + scored - hitCost,
          moves: [
            ...state.moves,
            {
              gameweek: gw,
              transfer: {
                outName: move.out.name,
                inName: move.in.name,
                outId: move.out.playerId,
                inId: move.in.playerId,
              },
              freeTransfers: state.free,
              hitCost,
              expectedPoints: Math.round(scored * 10) / 10,
            },
          ],
        });
      }
    }

    beam = next.sort((a, b) => b.points - a.points).slice(0, BEAM_WIDTH);
  }

  const best = beam[0];
  const round = (n: number) => Math.round(n * 10) / 10;

  return {
    moves: best?.moves ?? [],
    totalPoints: round(best?.points ?? doNothingPoints),
    doNothingPoints: round(doNothingPoints),
    gain: round((best?.points ?? doNothingPoints) - doNothingPoints),
  };
}
