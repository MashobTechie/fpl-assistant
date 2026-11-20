/**
 * The shape of a gameweek, and the two ways reading it wrongly changes advice.
 *
 * A double gameweek is two matches a player actually plays, so his gameweek is
 * their sum. Treating the two as alternatives instead describes a player who
 * plays one of them, which is the single biggest reason anyone captains
 * someone — and it reported the ceiling of one match as the ceiling of both.
 *
 * And a draft is compared against a squad it shares fourteen players with, so
 * those fourteen have to cancel. They only cancel if they draw the same
 * numbers on both sides, which is what the seed is for.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { FixtureProjection, PlayerProjection } from "../engine";
import { simulatePlayer, summarise } from "../distribution";

/** A fixture whose expectations are a plausible attacking midfielder's. */
function fixture(gameweek: number): FixtureProjection {
  return {
    gameweek,
    opponent: "OPP",
    isHome: true,
    difficulty: 3,
    expectedMinutes: 85,
    expectedPoints: 5,
    breakdown: {
      // Two points of appearance: near-certain to play and to reach sixty.
      appearance: 1.9,
      goals: 1.5,
      assists: 0.9,
      cleanSheet: 0.3,
      saves: 0,
      defensiveContribution: 0.2,
      bonus: 0.6,
      goalsConceded: 0,
      discipline: 0,
    },
  };
}

function player(playerId: number, gameweeks: number[]): PlayerProjection {
  return {
    playerId,
    webName: `P${playerId}`,
    position: "MID",
    perFixture: gameweeks.map(fixture),
  } as unknown as PlayerProjection;
}

test("a double gameweek is the sum of both matches, not one of them", () => {
  const single = summarise(simulatePlayer(player(1, [10]), 10));
  const double = summarise(simulatePlayer(player(1, [10, 10]), 10));

  // Two matches of the same fixture: twice the mean, within sampling noise.
  assert.ok(
    Math.abs(double.mean - single.mean * 2) < 0.4,
    `double mean ${double.mean} should be about twice ${single.mean}`,
  );
  // And a genuinely higher ceiling, which is the captaincy case. Treating the
  // two matches as alternatives left this equal to the single-match ceiling.
  assert.ok(
    double.ceiling > single.ceiling + 2,
    `double ceiling ${double.ceiling} should clear single ${single.ceiling}`,
  );
  assert.ok(
    double.pHaul > single.pHaul,
    `double pHaul ${double.pHaul} should exceed ${single.pHaul}`,
  );
});

test("a player with no fixture blanks rather than scoring", () => {
  const d = summarise(simulatePlayer(player(1, [11]), 10));
  assert.equal(d.mean, 0);
  assert.equal(d.ceiling, 0);
  assert.equal(d.pBlank, 1);
});

test("the same player draws the same numbers, so shared players cancel", () => {
  // The property the draft comparison depends on: sample a squad and a draft
  // of it, and the fourteen they share must contribute identically.
  const a = simulatePlayer(player(7, [10]), 10);
  const b = simulatePlayer(player(7, [10]), 10);
  assert.deepEqual(a, b);

  // Different players must not be identical, or the whole thing is constant.
  const other = simulatePlayer(player(8, [10]), 10);
  assert.notDeepEqual(a, other);
});

test("a different gameweek is a different draw", () => {
  const ten = simulatePlayer(player(7, [10]), 10);
  const eleven = simulatePlayer(player(7, [11]), 11);
  assert.notDeepEqual(ten, eleven);
});
