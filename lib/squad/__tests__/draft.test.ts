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
import { applyDraft, DraftError } from "../draft";

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
