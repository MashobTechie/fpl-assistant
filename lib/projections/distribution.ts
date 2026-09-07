/**
 * The shape of a player's gameweek, not just its mean.
 *
 * Expected points is the right way to pick a squad and the wrong way to pick a
 * captain. The armband doubles one player's score, so it is a bet on the upper
 * tail: a forward projected 5.5 who returns 2 or 14 is a better captain than a
 * midfielder projected 5.8 who returns 5 or 6 almost every week, and comparing
 * means alone says the opposite.
 *
 * Every established model reaches the same conclusion — captaincy is decided on
 * the distribution — and the distribution is cheap to obtain here because the
 * engine already produces the parameters. Goals and assists are Poisson counts
 * with known rates, appearing and reaching sixty minutes are Bernoulli trials
 * with known probabilities, and a clean sheet is another. Sampling those
 * together costs microseconds and needs no new data.
 *
 * Simulation rather than convolution because the components are not
 * independent in the ways that matter: a player who does not play scores no
 * goals, keeps no clean sheet and earns no bonus, and that correlation is the
 * whole reason a rotation risk has a floor of zero. Enumerating it analytically
 * is possible and considerably harder to read.
 */

import type { FixtureProjection } from "./engine";

export interface PointsDistribution {
  mean: number;
  /** A bad week that is not unusual — the tenth percentile. */
  floor: number;
  median: number;
  /** The realistic good week — the ninetieth percentile. */
  ceiling: number;
  /** P(returning 10 or more), the haul that decides a captaincy. */
  pHaul: number;
  /** P(2 points or fewer), the blank that loses a gameweek. */
  pBlank: number;
}

/** Mulberry32 — small, fast, and seeded, so a projection is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Knuth's method. Rates here are small, so the loop runs once or twice. */
function poisson(lambda: number, rand: () => number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > limit && k < 20);
  return k - 1;
}

const SAMPLES = 4000;

/**
 * Simulate one fixture many times and read the distribution off the results.
 *
 * The breakdown the engine produces is a set of expectations, and each is
 * turned back into the random process that generated it: goals and assists
 * from their per-90 rates, the appearance and sixty-minute thresholds from
 * their probabilities, the clean sheet from its own. Bonus and defensive
 * contribution are kept at their expected values — both are already
 * probability-weighted and neither drives the tail a captain is bought for.
 */
export function simulateFixture(
  fixture: FixtureProjection,
  goalPoints: number,
  assistPoints: number,
  cleanSheetPoints: number,
  seed: number,
): number[] {
  const rand = rng(seed);
  const b = fixture.breakdown;

  // Recover the underlying rates from the points they were converted into.
  const goalRate = goalPoints > 0 ? b.goals / goalPoints : 0;
  const assistRate = assistPoints > 0 ? b.assists / assistPoints : 0;
  const pCleanSheet = cleanSheetPoints > 0 ? b.cleanSheet / cleanSheetPoints : 0;

  // The appearance component is one point for playing plus one more for
  // reaching sixty, so the two probabilities fall straight back out of it.
  const pSixty = Math.min(1, Math.max(0, b.appearance - 1 >= 0 ? b.appearance - 1 : 0));
  const pAppear = Math.min(1, Math.max(0, b.appearance - pSixty));

  const steady = b.bonus + b.defensiveContribution + b.saves + b.goalsConceded;

  const out: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const played = rand() < pAppear;
    if (!played) {
      out.push(0);
      continue;
    }
    const sixty = rand() < pSixty / Math.max(pAppear, 1e-9);

    let points = sixty ? 2 : 1;
    points += poisson(goalRate, rand) * goalPoints;
    points += poisson(assistRate, rand) * assistPoints;
    if (sixty && rand() < pCleanSheet / Math.max(pSixty, 1e-9)) {
      points += cleanSheetPoints;
    }
    points += steady;
    out.push(points);
  }
  return out;
}

/** Percentiles and tail probabilities from a sorted sample. */
export function summarise(samples: number[]): PointsDistribution {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  // Points to a tenth, probabilities to a hundredth — rounding a probability
  // to 0.1 collapses 4% and 14% onto the same figure, which is most of the
  // difference between a safe captain and a punt.
  const pts = (n: number) => Math.round(n * 10) / 10;
  const prob = (n: number) => Math.round(n * 100) / 100;

  return {
    mean: pts(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    floor: pts(at(0.1)),
    median: pts(at(0.5)),
    ceiling: pts(at(0.9)),
    pHaul: prob(sorted.filter((s) => s >= 10).length / sorted.length),
    pBlank: prob(sorted.filter((s) => s <= 2).length / sorted.length),
  };
}
