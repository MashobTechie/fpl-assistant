/**
 * Server-side squad legality.
 *
 * The picker enforces these rules too, but that enforcement is cosmetic: it
 * runs in the browser, so anyone posting to /api/analysis directly bypasses it
 * entirely. Before this module existed a request could carry fifteen £15m
 * forwards, fifteen Arsenal players, or the same player three times, and the
 * engine would project it and the analyst would write it up.
 *
 * That last case is the reason this is a correctness problem and not just a
 * validation gap. An obviously fake squad produces an obviously fake number.
 * A squad with one player duplicated produces a *plausible* number — the
 * duplicate is counted twice in the optimal XI — and the product's entire
 * claim is that its numbers can be trusted.
 */

import { createHash } from "node:crypto";

import type { PlayerProjection } from "@/lib/projections/engine";
import {
  MAX_PER_CLUB,
  SQUAD_BUDGET,
  SQUAD_QUOTA,
  SQUAD_SIZE,
  type PlayerListItem,
} from "@/lib/types";

type Position = PlayerListItem["position"];
const POSITIONS: Position[] = ["GKP", "DEF", "MID", "FWD"];

/**
 * Checks that can be made from the ids alone, before any FPL lookup — so a
 * malformed request is rejected without touching the network.
 */
export function validateSquadIds(ids: number[]): string[] {
  const problems: string[] = [];

  if (ids.length !== SQUAD_SIZE) {
    problems.push(
      `A squad must contain exactly ${SQUAD_SIZE} players; received ${ids.length}.`,
    );
  }

  const seen = new Set<number>();
  const duplicated = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) duplicated.add(id);
    seen.add(id);
  }
  if (duplicated.size > 0) {
    problems.push(
      `A squad cannot contain the same player twice (repeated id ${[...duplicated].join(", ")}).`,
    );
  }

  return problems;
}

export interface CompositionOptions {
  /**
   * Whether the £100.0m ceiling applies.
   *
   * True for a manually built squad, which represents buying at today's
   * prices. False for a squad imported from FPL: a real squad rises above
   * £100m as its players do, and rejecting that would turn a manager's success
   * into an error message.
   */
  enforceBudget: boolean;
}

/** Rules that need the resolved players: positions, clubs, and price. */
export function validateSquadComposition(
  squad: PlayerProjection[],
  { enforceBudget }: CompositionOptions,
): string[] {
  const problems: string[] = [];

  const byPosition: Record<Position, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  const byClub = new Map<string, number>();
  let cost = 0;

  for (const p of squad) {
    byPosition[p.position]++;
    byClub.set(p.team, (byClub.get(p.team) ?? 0) + 1);
    cost += p.cost;
  }

  for (const position of POSITIONS) {
    const want = SQUAD_QUOTA[position];
    const got = byPosition[position];
    if (got !== want) {
      problems.push(`A squad needs exactly ${want} ${position}; received ${got}.`);
    }
  }

  const overloaded = [...byClub.entries()]
    .filter(([, n]) => n > MAX_PER_CLUB)
    .sort((a, b) => b[1] - a[1]);
  for (const [club, n] of overloaded) {
    problems.push(
      `At most ${MAX_PER_CLUB} players may come from one club; this squad has ${n} from ${club}.`,
    );
  }

  // Float arithmetic on tenths-of-a-million: round before comparing, or a
  // squad costing exactly £100.0m can fail on a 1e-13 remainder.
  if (enforceBudget && Math.round(cost * 10) > Math.round(SQUAD_BUDGET * 10)) {
    problems.push(
      `A squad must cost at most £${SQUAD_BUDGET.toFixed(1)}m; this one costs £${cost.toFixed(1)}m.`,
    );
  }

  return problems;
}

/** Total cost at today's prices, in £m, rounded to FPL's tenth-of-a-million. */
export function squadCost(squad: PlayerProjection[]): number {
  return Math.round(squad.reduce((sum, p) => sum + p.cost, 0) * 10) / 10;
}

/**
 * Stable fingerprint of a set of picks, used as the analysis cache key.
 *
 * Order-independent: reordering the same fifteen players is the same squad and
 * must reuse the cached analysis rather than pay for an identical one.
 */
export function squadHash(playerIds: number[]): string {
  return createHash("sha256")
    .update([...playerIds].sort((a, b) => a - b).join(","))
    .digest("hex")
    .slice(0, 32);
}
