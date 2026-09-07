/**
 * Minutes as a distribution, not an average.
 *
 * FPL pays appearance points on a threshold — one point for playing at all, two
 * for reaching sixty — and clean sheets only count for players who reach sixty.
 * So what matters is not how many minutes a player averages but how often he
 * crosses those lines, and an average cannot say.
 *
 * 90-90-0 and 60-60-60 both average 60. The first is a starter who was rested
 * once and reaches sixty two weeks in three; the second never reaches it at
 * all. The projection previously inferred both from the average through a pair
 * of linear guesses — pAppear = mins/25, pSixty = (mins-15)/65 — which is a
 * reasonable shape and simply cannot separate those two players.
 *
 * The established public models treat this as a probability distribution over
 * starting, appearing from the bench, and not playing, then take the
 * probability-weighted mean. With one request per gameweek returning every
 * player, the frequencies can be observed directly instead of assumed.
 */

/** What a window of recent gameweeks says about a player's role. */
export interface MinutesProfile {
  /** Gameweeks observed. */
  games: number;
  /** P(reaches 60 minutes) — the threshold that pays two points and clean sheets. */
  pSixty: number;
  /** P(appears at all). */
  pAppear: number;
  /** Probability-weighted mean minutes. */
  expectedMinutes: number;
  /** Minutes in each observed gameweek, most recent last. */
  recent: number[];
}

/**
 * A start is judged at the hour rather than by a starting flag, because the
 * hour is what FPL actually pays on, and the live feed does not publish
 * line-ups anyway. A player withdrawn at 58 minutes counts as a substitute
 * appearance here, which is exactly how his points behaved.
 */
const SIXTY = 60;

/**
 * Laplace smoothing, so a three-game window cannot claim certainty.
 *
 * Three starts from three is 100% before smoothing and 80% after, which is the
 * honest reading of three matches: strong evidence, not proof. The constant is
 * deliberately small — at ten games it barely moves the estimate.
 */
const SMOOTHING = 0.75;

export function minutesProfile(
  recent: number[] | undefined,
  /** Falls back to this when there is no window to read. */
  fallbackMinutes: number,
): MinutesProfile | null {
  if (!recent || recent.length === 0) return null;

  const games = recent.length;
  const sixties = recent.filter((m) => m >= SIXTY);
  const shorts = recent.filter((m) => m > 0 && m < SIXTY);

  const pSixty = (sixties.length + SMOOTHING) / (games + 2 * SMOOTHING);
  const pShort = (shorts.length + SMOOTHING) / (games + 2 * SMOOTHING);

  const mean = (xs: number[], fallback: number) =>
    xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;

  // Conditional means: how long he plays *given* he started, and given he came
  // on. Falling back to sensible defaults when a player has never done one.
  const whenSixty = mean(sixties, Math.max(fallbackMinutes, SIXTY + 15));
  const whenShort = mean(shorts, 20);

  return {
    games,
    pSixty: Math.min(0.97, pSixty),
    pAppear: Math.min(0.99, pSixty + pShort),
    expectedMinutes: pSixty * whenSixty + pShort * whenShort,
    recent,
  };
}

/**
 * Blend the observed profile with the longer-run estimate.
 *
 * A five-game window is responsive but thin, and on its own it would swing a
 * projection on a single rested week. The season-and-history figure the engine
 * already computes is the steadier number, so the window is weighted by how
 * many games it actually contains.
 */
export function blendedMinutes(
  profile: MinutesProfile | null,
  longRunMinutes: number,
  /** Games at which the window and the long run carry equal weight. */
  halfWeight = 4,
): number {
  if (!profile) return longRunMinutes;
  const w = profile.games / (profile.games + halfWeight);
  return w * profile.expectedMinutes + (1 - w) * longRunMinutes;
}
