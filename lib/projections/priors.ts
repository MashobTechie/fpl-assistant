/**
 * One way to shrink a rate, and one way to build the prior it shrinks toward.
 *
 * Every projection bug found on 2026-09-04 was the same shape: a per-90 rate
 * taken from a thin sample and used at face value. Khalaili's 14.92 defensive
 * contributions per 90, from 199 minutes, beat every established defender in
 * the league and was worth 6.6 points across the horizon — enough to have the
 * model sell a nailed Manchester City starter for a 0.2%-owned reserve.
 *
 * There was nothing clever about the fix in any individual case. The problem
 * was that each rate had its own hand-written path: expected goals shrank,
 * assists shrank, defensive contribution did not, saves did not, and nobody
 * could see the difference by reading the code. So the rates now share one
 * function, and adding a new one without shrinkage takes deliberate effort.
 *
 * The second rule here is the one that cost the most to learn. A prior built
 * from an empty cohort is zero, and shrinking toward zero is not neutral — it
 * is a confident assertion that defenders never make defensive contributions
 * and nobody is ever booked. Three gameweeks into a season, a 450-minute
 * cohort threshold emptied every bucket in the league and did exactly that.
 * An unusable prior is therefore `null`, and shrinking toward null leaves the
 * observation alone. Missing information must never masquerade as zero.
 */

import type { ElementTypeId, FplElement } from "@/lib/fpl/types";

/** A positional average, with the evidence behind it kept in view. */
export interface Prior {
  value: number;
  /** Minutes across the cohort. Small numbers mean a shaky prior. */
  minutes: number;
  /** How many players contributed. */
  players: number;
}

/**
 * Minutes a player needs before counting toward a positional average.
 *
 * Scales with how much season exists: about half of what has been played,
 * never asking for more than five matches or fewer than one. A fixed figure
 * cannot work at both ends — 450 is right in March and empties every cohort in
 * August.
 */
export function cohortThreshold(matchesPlayed: number): number {
  return Math.min(450, Math.max(90, matchesPlayed * 45));
}

/**
 * A minutes-weighted positional average, or null when too little supports it.
 *
 * Weighted by minutes so a full season counts for more than a cameo, and null
 * rather than zero when the cohort is thin — see the note above on why that
 * distinction is the whole point of this module.
 */
export function positionalPrior(
  elements: FplElement[],
  position: ElementTypeId,
  minMinutes: number,
  total: (e: FplElement) => number,
): Prior | null {
  const cohort = elements.filter(
    (e) => e.element_type === position && e.minutes >= minMinutes,
  );
  const minutes = cohort.reduce((sum, e) => sum + e.minutes, 0);

  // Fewer than three players or a couple of matches between them is not an
  // average, it is a coincidence.
  if (cohort.length < 3 || minutes < 180) return null;

  return {
    value: (cohort.reduce((sum, e) => sum + total(e), 0) / minutes) * 90,
    minutes,
    players: cohort.length,
  };
}

/**
 * Blend an observed rate toward a prior by how much evidence supports it.
 *
 * `weight` is the confidence in the observation, 0 to 1. A null prior means
 * there is nothing trustworthy to shrink toward, so the observation stands —
 * which is worse than a good prior and far better than a fabricated one.
 */
export function shrinkRate(
  observed: number,
  prior: Prior | null,
  weight: number,
): number {
  if (prior === null) return observed;
  const w = Math.min(1, Math.max(0, weight));
  return w * observed + (1 - w) * prior.value;
}

/**
 * Priors that were unusable, for logging.
 *
 * Silence is how the empty-cohort bug survived: every prior read 0.000 and
 * nothing said so. A projection running without them still works — the
 * observations simply stand unshrunk — but it is a materially different model
 * and that should be visible rather than inferred.
 */
export function missingPriors(
  named: Record<string, Partial<Record<ElementTypeId, Prior | null>>>,
): string[] {
  const gaps: string[] = [];
  for (const [name, byPosition] of Object.entries(named)) {
    const empty = (Object.keys(byPosition) as unknown as ElementTypeId[]).filter(
      (p) => byPosition[p] === null,
    );
    if (empty.length > 0) gaps.push(`${name} (positions ${empty.join(", ")})`);
  }
  return gaps;
}
