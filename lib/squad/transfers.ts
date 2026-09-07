/**
 * Ranking transfers over the horizon, not the week.
 *
 * The analyst used to receive a list of good available players and a list of
 * players it owned, and was left to work out which swap was worth making. That
 * is subtraction across fifteen players and two dozen targets, done by a model
 * that must not be trusted with arithmetic — and it quietly biased advice
 * toward the next fixture, because a single gameweek is the easiest column to
 * read.
 *
 * A transfer is a multi-week commitment. You get one a week, so a move that
 * wins two points on Saturday and loses six over the following month is a bad
 * move that looks good in isolation. Every candidate swap is therefore scored
 * across the whole horizon here, ranked, and handed over already decided —
 * leaving the analyst the judgement that is actually its job: whether the
 * numbers are trustworthy, and whether this is the week to act.
 */

import type { PlayerProjection } from "@/lib/projections/engine";
import { MAX_PER_CLUB } from "@/lib/types";
import type { SquadEconomics } from "./economics";

export interface TransferSide {
  playerId: number;
  name: string;
  position: string;
  team: string;
  /** Selling price for the outgoing player, purchase price for the incoming. */
  price: number;
  gwPoints: number;
  horizonPoints: number;
}

export interface TransferCandidate {
  out: TransferSide;
  in: TransferSide;
  /** Net expected points across the whole horizon, before any discount. */
  horizonGain: number;
  /**
   * The gain discounted by how much less the incoming projection is trusted.
   *
   * Ranking on the raw gain treats every point as equally real, and it is not:
   * a player with three matches behind him carries confidence 0.35 where an
   * established starter carries 0.79, and the thin one's number moves far more
   * on the next result. Selling a nailed defender for a marginal edge built on
   * two matches is the mistake this prevents — it only ever reduces a gain, and
   * leaves like-for-like swaps untouched.
   */
  adjustedGain: number;
  /** Net expected points in the immediate gameweek alone. */
  immediateGain: number;
  /**
   * Gain gameweek by gameweek. Makes the shape of a move visible: a gain that
   * arrives in four weeks is an argument for waiting, not for transferring now.
   */
  byGameweek: { gameweek: number; gain: number }[];
  /** Money left over once the move is made. */
  bankAfter: number;
}

/** Expected points a player contributes in one gameweek, doubles included. */
function pointsIn(p: PlayerProjection, gameweek: number): number {
  return p.perFixture
    .filter((f) => f.gameweek === gameweek)
    .reduce((sum, f) => sum + f.expectedPoints, 0);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every legal swap, ranked by what it earns across the horizon.
 *
 * Legal means all four FPL constraints hold at once: same position, funded by
 * the sale plus the bank, and no more than three from any club once the move is
 * done. Anything failing those is not a worse idea — it is not a transfer.
 */
export function rankTransfers(
  squad: PlayerProjection[],
  targets: PlayerProjection[],
  economics: SquadEconomics,
  gameweek: number,
  horizon: number,
  limit = 8,
): TransferCandidate[] {
  const gameweeks = Array.from({ length: horizon }, (_, i) => gameweek + i);
  const candidates: TransferCandidate[] = [];

  for (const incoming of targets) {
    for (const outgoing of squad) {
      if (outgoing.position !== incoming.position) continue;

      const sellPrice = economics.sellPrice[outgoing.playerId] ?? outgoing.cost;
      const bankAfter = economics.bank + sellPrice - incoming.cost;
      if (bankAfter < -0.001) continue;

      // The outgoing player frees a slot at his own club, so a same-club swap
      // is always fine even when that club is already at the limit.
      const held = economics.clubCounts[incoming.team] ?? 0;
      const heldAfterSale = held - (outgoing.team === incoming.team ? 1 : 0);
      if (heldAfterSale >= MAX_PER_CLUB) continue;

      const horizonGain = incoming.totalExpectedPoints - outgoing.totalExpectedPoints;
      if (horizonGain <= 0) continue;

      const trust = Math.min(
        1,
        incoming.confidence / Math.max(outgoing.confidence, 0.05),
      );
      const adjustedGain = horizonGain * trust;

      candidates.push({
        out: {
          playerId: outgoing.playerId,
          name: outgoing.webName,
          position: outgoing.position,
          team: outgoing.team,
          price: sellPrice,
          gwPoints: round2(outgoing.nextGameweekPoints),
          horizonPoints: round1(outgoing.totalExpectedPoints),
        },
        in: {
          playerId: incoming.playerId,
          name: incoming.webName,
          position: incoming.position,
          team: incoming.team,
          price: incoming.cost,
          gwPoints: round2(incoming.nextGameweekPoints),
          horizonPoints: round1(incoming.totalExpectedPoints),
        },
        horizonGain: round1(horizonGain),
        adjustedGain: round1(adjustedGain),
        immediateGain: round2(
          incoming.nextGameweekPoints - outgoing.nextGameweekPoints,
        ),
        byGameweek: gameweeks.map((gw) => ({
          gameweek: gw,
          gain: round2(pointsIn(incoming, gw) - pointsIn(outgoing, gw)),
        })),
        bankAfter: round1(bankAfter),
      });
    }
  }

  // Ranked on the discounted figure, so a confident, modest upgrade beats a
  // speculative one built on a handful of matches.
  candidates.sort((a, b) => b.adjustedGain - a.adjustedGain);

  // One outgoing player can headline only one suggestion, and so can one
  // incoming player. Without this the list is the same upgrade eight times
  // over, which reads as eight options and is really one decision.
  const seenOut = new Set<number>();
  const seenIn = new Set<number>();
  const ranked: TransferCandidate[] = [];
  for (const c of candidates) {
    if (seenOut.has(c.out.playerId) || seenIn.has(c.in.playerId)) continue;
    seenOut.add(c.out.playerId);
    seenIn.add(c.in.playerId);
    ranked.push(c);
    if (ranked.length >= limit) break;
  }
  return ranked;
}
