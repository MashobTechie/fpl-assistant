"use client";

import { useSyncExternalStore } from "react";

import { Metric, Tag } from "./ui";

/**
 * The bar that follows the page down.
 *
 * Four things are true all the way through a session — which gameweek, how long
 * is left, what the team is projected to score, and what there is to spend —
 * and before this existed each of them was restated inside three different
 * panels. Holding them in one strip is what frees every panel below to say one
 * thing, and it is why the stat-tile grid is gone: it was this, duplicated.
 *
 * The countdown is the reason this is a client component. It is also the reason
 * the bar is worth its height: a deadline is the only genuinely urgent fact in
 * fantasy football, and "Sat 11:30" makes you do the arithmetic yourself.
 */

function remaining(deadline: string, now: number) {
  const ms = new Date(deadline).getTime() - now;
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return { passed: true as const, text: "Deadline passed", hours: 0 };

  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  // Seconds only appear inside the last hour. Shown earlier they are noise that
  // moves; shown there they are the difference between making the deadline and
  // not, which is exactly when a manager wants to see them move.
  const text =
    days > 0
      ? `${days}d ${hours}h ${String(minutes).padStart(2, "0")}m`
      : hours > 0
        ? `${hours}h ${String(minutes).padStart(2, "0")}m`
        : `${minutes}m ${String(seconds).padStart(2, "0")}s`;

  return { passed: false as const, text, hours: ms / 3_600_000 };
}

/**
 * One clock, subscribed to rather than polled per component.
 *
 * The obvious version — setState in an effect, once a second — is a cascading
 * render by React 19's own lint rule, and it starts a second timer for every
 * component that wants the time. A clock is an external system, so it belongs
 * in the primitive built for external systems. The snapshot is cached between
 * ticks because useSyncExternalStore compares snapshots by identity: returning
 * a fresh Date.now() on every call would re-render forever.
 */
let tick = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribeToClock(onChange: () => void) {
  listeners.add(onChange);
  if (!timer) {
    timer = setInterval(() => {
      tick = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const clockSnapshot = () => (tick ||= Date.now());

/**
 * Null on the server. The server has no clock the client agrees with to the
 * second, so rendering one there is a hydration mismatch on every load.
 */
const clockOnServer = () => null;

function Countdown({ deadline }: { deadline: string }) {
  const now = useSyncExternalStore(
    subscribeToClock,
    clockSnapshot,
    clockOnServer,
  );

  const left = now === null ? null : remaining(deadline, now);

  // Under six hours is the window where waiting for team news stops being free,
  // so that is where the colour changes.
  const tone = !left || left.passed
    ? "neutral"
    : left.hours < 6
      ? "alert"
      : left.hours < 24
        ? "warn"
        : "info";

  return (
    <div className="min-w-0">
      <div className="eyebrow text-[9px] text-ink-faint">
        {left?.passed ? "Gameweek" : "Deadline in"}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {!left?.passed && tone === "alert" && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-pink"
          />
        )}
        <time
          dateTime={deadline}
          title={new Date(deadline).toLocaleString()}
          className={`display text-xl tabular-nums sm:text-2xl ${
            tone === "alert"
              ? "text-pink"
              : tone === "warn"
                ? "text-warn"
                : tone === "info"
                  ? "text-cyan"
                  : "text-ink-muted"
          }`}
        >
          {left ? left.text : "—"}
        </time>
      </div>
    </div>
  );
}

export function Scoreboard({
  gameweek,
  deadline,
  locked,
  projected,
  bank,
  squadValue,
  teamName,
  children,
}: {
  gameweek: number | null;
  /** ISO timestamp of the gameweek deadline, when FPL has published one. */
  deadline: string | null;
  /** True while the gameweek on screen has already kicked off. */
  locked: boolean;
  projected: number | null;
  bank: number | null;
  squadValue: number | null;
  teamName: string | null;
  /** The squad control, so changing squads never leaves the bar. */
  children?: React.ReactNode;
}) {
  return (
    <div className="glass sticky top-0 z-30 border-b">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-2.5 sm:gap-6 sm:px-6">
        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <span className="display grid h-9 w-9 shrink-0 place-items-center rounded-inset bg-accent text-sm text-base shadow-[0_6px_18px_-8px_var(--color-accent)] sm:h-10 sm:w-10 sm:text-base">
            {gameweek ?? "—"}
          </span>
          <div className="min-w-0">
            <div className="eyebrow text-[9px] text-accent">
              {gameweek ? `Gameweek ${gameweek}` : "FPL Assistant"}
            </div>
            <div className="truncate text-[13px] font-semibold text-ink-muted">
              {teamName ?? "No squad yet"}
            </div>
          </div>
        </div>

        {locked ? (
          <Tag tone="info">Locked</Tag>
        ) : deadline ? (
          <Countdown deadline={deadline} />
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-4 sm:gap-7">
          {projected !== null && (
            <Metric
              label="Projected"
              value={projected.toFixed(1)}
              tone="accent"
            />
          )}
          {bank !== null && (
            <Metric label="Bank" value={`£${bank.toFixed(1)}m`} className="hidden sm:block" />
          )}
          {squadValue !== null && (
            <Metric
              label="Value"
              value={`£${squadValue.toFixed(1)}m`}
              className="hidden md:block"
            />
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
