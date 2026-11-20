/**
 * The week's decision, in words.
 *
 * Two things are worth pinning. The hierarchy: the verdict must lead on
 * whatever costs most to get wrong, and an unavailable player in the eleven
 * beats a good transfer every time, because no projection can rescue a player
 * who does not take the pitch. And the language: this is the one surface
 * written for someone who has never played fantasy football, so the jargon ban
 * is a test rather than a hope.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlayerProjection } from "@/lib/projections/engine";
import type { ChipValuation, TransferBudget } from "../chips";
import type { CaptaincyCandidate, OptimisedSquad } from "../optimizer";
import type { TransferPlan } from "../planner";
import { buildVerdict } from "../verdict";

function starter(
  playerId: number,
  webName: string,
  opts: { status?: string; minutes?: number; basis?: string } = {},
): PlayerProjection {
  return {
    playerId,
    webName,
    position: "MID",
    team: "ARS",
    status: opts.status ?? "a",
    expectedMinutes: opts.minutes ?? 85,
    dataBasis: opts.basis ?? "current_season",
    nextGameweekPoints: 5,
    totalExpectedPoints: 25,
  } as unknown as PlayerProjection;
}

const optimal = (xi: PlayerProjection[]): OptimisedSquad =>
  ({ startingXI: xi, bench: [], expectedPoints: 50 }) as unknown as OptimisedSquad;

const captaincy = (name: string, pHaul = 0.25, ceiling = 12): CaptaincyCandidate[] => [
  {
    player: starter(99, name),
    distribution: { mean: 6, floor: 1, median: 5, ceiling, pHaul, pBlank: 0.1 },
  },
];

const plan = (gain: number, move: { outName: string; inName: string } | null): TransferPlan =>
  ({
    gain,
    totalPoints: 100,
    doNothingPoints: 100 - gain,
    moves: [
      {
        gameweek: 10,
        transfer: move ? { ...move, outId: 1, inId: 2 } : null,
        freeTransfers: 1,
        hitCost: 0,
        expectedPoints: 50,
      },
      {
        gameweek: 11,
        transfer: move ? null : { outName: "Hughes", inName: "Mbeumo", outId: 1, inId: 2 },
        freeTransfers: move ? 1 : 2,
        hitCost: 0,
        expectedPoints: 50,
      },
    ],
  }) as unknown as TransferPlan;

const noChips: ChipValuation[] = [];
const budget: TransferBudget = { free: 1, inferred: true, hitCost: 4 };

const base = {
  gameweek: 10,
  horizon: 5,
  matchesPlayed: 10,
  captaincy: captaincy("Palmer"),
  chips: noChips,
  transfers: budget,
};

/** The jargon this surface exists to avoid. */
const BANNED = [
  "differential",
  "nailed",
  "enabler",
  "fixture swing",
  "ceiling",
  "floor",
  "haul",
  "xg",
  "xgi",
  "fdr",
  "expected points",
  "xpts",
  "per 90",
];

/** Terminal punctuation, which is all these strings use. */
const sentences = (text: string) => (text.match(/[.!?](?=\s|$)/g) ?? []).length;

function assertPlain(v: { action: string; captain: string | null; caution: string | null }) {
  const parts = [v.action, v.captain, v.caution].filter(Boolean) as string[];
  const text = parts.join(" ").toLowerCase();
  for (const word of BANNED) {
    assert.ok(!text.includes(word), `"${word}" should never reach the verdict: ${text}`);
  }

  // The budget, enforced. The action gets one sentence however much it carries,
  // because the captain and the caveat need the other two.
  assert.equal(
    sentences(v.action),
    1,
    `the action must be one sentence, got ${sentences(v.action)}: ${v.action}`,
  );
  const total = parts.reduce((n, part) => n + sentences(part), 0);
  assert.ok(total <= 3, `at most three sentences, got ${total}: ${text}`);
}

test("an unavailable starter outranks a transfer worth making", () => {
  const v = buildVerdict({
    ...base,
    optimal: optimal([starter(1, "Saka"), starter(2, "Gabriel", { status: "i" })]),
    plan: plan(9, { outName: "Hughes", inName: "Mbeumo" }),
  });
  assert.equal(v.kind, "availability");
  assert.match(v.action, /Gabriel is injured/);
  assert.match(v.action, /before the deadline/);
  assertPlain(v);
});

test("a chip at its best week outranks a transfer", () => {
  const v = buildVerdict({
    ...base,
    optimal: optimal([starter(1, "Saka")]),
    plan: plan(9, { outName: "Hughes", inName: "Mbeumo" }),
    chips: [
      {
        chip: "bboost",
        label: "Bench Boost",
        available: true,
        gain: 11,
        bestGameweek: 10,
      } as unknown as ChipValuation,
    ],
  });
  assert.equal(v.kind, "chip");
  assert.match(v.action, /Bench Boost/);
  assert.match(v.action, /about 11 points/);
  assertPlain(v);
});

test("a chip best played later is not recommended now", () => {
  const v = buildVerdict({
    ...base,
    optimal: optimal([starter(1, "Saka")]),
    plan: plan(0, null),
    chips: [
      {
        chip: "bboost",
        label: "Bench Boost",
        available: true,
        gain: 11,
        bestGameweek: 13,
      } as unknown as ChipValuation,
    ],
  });
  assert.equal(v.kind, "hold");
});

test("a transfer worth making is named, both sides", () => {
  const v = buildVerdict({
    ...base,
    optimal: optimal([starter(1, "Saka")]),
    plan: plan(9, { outName: "Hughes", inName: "Mbeumo" }),
  });
  assert.equal(v.kind, "transfer");
  assert.match(v.action, /Hughes out, Mbeumo in/);
  assertPlain(v);
});

test("a plan that starts next week says wait, not act", () => {
  const v = buildVerdict({
    ...base,
    optimal: optimal([starter(1, "Saka")]),
    plan: plan(7, null),
  });
  assert.equal(v.kind, "wait");
  assert.match(v.action, /Save your transfer this week/);
  assert.match(v.action, /Mbeumo/);
  assertPlain(v);
});

test("doing nothing is stated as a decision", () => {
  const v = buildVerdict({
    ...base,
    optimal: optimal([starter(1, "Saka")]),
    plan: plan(0.4, { outName: "Hughes", inName: "Mbeumo" }),
  });
  assert.equal(v.kind, "hold");
  assert.match(v.action, /Leave your team alone/);
  assertPlain(v);
});

test("banked transfers are mentioned without spending a sentence on them", () => {
  const v = buildVerdict({
    ...base,
    transfers: { free: 3, inferred: true, hitCost: 4 },
    optimal: optimal([starter(1, "Saka")]),
    plan: plan(0, null),
  });
  assert.match(v.action, /already have 3 saved up/);
  assertPlain(v);
});

test("every branch of the hierarchy stays inside three sentences", () => {
  // The count is the contract, so it is checked on each kind rather than only
  // on whichever one a given fixture happens to reach.
  const cases = [
    {
      optimal: optimal([starter(2, "Gabriel", { status: "s" })]),
      plan: plan(9, { outName: "Hughes", inName: "Mbeumo" }),
      chips: noChips,
    },
    {
      optimal: optimal([starter(1, "Saka", { minutes: 40 })]),
      plan: plan(9, { outName: "Hughes", inName: "Mbeumo" }),
      chips: [
        { chip: "3xc", label: "Triple Captain", available: true, gain: 9, bestGameweek: 10 } as unknown as ChipValuation,
      ],
    },
    {
      optimal: optimal([starter(1, "Saka", { minutes: 30 })]),
      plan: plan(12, { outName: "Hughes", inName: "Mbeumo" }),
      chips: noChips,
    },
    {
      optimal: optimal([starter(1, "Saka", { minutes: 30 })]),
      plan: plan(7, null),
      chips: noChips,
    },
    {
      optimal: optimal([starter(1, "Saka", { minutes: 30 })]),
      plan: plan(0, null),
      chips: noChips,
    },
  ];
  const kinds = new Set<string>();
  for (const c of cases) {
    const v = buildVerdict({ ...base, transfers: { free: 2, inferred: true, hitCost: 4 }, ...c });
    assertPlain(v);
    kinds.add(v.kind);
  }
  // All five branches genuinely exercised, not four plus a repeat.
  assert.deepEqual(
    [...kinds].sort(),
    ["availability", "chip", "hold", "transfer", "wait"],
  );
});

test("the captain is named every week, whatever else is going on", () => {
  for (const p of [plan(0, null), plan(9, { outName: "A", inName: "B" })]) {
    const v = buildVerdict({ ...base, optimal: optimal([starter(1, "Saka")]), plan: p });
    assert.match(v.captain!, /Captain Palmer/);
  }
});

test("a close captaincy call says so rather than pretending", () => {
  const v = buildVerdict({
    ...base,
    captaincy: [
      ...captaincy("Palmer", 0.25, 12),
      {
        player: starter(98, "Saka"),
        distribution: { mean: 5.8, floor: 1, median: 5, ceiling: 11.7, pHaul: 0.23, pBlank: 0.1 },
      },
    ],
    optimal: optimal([starter(1, "Saka")]),
    plan: plan(0, null),
  });
  assert.match(v.captain!, /Saka is almost as good a shout/);
  assertPlain(v);
});

test("a part-time starter is the caution, in minutes not jargon", () => {
  const v = buildVerdict({
    ...base,
    optimal: optimal([starter(1, "Saka"), starter(2, "Raya", { minutes: 42 })]),
    plan: plan(0, null),
  });
  assert.match(v.caution!, /Raya is only expected to play about 42 minutes/);
  assertPlain(v);
});

test("early in a season the caution is how little has been played", () => {
  const v = buildVerdict({
    ...base,
    matchesPlayed: 3,
    optimal: optimal([starter(1, "Saka")]),
    plan: plan(0, null),
  });
  assert.match(v.caution!, /Only 3 games have been played/);
  assertPlain(v);
});

test("a settled season with a clean eleven gets no caution at all", () => {
  const v = buildVerdict({
    ...base,
    matchesPlayed: 24,
    optimal: optimal([starter(1, "Saka"), starter(2, "Gabriel")]),
    plan: plan(0, null),
  });
  assert.equal(v.caution, null);
});
