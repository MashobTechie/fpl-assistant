import type { CaptaincyCandidate } from "@/lib/squad/optimizer";
import { Card, SectionHeading } from "./ui";

/**
 * Who to captain, shown as a range rather than a number.
 *
 * The armband doubles a score, so it is a bet on the upper tail — and a single
 * projected figure hides exactly the thing that decides it. Two players can
 * average the same and be completely different bets, so each candidate is drawn
 * as the span from a bad week to a good one, with the average marked inside it.
 *
 * Ranked on ceiling rather than average, which is the ranking that sometimes
 * disagrees with the lineup table above. That disagreement is the point of the
 * panel: the best player to start is not always the best player to captain.
 */
export function CaptaincyPanel({
  candidates,
  gameweek,
}: {
  candidates: CaptaincyCandidate[];
  gameweek: number;
}) {
  if (candidates.length === 0) return null;

  // One scale across every candidate, so the bars are comparable. Ceilings
  // drawn against a shared maximum are the only way a longer bar means more.
  const max = Math.max(...candidates.map((c) => c.distribution.ceiling), 1);

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading hint={`GW${gameweek} · 4,000 simulations each`}>
        Captaincy
      </SectionHeading>

      <p className="mb-4 text-sm leading-relaxed text-[--color-ink-muted]">
        The armband doubles the score, so it is a bet on the good week rather
        than the average one. The bar runs from a bad week to a good one, and
        the mark is the average.
      </p>

      <ul className="flex flex-col gap-3">
        {candidates.map((c, i) => {
          const d = c.distribution;
          const left = (d.floor / max) * 100;
          const width = ((d.ceiling - d.floor) / max) * 100;
          const meanAt = (d.mean / max) * 100;
          const top = i === 0;

          return (
            <li key={c.player.playerId} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <span className={top ? "font-semibold" : ""}>
                    {c.player.webName}
                  </span>
                  <span className="text-[11px] text-[--color-ink-faint]">
                    {c.player.team}
                  </span>
                  {top && (
                    <span className="eyebrow rounded bg-[--color-accent]/15 px-1.5 py-0.5 text-[9px] text-[--color-accent]">
                      highest ceiling
                    </span>
                  )}
                </span>
                <span className="numeric shrink-0 text-xs text-[--color-ink-muted]">
                  <span className="font-semibold text-[--color-ink]">
                    {d.floor.toFixed(1)}–{d.ceiling.toFixed(1)}
                  </span>
                  <span className="ml-2 text-[--color-ink-faint]">
                    avg {d.mean.toFixed(1)}
                  </span>
                </span>
              </div>

              <div
                className="relative h-4 w-full overflow-hidden rounded bg-[--color-base]"
                title={`${c.player.webName}: bad week ${d.floor}, average ${d.mean}, good week ${d.ceiling}. Haul ${(d.pHaul * 100).toFixed(0)}%, blank ${(d.pBlank * 100).toFixed(0)}%.`}
              >
                <span
                  className="absolute inset-y-0 rounded"
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 1)}%`,
                    background: top
                      ? "var(--color-mark-peak)"
                      : "var(--color-mark)",
                  }}
                />
                {/* The average, marked inside its own range. */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-[2px] bg-[--color-base]"
                  style={{ left: `${meanAt}%` }}
                />
              </div>

              <div className="flex gap-4 text-[11px] text-[--color-ink-faint]">
                <span>
                  <span className="numeric font-semibold text-[--color-accent]">
                    {(d.pHaul * 100).toFixed(0)}%
                  </span>{" "}
                  chance of 10+
                </span>
                <span>
                  <span
                    className={`numeric font-semibold ${
                      d.pBlank > 0.15 ? "text-[--color-pink]" : "text-[--color-ink-muted]"
                    }`}
                  >
                    {(d.pBlank * 100).toFixed(0)}%
                  </span>{" "}
                  chance of 2 or fewer
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
