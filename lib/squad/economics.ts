/**
 * What a manager can actually afford.
 *
 * Transfer advice that ignores money is not advice. The analyst was previously
 * handed a list of the best available players with no budget attached — for a
 * manually built squad it received no bank figure at all — so nothing stopped
 * it recommending a £15.5m striker to someone with £0.2m spare.
 *
 * Affordability is arithmetic, so it is settled here rather than in the prompt,
 * for the same reason expected points are: a model asked to do sums will
 * produce confident ones that do not add up. The analyst receives the list of
 * moves that are already possible and reasons about which is best.
 */

import type { PlayerProjection } from "@/lib/projections/engine";
import { MAX_PER_CLUB, SQUAD_BUDGET } from "@/lib/types";

export interface SquadEconomics {
  /** Cash in hand, £m. */
  bank: number;
  /** Total value of the fifteen at selling prices, £m. */
  squadValue: number;
  /** What each squad player would raise if sold, £m, keyed by player id. */
  sellPrice: Record<number, number>;
  /** How many of the fifteen come from each club, keyed by short name. */
  clubCounts: Record<string, number>;
}

export interface FundedTarget {
  player: PlayerProjection;
  /**
   * Squad players who could be sold to fund this move: same position, and
   * their selling price plus the bank covers the incoming fee.
   */
  fundedBy: { playerId: number; name: string; sellPrice: number }[];
  /** True when the squad already holds the maximum from this player's club. */
  clubFull: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Build the money picture for a squad.
 *
 * `sellPrices` comes from FPL for an imported squad, where a player who has
 * risen sells for less than the market price. A manually built squad is priced
 * at today's cost, because that is what it would cost to assemble now, and its
 * bank is whatever the £100m budget leaves over.
 */
export function buildEconomics(
  squad: PlayerProjection[],
  opts: { bank: number | null; sellPrices?: Record<number, number> },
): SquadEconomics {
  const sellPrice: Record<number, number> = {};
  for (const p of squad) {
    sellPrice[p.playerId] = round1(opts.sellPrices?.[p.playerId] ?? p.cost);
  }

  const squadValue = round1(
    squad.reduce((sum, p) => sum + sellPrice[p.playerId], 0),
  );

  const clubCounts: Record<string, number> = {};
  for (const p of squad) clubCounts[p.team] = (clubCounts[p.team] ?? 0) + 1;

  // A manual squad has no FPL bank to read, so what the budget leaves is the
  // only honest answer. Never negative: an over-budget squad cannot exist,
  // because validation rejects it before this runs.
  const bank =
    opts.bank !== null ? round1(opts.bank) : Math.max(0, round1(SQUAD_BUDGET - squadValue));

  return { bank, squadValue, sellPrice, clubCounts };
}

/**
 * Keep only the transfer targets this manager could actually buy.
 *
 * FPL transfers are like-for-like by position — the squad must stay at 2/5/5/3
 * — so a target is reachable only if some squad player in the same position
 * sells for enough, once the bank is added.
 */
export function fundableTargets(
  targets: PlayerProjection[],
  squad: PlayerProjection[],
  economics: SquadEconomics,
): { affordable: FundedTarget[]; unaffordable: number } {
  const affordable: FundedTarget[] = [];
  let unaffordable = 0;

  for (const target of targets) {
    const fundedBy = squad
      .filter((s) => s.position === target.position)
      .map((s) => ({
        playerId: s.playerId,
        name: s.webName,
        sellPrice: economics.sellPrice[s.playerId],
      }))
      .filter((s) => s.sellPrice + economics.bank >= target.cost)
      .sort((a, b) => a.sellPrice - b.sellPrice);

    if (fundedBy.length === 0) {
      unaffordable++;
      continue;
    }

    affordable.push({
      player: target,
      // The cheapest few sales that work. A manager funding a move gives up the
      // least they can, so the expensive options are noise.
      fundedBy: fundedBy.slice(0, 3),
      clubFull: (economics.clubCounts[target.team] ?? 0) >= MAX_PER_CLUB,
    });
  }

  return { affordable, unaffordable };
}
