import type { ReactNode } from "react";

import type { Verdict, VerdictKind } from "@/lib/squad/verdict";
import { Tag, type Tone } from "./ui";

/**
 * The answer, before any of the evidence for it.
 *
 * Everything behind the tabs below is an instrument reading, and all of it
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
 *
 * Deliberately not a Card. Every other panel is a card, so the one thing that
 * must not look like a panel among panels gets its own chrome: a full-bleed
 * slab, a spine in the tone colour, and the largest type on the screen.
 */

const KIND_TONE: Record<VerdictKind, Tone> = {
  availability: "alert",
  chip: "info",
  transfer: "accent",
  wait: "warn",
  hold: "neutral",
};

/** The word for the state, in the imperative where there is something to do. */
const KIND_LABEL: Record<VerdictKind, string> = {
  availability: "Problem to fix",
  chip: "Chip week",
  transfer: "Act before the deadline",
  wait: "Wait and see",
  hold: "Nothing to do",
};

const TONE_COLOR: Record<Tone, string> = {
  neutral: "var(--color-border-bright)",
  accent: "var(--color-accent)",
  info: "var(--color-cyan)",
  alert: "var(--color-pink)",
  warn: "var(--color-warn)",
};

export function TheCall({
  verdict,
  analystVerdict,
  gameweek,
  action,
}: {
  verdict: Verdict;
  /**
   * The analyst's plain-English version, once it exists. Better written and
   * able to weigh things the engine cannot see, so it wins when present.
   */
  analystVerdict?: string | null;
  gameweek: number;
  /** The one button that acts on this call. */
  action?: ReactNode;
}) {
  const tone = KIND_TONE[verdict.kind];
  const color = TONE_COLOR[tone];

  return (
    <section
      className="animate-rise relative overflow-hidden rounded-panel border border-border bg-surface shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_30px_60px_-30px_rgba(0,0,0,0.95)]"
      style={{ borderColor: `color-mix(in srgb, ${color} 40%, var(--color-border))` }}
    >
      <span aria-hidden className="pl-rule absolute inset-x-0 top-0 h-[3px]" />

      {/* A wash of the tone colour from the spine, so urgency is legible before
          a word is read — and gone entirely when there is nothing to do. */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background: `radial-gradient(28rem 16rem at 0% 0%, color-mix(in srgb, ${color} 13%, transparent), transparent 70%)`,
        }}
      />
      <span
        aria-hidden
        className="absolute bottom-0 left-0 top-[3px] w-[3px]"
        style={{ background: color }}
      />

      <div className="relative p-5 pl-6 sm:p-8 sm:pl-9">
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <Tag tone={tone} solid={tone !== "neutral"}>
            {KIND_LABEL[verdict.kind]}
          </Tag>
          <span className="eyebrow text-[10px] text-ink-faint">
            Gameweek {gameweek}
          </span>
          <span aria-hidden className="h-3 w-px bg-border" />
          <span className="eyebrow text-[10px] text-ink-faint">
            {analystVerdict ? "Analyst's read" : "Computed"}
          </span>
        </div>

        {analystVerdict ? (
          <p className="text-balance text-xl font-semibold leading-snug sm:text-[1.6rem] sm:leading-[1.35]">
            {analystVerdict}
          </p>
        ) : (
          <>
            <p
              className="text-balance text-xl font-semibold leading-snug sm:text-[1.6rem] sm:leading-[1.35]"
              style={{ color: tone === "neutral" ? undefined : color }}
            >
              {verdict.action}
            </p>
            {verdict.captain && (
              <p className="mt-3 text-base leading-relaxed text-ink sm:text-lg">
                {verdict.captain}
              </p>
            )}
            {verdict.caution && (
              <p className="mt-3 flex gap-2.5 text-sm leading-relaxed text-ink-muted">
                <span aria-hidden className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-warn" />
                {verdict.caution}
              </p>
            )}
          </>
        )}

        {action && <div className="mt-6 flex flex-wrap items-center gap-3">{action}</div>}
      </div>
    </section>
  );
}
