/**
 * The invariants that four separate projection bugs violated.
 *
 * Each was the same shape — a rate from a thin sample used at face value — and
 * each produced a plausible number rather than an error, which is why they all
 * survived until an outside source contradicted a recommendation. These lock
 * the behaviour so the next rate added cannot repeat it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { FplElement } from "@/lib/fpl/types";
import { cohortThreshold, positionalPrior, shrinkRate } from "../priors";

const player = (minutes: number, total: number, type = 2): FplElement =>
  ({ element_type: type, minutes, defensive_contribution: total }) as FplElement;

const defcon = (e: FplElement) => e.defensive_contribution ?? 0;

test("a thin cohort yields no prior rather than a prior of zero", () => {
  // Three gameweeks in, a 450-minute threshold matched nobody, and the
  // resulting 0 read as "defenders make no defensive contributions".
  assert.equal(positionalPrior([player(500, 50), player(500, 50)], 2, 450, defcon), null);
});

test("shrinking toward a missing prior leaves the observation alone", () => {
  assert.equal(shrinkRate(14.92, null, 0.2), 14.92);
});

test("a thin observation is pulled most of the way to the prior", () => {
  // Khalaili: 14.92 per 90 off 199 minutes, against a 7.5 positional average.
  const prior = { value: 7.5, minutes: 9000, players: 20 };
  const shrunk = shrinkRate(14.92, prior, 199 / (199 + 900));
  assert.ok(shrunk < 9, `expected well under 9, got ${shrunk.toFixed(2)}`);
  assert.ok(shrunk > 7.5, "stays above the prior since the observation is higher");
});

test("a heavily evidenced observation barely moves", () => {
  const prior = { value: 7.5, minutes: 9000, players: 20 };
  assert.ok(Math.abs(shrinkRate(12, prior, 0.95) - 12) < 0.3);
});

test("the cohort threshold scales with the season, not a fixed 450", () => {
  assert.equal(cohortThreshold(3), 135, "three matches in, ask for 135 minutes");
  assert.equal(cohortThreshold(20), 450, "late season, cap at five matches");
  assert.equal(cohortThreshold(0), 90, "never ask for less than one match");
});

test("a usable prior reports the evidence behind it", () => {
  const prior = positionalPrior(
    [player(900, 90), player(900, 90), player(900, 90)], 2, 450, defcon);
  assert.ok(prior !== null);
  assert.equal(prior.players, 3);
  assert.equal(prior.minutes, 2700);
  assert.equal(Math.round(prior.value), 9);
});
