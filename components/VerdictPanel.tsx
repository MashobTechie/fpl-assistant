import type { Verdict } from "@/lib/squad/verdict";
import { Card } from "./ui";

/**
 * The answer, before any of the evidence for it.
 *
 * Everything below this on the page is an instrument reading, and all of it
 * leaves the synthesis to the reader. This is the one thing someone opening the
 * app on a Friday night actually came for: what to do before the deadline.
 *
 * It arrives with the numbers rather than with the analyst, so it is here
 * within about two seconds and is here at all without an API key. When the
 * written analysis lands it replaces the text in place — same position, same
 * size, so the page does not reshuffle under someone mid-sentence.
 *
 * At most three sentences, and the third only when there is genuinely a
 * caveat. A summary that always runs to three trains people to stop reading
 * after the first.
 */
export function VerdictPanel({
  verdict,
  analystVerdict,
  gameweek,
}: {
  verdict: Verdict;
  /**
   * The analyst's plain-English version, once it exists. Better written and
   * able to weigh things the engine cannot see, so it wins when present.
   */
  analystVerdict?: string | null;
  gameweek: number;
}) {
  // The colour carries the urgency, so the eye sorts "act now" from "you are
  // fine" before a word is read.
  const tone =
    verdict.kind === "availability"
      ? "text-[--color-pink]"
      : verdict.kind === "hold"
        ? "text-[--color-ink]"
        : "text-[--color-accent]";

  return (
    <Card accent className="p-5 sm:p-7">
      <p className="eyebrow mb-3 text-[10px] text-[--color-ink-faint]">
        Gameweek {gameweek} · what to do
      </p>

      {analystVerdict ? (
        <p className="text-balance text-xl font-semibold leading-snug sm:text-2xl">
          {analystVerdict}
        </p>
      ) : (
        <>
          <p
            className={`text-balance text-xl font-semibold leading-snug sm:text-2xl ${tone}`}
          >
            {verdict.action}
          </p>
          {verdict.captain && (
            <p className="mt-3 text-base leading-relaxed text-[--color-ink] sm:text-lg">
              {verdict.captain}
            </p>
          )}
          {verdict.caution && (
            <p className="mt-3 text-sm leading-relaxed text-[--color-ink-muted]">
              {verdict.caution}
            </p>
          )}
        </>
      )}
    </Card>
  );
}
