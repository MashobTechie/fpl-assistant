/**
 * What to do, in words anyone can act on.
 *
 * Everything else this app produces is an instrument reading: expected points,
 * a ceiling, a clean-sheet probability, a plan worth 6.2 over five gameweeks.
 * All of it correct, and all of it leaving the synthesis to the reader. The
 * question someone actually opens the app with on a Friday night is "what do I
 * do before the deadline", and nine panels of figures do not answer it.
 *
 * So this says the decision. Three rules it follows:
 *
 * It is deterministic, and therefore free and instant. The engine already
 * knows the answer — it solved the XI, ranked captaincy on the distribution,
 * planned the transfers and costed the chips — so turning that into a sentence
 * is formatting, not reasoning. Routing it through the analyst instead would
 * mean no verdict for the first thirty seconds, none without an API key, and
 * none on a refresh that reuses a cached analysis. The analyst's own version
 * replaces this one when it arrives, in the same place, saying the same kind of
 * thing better.
 *
 * It says one thing. The hierarchy below is ordered by what costs most to get
 * wrong, and only the top item becomes the action — a verdict that lists five
 * considerations is the panel stack again, in a paragraph.
 *
 * Three sentences, hard: one each for the action, the captain and the caveat,
 * and the caveat only when there is one. That is why every action below is a
 * single sentence however much it has to carry — the budget is spent before
 * the captain is named, and a fourth sentence is where a reader decides the
 * last one is skippable. There is a test for the count.
 *
 * It uses no jargon at all. Not ceiling, floor, haul, differential, enabler,
 * fixture swing, xG or FDR. The transfer schema has demanded this of one field
 * for a while, for the same reason: a manager who reads "enabler with a
 * fixture swing" either already knew or learns nothing. Someone who has never
 * played fantasy football should be able to act on every sentence here.
 */

import { DRAFT_WORTH_IT_POINTS } from "@/lib/types";
import type { ChipValuation, TransferBudget } from "./chips";
import type { CaptaincyCandidate, OptimisedSquad } from "./optimizer";
import type { TransferPlan } from "./planner";

/** Which of the week's decisions turned out to be the one worth leading on. */
export type VerdictKind = "availability" | "chip" | "transfer" | "wait" | "hold";

export interface Verdict {
  kind: VerdictKind;
  /** The decision. Always present. */
  action: string;
  /**
   * Who to captain. Normally present, because it is the one choice every
   * manager makes every single week, whatever else is going on.
   */
  captain: string | null;
  /** The thing that would change the call — only when there genuinely is one. */
  caution: string | null;
}

/** FPL's status codes, in words someone outside the game would use. */
const STATUS_WORD: Record<string, string> = {
  i: "injured",
  d: "a doubt",
  s: "suspended",
  u: "unavailable",
  n: "not in the squad",
};

/** A probability as people say it out loud, rather than as a decimal. */
function asOdds(p: number): string {
  if (p >= 0.45) return "close to even";
  if (p <= 0.04) return "very unlikely";
  return `about 1 in ${Math.round(1 / p)}`;
}

const weeks = (n: number) => (n === 1 ? "this week" : `the next ${n} weeks`);

/** "about 6 points", because a tenth of a point is not a reason to act. */
const points = (n: number) => `about ${Math.round(Math.abs(n))} point${Math.round(Math.abs(n)) === 1 ? "" : "s"}`;

function list(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Who to captain, and why, without naming a statistic.
 *
 * The shortlist is already ranked on the upper tail rather than the mean,
 * because the armband doubles a score and is therefore a bet on a big week.
 * That reasoning is worth passing on in plain words — it is the difference
 * between a safe six and a chance of fifteen — without saying "ceiling".
 */
function captainLine(candidates: CaptaincyCandidate[]): string | null {
  const best = candidates[0];
  if (!best) return null;

  const { distribution: d, player } = best;
  const runnerUp = candidates[1];

  // A genuinely close call is worth saying so: the manager may know something
  // about the fixture that the numbers cannot.
  const close =
    runnerUp && Math.abs(d.ceiling - runnerUp.distribution.ceiling) < 0.6;

  const chance =
    d.pHaul >= 0.12
      ? `his chance of a really big score is the best in your team, ${asOdds(d.pHaul)}`
      : "he is the likeliest of your eleven to have a big week";

  return close
    ? `Captain ${player.webName} — ${chance}, though ${runnerUp.player.webName} is almost as good a shout.`
    : `Captain ${player.webName} — ${chance}.`;
}

/**
 * The one caveat worth a sentence, or none.
 *
 * Deliberately at most one, and only when it would change what someone does.
 * A verdict that always ends on a warning trains people to skip the warning.
 */
function cautionLine(
  optimal: OptimisedSquad,
  matchesPlayed: number,
): string | null {
  // Someone in the eleven who may not finish the match. The most actionable
  // caveat there is, because the fix is a bench order.
  //
  // A goalkeeper outranks an outfielder on the same minutes, which is not what
  // ranking by minutes alone does. A keeper who loses his place scores nothing
  // at all, where a midfielder withdrawn at fifty-five has already banked his
  // appearance points and most of his chance of a goal. The analyst made
  // exactly this substitution on its first real run — it flagged a rotating
  // keeper over a 55-minute midfielder — and it was right to.
  const doubtful = optimal.startingXI.filter(
    (p) => p.status === "a" && p.expectedMinutes < 60,
  );
  const parttime =
    doubtful.find((p) => p.position === "GKP") ??
    [...doubtful].sort((a, b) => a.expectedMinutes - b.expectedMinutes)[0];
  if (parttime) {
    return parttime.position === "GKP"
      ? `${parttime.webName} is not starting every week in goal, and a goalkeeper who is left out scores nothing at all.`
      : `${parttime.webName} is only expected to play about ${Math.round(parttime.expectedMinutes)} minutes, so he may not last the game.`;
  }

  // Early season, when every figure rests on a handful of matches. Said once,
  // plainly, rather than as a confidence score nobody can act on.
  if (matchesPlayed > 0 && matchesPlayed < 6) {
    return `Only ${matchesPlayed} games have been played this season, so treat all of this as an early read rather than a settled one.`;
  }

  const leaning = optimal.startingXI.filter(
    (p) => p.dataBasis === "last_season" || p.dataBasis === "price_prior",
  );
  if (leaning.length >= 4) {
    return `${leaning.length} of your eleven have little to go on this season yet, so these are estimates built on last year.`;
  }

  return null;
}

/**
 * The week's decision, in at most three sentences.
 *
 * Ordered by what costs most to get wrong: a player who will not play, then a
 * chip that is scarce and irreversible, then a transfer, then nothing. Only the
 * first match becomes the action.
 */
export function buildVerdict(input: {
  gameweek: number;
  horizon: number;
  matchesPlayed: number;
  optimal: OptimisedSquad;
  captaincy: CaptaincyCandidate[];
  plan: TransferPlan;
  chips: ChipValuation[];
  transfers: TransferBudget;
}): Verdict {
  const { optimal, captaincy, plan, chips, transfers, horizon, gameweek } = input;

  const captain = captainLine(captaincy);
  const caution = cautionLine(optimal, input.matchesPlayed);
  const of = (kind: VerdictKind, action: string): Verdict => ({
    kind,
    action,
    captain,
    caution,
  });

  // 1. Someone in the eleven who is not going to play. Nothing else this week
  //    costs as much, and no projection can fix it.
  const unavailable = optimal.startingXI.filter((p) => p.status !== "a");
  if (unavailable.length > 0) {
    const words = unavailable.map(
      (p) => `${p.webName} is ${STATUS_WORD[p.status] ?? "flagged"}`,
    );
    return of(
      "availability",
      `${list(words)}, and still in your strongest eleven — sort that out before the deadline, because ` +
        `${unavailable.length === 1 ? "he may score nothing at all" : "they may score nothing at all"}.`,
    );
  }

  // 2. A chip is spent once and cannot be earned back, so a week that is
  //    genuinely the best one in sight is worth leading on.
  const chip = chips
    .filter((c) => c.available && c.bestGameweek === gameweek && (c.gain ?? 0) >= 4)
    .sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0))[0];
  if (chip) {
    return of(
      "chip",
      `This is the best week in sight to play your ${chip.label} — it is worth ${points(chip.gain ?? 0)} right now, ` +
        "and no later week in view beats it.",
    );
  }

  // 3. A transfer worth making. The plan already decides whether this week or a
  //    later one is the moment, so a first week with no move means wait.
  const first = plan.moves[0];
  if (plan.gain >= DRAFT_WORTH_IT_POINTS && first) {
    if (first.transfer) {
      return of(
        "transfer",
        `Make one transfer — ${first.transfer.outName} out, ${first.transfer.inName} in — ` +
          `worth ${points(plan.gain)} over ${weeks(horizon)}.`,
      );
    }
    const later = plan.moves.find((m) => m.transfer);
    if (later?.transfer) {
      return of(
        "wait",
        `Save your transfer this week: spending it next week on ${later.transfer.inName} instead is ` +
          `worth ${points(plan.gain)} over ${weeks(horizon)}, and you cannot do both.`,
      );
    }
  }

  // 4. Nothing to do, which is the right answer most weeks and deserves to be
  //    said as confidently as any other.
  const saved =
    transfers.free > 1 ? `, and you already have ${transfers.free} saved up` : "";
  return of(
    "hold",
    `Leave your team alone this week — nothing available is worth more than the transfer it would cost${saved}.`,
  );
}
