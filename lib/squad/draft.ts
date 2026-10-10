/**
 * Trying transfers before making them.
 *
 * A manager wants to ask "what if I sold him for him?" and get two honest
 * answers: could I actually make this move in FPL, and would it be worth it.
 *
 * Both answers have to come from the manager's real position, not a fresh
 * £100m squad. FPL sells a player for his selling price — half of any rise
 * since purchase, rounded down — and funds purchases from the actual bank. A
 * draft priced at market value against a £100m ceiling would approve moves FPL
 * rejects, and reject moves it allows. So a draft is the imported squad plus a
 * list of swaps, applied here against that squad's own money.
 */

import type { FplElement } from "@/lib/fpl/types";
import { POSITION_NAME } from "@/lib/fpl/types";
import type { PlayerProjection } from "@/lib/projections/engine";
import { optimiseSquad } from "./optimizer";

export interface DraftTransfer {
  out: number;
  in: number;
}

export interface DraftMove {
  out: { playerId: number; name: string; position: string; team: string; price: number };
  in: { playerId: number; name: string; position: string; team: string; price: number };
}

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Apply swaps to an imported squad, spending its real money.
 *
 * Checks what FPL itself would refuse: selling a player you do not own, buying
 * one you already have, swapping across positions, and running the bank below
 * zero. The three-per-club rule is left to the shared composition check, so it
 * is enforced in one place for every kind of squad.
 */
export function applyDraft(
  playerIds: number[],
  transfers: DraftTransfer[],
  elementsById: Map<number, FplElement>,
  teamName: (teamId: number) => string,
  sellPrices: Record<number, number>,
  bank: number,
): {
  playerIds: number[];
  sellPrices: Record<number, number>;
  bank: number;
  moves: DraftMove[];
} {
  const ids = [...playerIds];
  const prices = { ...sellPrices };
  let cash = bank;
  const moves: DraftMove[] = [];

  for (const t of transfers) {
    const outEl = elementsById.get(t.out);
    const inEl = elementsById.get(t.in);
    if (!outEl || !inEl) {
      throw new DraftError("One of those players no longer exists in FPL.");
    }
    const slot = ids.indexOf(t.out);
    if (slot === -1) {
      throw new DraftError(`${outEl.web_name} is not in your squad, so he cannot be sold.`);
    }
    if (ids.includes(t.in)) {
      throw new DraftError(`${inEl.web_name} is already in your squad.`);
    }
    if (outEl.element_type !== inEl.element_type) {
      throw new DraftError(
        `${outEl.web_name} is a ${POSITION_NAME[outEl.element_type]} and ` +
          `${inEl.web_name} is a ${POSITION_NAME[inEl.element_type]} — ` +
          "a transfer has to be like for like.",
      );
    }

    const sold = prices[t.out] ?? outEl.now_cost / 10;
    const bought = inEl.now_cost / 10;
    cash = round1(cash + sold - bought);

    ids[slot] = t.in;
    delete prices[t.out];
    // A player you buy today sells back at today's price until he rises.
    prices[t.in] = bought;

    moves.push({
      out: {
        playerId: t.out,
        name: outEl.web_name,
        position: POSITION_NAME[outEl.element_type],
        team: teamName(outEl.team),
        price: sold,
      },
      in: {
        playerId: t.in,
        name: inEl.web_name,
        position: POSITION_NAME[inEl.element_type],
        team: teamName(inEl.team),
        price: bought,
      },
    });
  }

  if (cash < -0.001) {
    throw new DraftError(
      `Those moves leave you £${Math.abs(cash).toFixed(1)}m short. ` +
        "Sell someone more expensive, or buy someone cheaper.",
    );
  }

  return { playerIds: ids, sellPrices: prices, bank: cash, moves };
}

/** Expected points a player contributes in one gameweek, doubles included. */
function pointsIn(p: PlayerProjection, gameweek: number): number {
  return p.perFixture
    .filter((f) => f.gameweek === gameweek)
    .reduce((sum, f) => sum + f.expectedPoints, 0);
}

/**
 * What the best XI from a squad scores in one gameweek, armband included.
 *
 * The captain has to be counted. A draft that brings in the player who would
 * take the armband earns his points twice, and one that sells the current
 * captain loses them twice — so comparing raw XI totals understates both
 * directions by a whole premium score, which is most of the decision.
 *
 * The XI is still solved on the mean, because adding the armband cannot change
 * which lineup wins: every formation fields the top-scoring player in each
 * position, so the squad's highest scorer is in all of them and the doubled
 * score is the same constant whichever shape is picked.
 */
function bestXI(squad: PlayerProjection[], gameweek: number): number {
  const score = (p: PlayerProjection) => pointsIn(p, gameweek);
  const xi = optimiseSquad(squad, score).startingXI;
  const total = xi.reduce((sum, p) => sum + score(p), 0);
  const captain = xi.reduce((best, p) => Math.max(best, score(p)), 0);
  return total + captain;
}

/** Chips that change what a set of transfers costs, or how long it lasts. */
export type TransferChip = "wildcard" | "freehit";

/**
 * What these transfers cost in points.
 *
 * A Wildcard or Free Hit suspends the limit, so there is no hit however many
 * moves are made. Charging one anyway costed a ten-move wildcard draft at −36
 * and reported a rebuild that gains thirty points as a catastrophe.
 */
export function draftHitCost(
  moves: number,
  freeTransfers: number,
  hitPerTransfer: number,
  chip: TransferChip | null,
): number {
  if (chip) return 0;
  return Math.max(0, moves - freeTransfers) * hitPerTransfer;
}

export interface DraftComparison {
  /** Best XI this gameweek, before and after, before any hit. */
  thisWeek: { before: number; after: number };
  /** Best XI summed across the horizon — the lineup you would field each week. */
  horizon: { before: number; after: number };
  /** Points deducted for transfers beyond the free allowance. */
  hitCost: number;
  /** After minus before across the horizon, with the hit already taken off. */
  netHorizon: number;
  /** After minus before this week, with the hit already taken off. */
  netThisWeek: number;
  /** The chip being played with these transfers, if any. */
  chip: TransferChip | null;
  /** True on a Free Hit: the squad goes back to what it was next gameweek. */
  revertsNextWeek: boolean;
}

/**
 * Compare the draft with the squad as it stands, on the lineup each would
 * actually field.
 *
 * Summing all fifteen would credit a new bench player with points he never
 * scores, so each squad is re-solved into its best XI for every gameweek, with
 * the armband on its best player. The hit is charged once, in the week the
 * transfers are made, because that is when FPL deducts it.
 *
 * A Free Hit lasts one gameweek and then the old squad comes back, so only
 * this week's figure belongs to the draft at all — the rest of the horizon is
 * scored on the squad the manager keeps. Without that, a Free Hit would be
 * credited with five weeks of a team it holds for one, which is the single
 * easiest way to talk someone into burning a chip.
 */
export function compareDraft(
  before: PlayerProjection[],
  after: PlayerProjection[],
  gameweek: number,
  horizon: number,
  hitCost: number,
  chip: TransferChip | null = null,
): DraftComparison {
  const later = Array.from({ length: horizon - 1 }, (_, i) => gameweek + i + 1);
  const sum = (squad: PlayerProjection[], gameweeks: number[]) =>
    gameweeks.reduce((total, gw) => total + bestXI(squad, gw), 0);

  const thisWeek = { before: bestXI(before, gameweek), after: bestXI(after, gameweek) };
  const laterBefore = sum(before, later);
  // On a Free Hit the draft is gone by next week, so the weeks after this one
  // are the squad the manager still owns, identical on both sides.
  const laterAfter = chip === "freehit" ? laterBefore : sum(after, later);

  const span = {
    before: thisWeek.before + laterBefore,
    after: thisWeek.after + laterAfter,
  };

  return {
    thisWeek: { before: round1(thisWeek.before), after: round1(thisWeek.after) },
    horizon: { before: round1(span.before), after: round1(span.after) },
    hitCost,
    netThisWeek: round1(thisWeek.after - thisWeek.before - hitCost),
    netHorizon: round1(span.after - span.before - hitCost),
    chip,
    revertsNextWeek: chip === "freehit",
  };
}
