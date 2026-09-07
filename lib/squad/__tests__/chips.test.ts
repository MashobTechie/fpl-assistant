/**
 * Free-transfer inference.
 *
 * FPL does not publish a manager's free-transfer count on any endpoint
 * reachable without their own login, so it is reconstructed from public
 * transfer history. That reconstruction is easy to get subtly wrong and hard to
 * notice: it produces a plausible small integer either way, and the mistake
 * only surfaces as advice to make a transfer that would actually cost four
 * points.
 *
 * It was wrong. Gameweek 1 was folded into the accumulation, but transfers
 * before the first deadline are unlimited and bank nothing, so every manager
 * carried a phantom extra transfer all season.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { FplEntryHistory } from "@/lib/fpl/types";
import { transferBudget } from "../chips";

const week = (event: number, transfers: number) => ({
  event,
  event_transfers: transfers,
  points: 0,
  total_points: 0,
  rank: null,
  overall_rank: null,
  event_transfers_cost: 0,
  points_on_bench: 0,
  value: 1000,
  bank: 0,
});

const history = (
  weeks: [number, number][],
  chips: { name: string; event: number }[] = [],
): FplEntryHistory =>
  ({ current: weeks.map(([e, t]) => week(e, t)), chips }) as FplEntryHistory;

test("gameweek 1 banks nothing — its transfers are unlimited", () => {
  // A transfer in GW2 and another in GW3 leaves exactly the new one for GW4.
  assert.equal(transferBudget(history([[1, 0], [2, 1], [3, 1]]), 4).free, 1);
});

test("unused transfers accumulate", () => {
  assert.equal(transferBudget(history([[1, 0], [2, 0], [3, 0]]), 4).free, 3);
});

test("accumulation caps at five", () => {
  const weeks: [number, number][] = [[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]];
  assert.equal(transferBudget(history(weeks), 7).free, 5);
});

test("a hit cannot push the count below the weekly grant", () => {
  // Three transfers on one free one is a −8 hit, and leaves nothing banked.
  assert.equal(transferBudget(history([[1, 0], [2, 3], [3, 0]]), 4).free, 2);
});

test("spending more than banked resets to the weekly grant", () => {
  assert.equal(transferBudget(history([[1, 0], [2, 0], [3, 2]]), 4).free, 1);
});

test("a wildcard leaves the bank untouched", () => {
  const h = history([[1, 0], [2, 0], [3, 8]], [{ name: "wildcard", event: 3 }]);
  assert.equal(transferBudget(h, 4).free, 3);
});

test("a free hit leaves the bank untouched", () => {
  const h = history([[1, 0], [2, 0], [3, 11]], [{ name: "freehit", event: 3 }]);
  assert.equal(transferBudget(h, 4).free, 3);
});

test("the first gameweek after the opener grants one", () => {
  assert.equal(transferBudget(history([[1, 0]]), 2).free, 1);
});

test("no history at all still answers", () => {
  assert.equal(transferBudget(null, 2).free, 1);
});
