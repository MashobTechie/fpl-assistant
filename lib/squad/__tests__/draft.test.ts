/**
 * Trying transfers before making them.
 *
 * The sandbox exists to answer "would FPL let me do this?" before the manager
 * finds out in the real app. Every rule here is one where getting it wrong
 * means telling someone a move is fine when FPL will refuse it — or worse,
 * approving it at the wrong price, so the move they make costs more than the
 * one they were shown.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { FplElement } from "@/lib/fpl/types";
import type { PlayerProjection } from "@/lib/projections/engine";
import { applyDraft, compareDraft, draftHitCost, DraftError } from "../draft";

/** Just the fields applyDraft reads. */
function el(id: number, type: 1 | 2 | 3 | 4, cost: number, team = 1): FplElement {
  return {
    id,
    element_type: type,
    now_cost: cost,
    team,
    web_name: `P${id}`,
  } as FplElement;
}

const elements = new Map<number, FplElement>([
  [1, el(1, 2, 50)], // DEF £5.0m, owned
  [2, el(2, 2, 60)], // DEF £6.0m
  [3, el(3, 4, 90)], // FWD £9.0m
  [4, el(4, 2, 45)], // DEF £4.5m
  [5, el(5, 3, 70)], // MID £7.0m, owned
]);
const team = () => "ARS";

test("funds a move from the selling price, not the market price", () => {
  // Bought at £4.6m, now £5.0m: FPL returns half the rise, so he sells for £4.8m.
  const r = applyDraft([1, 5], [{ out: 1, in: 2 }], elements, team, { 1: 4.8 }, 1.5);
  assert.equal(r.bank, 0.3); // 1.5 + 4.8 − 6.0
  assert.deepEqual(r.playerIds, [2, 5]);
});

test("refuses a move the bank cannot cover, and names the gap", () => {
  assert.throws(
    () => applyDraft([1, 5], [{ out: 1, in: 2 }], elements, team, { 1: 4.8 }, 0.5),
    (err: unknown) => err instanceof DraftError && /£0\.7m short/.test(err.message),
  );
});

test("refuses a swap across positions", () => {
  assert.throws(
    () => applyDraft([1, 5], [{ out: 1, in: 3 }], elements, team, {}, 10),
    /like for like/,
  );
});

test("refuses to sell a player not in the squad", () => {
  assert.throws(
    () => applyDraft([1, 5], [{ out: 4, in: 2 }], elements, team, {}, 10),
    /not in your squad/,
  );
});

test("refuses to buy a player already owned", () => {
  assert.throws(
    () => applyDraft([1, 5], [{ out: 1, in: 1 }], elements, team, {}, 10),
    /already in your squad/,
  );
});

test("carries the bank across moves, so a cheap sale can fund a dear buy", () => {
  // Downgrade 1 → 4 frees £0.5m; that is what makes the second move possible.
  const r = applyDraft(
    [1, 5],
    [
      { out: 1, in: 4 },
      { out: 4, in: 2 },
    ],
    elements,
    team,
    {},
    1.0,
  );
  assert.equal(r.bank, 0);
  assert.deepEqual(r.playerIds, [2, 5]);
});

test("prices a player bought in the draft at today's cost if sold again", () => {
  const r = applyDraft([1, 5], [{ out: 1, in: 2 }], elements, team, { 1: 4.8 }, 2);
  assert.equal(r.sellPrices[2], 6);
  assert.equal(r.sellPrices[1], undefined);
});

// ---------------------------------------------------------- what it is worth
//
// The verdict is the number the whole screen exists to produce, so the three
// ways it has been wrong are pinned here: forgetting the armband, charging the
// hit once per gameweek instead of once, and crediting a bench player with
// points he never scores.

/** Just the fields compareDraft and the optimiser read. */
function player(
  playerId: number,
  position: PlayerProjection["position"],
  perWeek: number,
  gameweeks: number[],
): PlayerProjection {
  return {
    playerId,
    position,
    webName: `P${playerId}`,
    nextGameweekPoints: perWeek,
    perFixture: gameweeks.map((gameweek) => ({ gameweek, expectedPoints: perWeek })),
  } as unknown as PlayerProjection;
}

/**
 * A legal fifteen where everyone scores the same, so any change in the verdict
 * is caused by the thing under test and not by the optimiser picking a
 * different shape.
 */
function squadOf(perWeek: number, gameweeks: number[]): PlayerProjection[] {
  const squad: PlayerProjection[] = [];
  let id = 1;
  for (const [position, count] of [
    ["GKP", 2],
    ["DEF", 5],
    ["MID", 5],
    ["FWD", 3],
  ] as const) {
    for (let i = 0; i < count; i++) {
      squad.push(player(id++, position, perWeek, gameweeks));
    }
  }
  return squad;
}

/** Replace a player with one scoring differently, keeping his position. */
function swap(
  squad: PlayerProjection[],
  playerId: number,
  perWeek: number,
  gameweeks: number[],
): PlayerProjection[] {
  return squad.map((p) =>
    p.playerId === playerId ? player(900 + playerId, p.position, perWeek, gameweeks) : p,
  );
}

test("counts the armband, so a new captain is worth twice his points", () => {
  // Everyone on 4, so the armband is worth 4 to either squad until the draft
  // brings in a 10. His marginal 6 then arrives twice: once as a starter and
  // once as the captain.
  const before = squadOf(4, [10]);
  const after = swap(before, 13, 10, [10]); // a forward, so he starts
  const c = compareDraft(before, after, 10, 1, 0);

  assert.equal(c.thisWeek.before, 48); // 11 x 4, plus 4 for the armband
  assert.equal(c.thisWeek.after, 60); // 10 x 4 + 10, plus 10 for the armband
  assert.equal(c.netThisWeek, 12); // not the 6 a raw XI total would report
});

test("charges the hit once, not once per gameweek", () => {
  // A premium nobody displaces keeps the armband fixed, so the only change is
  // the upgraded defender.
  const before = squadOf(4, [10, 11, 12]);
  before[7] = player(7, "MID", 20, [10, 11, 12]);
  const after = swap(before, 3, 6, [10, 11, 12]); // a defender, 4 -> 6

  const c = compareDraft(before, after, 10, 3, 4);
  assert.equal(c.horizon.before, 240); // 80 a week for three weeks
  assert.equal(c.horizon.after, 246); // +2 a week
  assert.equal(c.netHorizon, 2); // 6 gained, 4 charged once
  assert.equal(c.netThisWeek, -2); // the week the hit lands
});

test("does not credit a bench player with points he never scores", () => {
  // The fifth defender is behind four others on 4, so he stays benched before
  // and after. Summing all fifteen would report +2; the XI is unchanged.
  const before = squadOf(4, [10]);
  before[6] = player(6, "DEF", 0, [10]);
  const after = swap(before, 6, 2, [10]);

  const c = compareDraft(before, after, 10, 1, 0);
  assert.equal(c.netThisWeek, 0);
  assert.equal(c.thisWeek.after, c.thisWeek.before);
});

test("a Free Hit is scored on its one gameweek, not the whole horizon", () => {
  const before = squadOf(4, [10, 11, 12]);
  const after = swap(before, 13, 14, [10, 11, 12]); // +10 a week while held

  const plain = compareDraft(before, after, 10, 3, 0);
  const freeHit = compareDraft(before, after, 10, 3, 0, "freehit");

  // Held, the upgrade pays every week. On a Free Hit the squad goes back after
  // this one, so crediting it with three weeks would talk someone into burning
  // a chip for three times what it earns.
  assert.equal(plain.netHorizon, 60);
  assert.equal(freeHit.netHorizon, 20);
  assert.equal(freeHit.netHorizon, freeHit.netThisWeek);
  assert.equal(freeHit.revertsNextWeek, true);
});

test("a Wildcard keeps the squad, so it is scored across the horizon", () => {
  const before = squadOf(4, [10, 11, 12]);
  const after = swap(before, 13, 14, [10, 11, 12]);

  const wildcard = compareDraft(before, after, 10, 3, 0, "wildcard");
  assert.equal(wildcard.netHorizon, 60);
  assert.equal(wildcard.revertsNextWeek, false);
});

test("a chip suspends the transfer limit, however many moves are made", () => {
  assert.equal(draftHitCost(10, 1, 4, "wildcard"), 0);
  assert.equal(draftHitCost(10, 1, 4, "freehit"), 0);
  // Without one, everything past the free allowance is charged.
  assert.equal(draftHitCost(10, 1, 4, null), 36);
  assert.equal(draftHitCost(1, 1, 4, null), 0);
  assert.equal(draftHitCost(1, 0, 4, null), 4);
});
