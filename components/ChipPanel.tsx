import type { ChipValuation, TransferBudget } from "@/lib/squad/chips";
import { Card, SectionHeading } from "./ui";

/**
 * When to play each chip.
 *
 * A chip is a timing decision above everything else — you get one, it is gone,
 * and playing Bench Boost in an ordinary week is how most managers waste it. So
 * the panel answers "when", not "what is it worth now": every chip is valued in
 * each gameweek of the horizon, and the peak is the thing the eye should land
 * on.
 *
 * Two deliberate restraints:
 *
 * Bars run from zero. Chip values across five gameweeks are often nearly flat —
 * measured 10.1, 10.6, 9.8, 11.0, 9.6 — and five near-identical bars is the
 * honest picture: timing barely matters here. A truncated axis would turn a
 * one-point spread into a dramatic peak and talk someone into burning a chip.
 *
 * Free Hit and Wildcard get no bars at all. Their value depends on a squad the
 * manager does not own, so there is no number to plot, and a row of zero-height
 * bars would read as "worthless" rather than "not computable". They carry the
 * condition that actually triggers them instead.
 */

interface WeekValue {
  gameweek: number;
  gain: number;
  doubles: number;
  blanks: number;
}

/**
 * Value across the horizon.
 *
 * Height carries the number; colour only marks the peak, since encoding
 * magnitude twice would be redundant. The peak is the only bar labelled —
 * a figure above every bar is noise at this size.
 */
function HorizonBars({
  weeks,
  currentGameweek,
  peakGameweek,
}: {
  weeks: WeekValue[];
  currentGameweek: number;
  peakGameweek: number | null;
}) {
  const max = Math.max(...weeks.map((w) => w.gain), 0.1);

  return (
    <div className="mt-3 flex items-end gap-[3px]" role="img"
      aria-label={weeks
        .map((w) => `Gameweek ${w.gameweek}: ${w.gain.toFixed(1)} points`)
        .join(". ")}
    >
      {weeks.map((w) => {
        const isPeak = w.gameweek === peakGameweek;
        const isNow = w.gameweek === currentGameweek;
        return (
          <div key={w.gameweek} className="flex flex-1 flex-col items-center gap-1">
            <span
              className={`numeric text-[10px] font-bold leading-none ${
                isPeak ? "text-[--color-mark-peak]" : "text-transparent"
              }`}
              aria-hidden
            >
              {w.gain.toFixed(1)}
            </span>
            <div
              title={`GW${w.gameweek}: ${w.gain.toFixed(1)} pts${
                w.doubles ? ` · ${w.doubles} double fixtures` : ""
              }${w.blanks ? ` · ${w.blanks} blanks` : ""}`}
              className="flex w-full items-end justify-center"
              style={{ height: 44 }}
            >
              <span
                className="w-full rounded-t transition-[height]"
                style={{
                  height: `${Math.max(3, (w.gain / max) * 44)}px`,
                  background: isPeak
                    ? "var(--color-mark-peak)"
                    : "var(--color-mark)",
                }}
              />
            </div>
            <span
              className={`numeric text-[10px] leading-none ${
                isNow
                  ? "font-bold text-[--color-cyan]"
                  : "text-[--color-ink-faint]"
              }`}
            >
              {w.gameweek}
            </span>
            <span className="h-3 text-[9px] leading-none">
              {w.doubles > 0 && (
                <span className="font-bold text-[--color-cyan]" title={`${w.doubles} players have two fixtures`}>
                  DGW
                </span>
              )}
              {w.blanks > 0 && w.doubles === 0 && (
                <span className="font-bold text-[--color-pink]" title={`${w.blanks} players have no fixture`}>
                  BGW
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ChipCard({
  chip,
  currentGameweek,
}: {
  chip: ChipValuation;
  currentGameweek: number;
}) {
  const plottable = chip.gain !== null;
  const playNow = chip.bestGameweek === currentGameweek;

  return (
    <div
      className={`rounded-xl border p-4 ${
        chip.available
          ? "border-[--color-border] bg-[--color-surface-2]"
          : "border-[--color-border] bg-[--color-base] opacity-55"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="eyebrow text-[11px] text-[--color-ink]">{chip.label}</h3>
        {chip.available ? (
          plottable && (
            <span className="numeric text-sm font-bold text-[--color-ink]">
              {chip.gain?.toFixed(1)}
              <span className="ml-1 text-[10px] font-normal text-[--color-ink-faint]">
                now
              </span>
            </span>
          )
        ) : (
          <span className="eyebrow text-[9px] text-[--color-ink-faint]">spent</span>
        )}
      </div>

      {chip.available && plottable && (
        <HorizonBars
          weeks={chip.byGameweek}
          currentGameweek={currentGameweek}
          peakGameweek={chip.bestGameweek}
        />
      )}

      <p className="mt-3 text-xs leading-relaxed text-[--color-ink-muted]">
        {chip.available ? chip.timing : "Already played this season."}
      </p>

      {chip.available && (
        <p
          className={`mt-2 text-xs font-semibold ${
            playNow ? "text-[--color-mark-peak]" : "text-[--color-cyan]"
          }`}
        >
          {playNow
            ? "→ This is the week"
            : chip.bestGameweek
              ? `→ Hold until GW${chip.bestGameweek}`
              : "→ Hold"}
        </p>
      )}
    </div>
  );
}

export function ChipPanel({
  chips,
  transfers,
  gameweek,
}: {
  chips: ChipValuation[];
  transfers: TransferBudget;
  gameweek: number;
}) {
  const remaining = chips.filter((c) => c.available).length;

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading hint={`${remaining} of ${chips.length} left`}>
        Chips &amp; transfers
      </SectionHeading>

      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-[--color-ink-muted]">
        <span className="eyebrow rounded bg-[--color-surface-2] px-2 py-1 text-[10px] text-[--color-accent]">
          {transfers.free} free transfer{transfers.free === 1 ? "" : "s"}
        </span>
        Anything beyond that costs {transfers.hitCost} points.
        {transfers.inferred && (
          <span className="text-[--color-ink-faint]">
            Counted from your transfer history — FPL does not publish this
            without your login, so check it against the site.
          </span>
        )}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {chips.map((c) => (
          <ChipCard key={c.chip} chip={c} currentGameweek={gameweek} />
        ))}
      </div>
    </Card>
  );
}
