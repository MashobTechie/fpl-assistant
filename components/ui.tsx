import type { ReactNode } from "react";

/**
 * Shared primitives.
 *
 * The colour rules the whole app follows: mint means good or actionable, pink
 * means something is wrong, cyan is information, and everything else is purple.
 * A component that needs emphasis reaches for one of those three, never a new
 * hue — which is what keeps a dense screen of numbers readable.
 *
 * Classes here use the theme utilities (`bg-surface`, `text-ink-muted`) rather
 * than `bg-[--color-surface]`. The bracket form compiles to invalid CSS in
 * Tailwind v4 and is dropped silently; see the note in app/globals.css.
 */

/** The three meanings colour is allowed to carry, plus the absence of one. */
export type Tone = "neutral" | "accent" | "info" | "alert" | "warn";

const TONE_INK: Record<Tone, string> = {
  neutral: "text-ink",
  accent: "text-accent",
  info: "text-cyan",
  alert: "text-pink",
  warn: "text-warn",
};

const TONE_VAR: Record<Tone, string> = {
  neutral: "var(--color-ink-faint)",
  accent: "var(--color-accent)",
  info: "var(--color-cyan)",
  alert: "var(--color-pink)",
  warn: "var(--color-warn)",
};

export function Card({
  children,
  className = "",
  accent = false,
  tone = "neutral",
  /** Skip the mount animation for something that re-renders constantly. */
  still = false,
}: {
  children: ReactNode;
  className?: string;
  /** Adds the league's gradient rule along the top edge. One per screen. */
  accent?: boolean;
  /** Tints the border, for a panel whose whole content is a warning. */
  tone?: Tone;
  still?: boolean;
}) {
  return (
    <section
      style={tone === "neutral" ? undefined : { borderColor: `color-mix(in srgb, ${TONE_VAR[tone]} 45%, var(--color-border))` }}
      className={`relative overflow-hidden rounded-panel border border-border bg-surface shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_24px_48px_-28px_rgba(0,0,0,0.9)] ${
        still ? "" : "animate-rise"
      } ${className}`}
    >
      {accent && (
        <span aria-hidden className="pl-rule absolute inset-x-0 top-0 h-[3px]" />
      )}
      {children}
    </section>
  );
}

export function SectionHeading({
  children,
  hint,
  tone = "accent",
}: {
  children: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="eyebrow flex items-center gap-2.5 text-[13px] text-ink">
        <span
          aria-hidden
          className="h-3.5 w-[3px] rounded-full"
          style={{ background: TONE_VAR[tone] }}
        />
        {children}
      </h2>
      {hint && (
        <span className="numeric text-xs font-medium text-ink-muted">{hint}</span>
      )}
    </div>
  );
}

/**
 * A short label pill. Carries state, never decoration — "ACT NOW", "LOCKED",
 * "CACHED" — so it is always worth the ink it costs.
 */
export function Tag({
  children,
  tone = "neutral",
  solid = false,
}: {
  children: ReactNode;
  tone?: Tone;
  solid?: boolean;
}) {
  const color = TONE_VAR[tone];
  return (
    <span
      className="eyebrow inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[10px]"
      style={
        solid
          ? { background: color, color: "var(--color-base)" }
          : {
              color,
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 35%, transparent)`,
            }
      }
    >
      {children}
    </span>
  );
}

/**
 * Fixture difficulty: opponent, venue and FDR colour in one glyph.
 *
 * Away fixtures are outlined rather than filled. Managers scan these in a
 * block, and shape reads faster than a trailing character does.
 */
export function FdrPill({
  opponent,
  home,
  fdr,
}: {
  opponent: string;
  home: boolean;
  fdr: number;
}) {
  const level = Math.min(5, Math.max(1, fdr));
  const color = `var(--color-fdr-${level})`;
  // 1 and 2 are bright mint/green; dark text is the only legible choice there.
  const onLight = level <= 2;

  return (
    <span
      title={`${opponent} ${home ? "at home" : "away"} — difficulty ${fdr}/5`}
      className="numeric inline-flex min-w-[3.5rem] items-center justify-center rounded-md px-1.5 py-1 text-[11px] font-bold tracking-wide"
      style={
        home
          ? { background: color, color: onLight ? "#16001a" : "#fff" }
          : {
              background: "transparent",
              color: onLight ? color : "#fff",
              boxShadow: `inset 0 0 0 1.5px ${color}`,
            }
      }
    >
      {opponent}
    </span>
  );
}

/**
 * Confidence is central to reading these projections honestly, so it gets a
 * bar rather than a decimal buried in a column — the length is comparable at a
 * glance in a way "0.77" is not.
 */
export function ConfidenceBadge({ value }: { value: number }) {
  const label = value >= 0.7 ? "High" : value >= 0.45 ? "Medium" : "Low";
  const color =
    value >= 0.7
      ? "var(--color-accent)"
      : value >= 0.45
        ? "var(--color-warn)"
        : "var(--color-pink)";

  return (
    <span
      className="inline-flex items-center gap-2"
      title={`Model confidence ${(value * 100).toFixed(0)}%`}
    >
      <span
        aria-hidden
        className="h-1.5 w-8 overflow-hidden rounded-full bg-surface-3"
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.round(value * 100)}%`, background: color }}
        />
      </span>
      <span className="text-[11px] font-semibold" style={{ color }}>
        {label}
      </span>
    </span>
  );
}

/** A proportion, shown as length. Used wherever a percentage would be read. */
export function Meter({
  value,
  tone = "accent",
  className = "",
}: {
  /** 0 to 1. Clamped, so a caller cannot overflow the track. */
  value: number;
  tone?: Tone;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span
      aria-hidden
      className={`block h-1.5 overflow-hidden rounded-full bg-surface-3 ${className}`}
    >
      <span
        className="block h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, background: TONE_VAR[tone] }}
      />
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "accent";
}) {
  return (
    <div className="rounded-inset border border-border bg-surface-2 px-3.5 py-3">
      <div className="eyebrow text-[10px] text-ink-faint">{label}</div>
      <div
        className={`display mt-1.5 text-2xl ${
          tone === "accent" ? "text-accent" : "text-ink"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

/**
 * A scoreboard reading: label above, number below, nothing else.
 *
 * Deliberately smaller and chromeless next to StatTile. These sit in the bar
 * that follows the page down, where a bordered box every 90px would read as a
 * row of buttons.
 */
export function Metric({
  label,
  value,
  tone = "neutral",
  sub,
  className = "",
}: {
  label: string;
  value: string;
  tone?: Tone;
  sub?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="eyebrow text-[9px] text-ink-faint">{label}</div>
      <div className={`display mt-1 truncate text-xl sm:text-2xl ${TONE_INK[tone]}`}>
        {value}
      </div>
      {sub && <div className="truncate text-[11px] text-ink-faint">{sub}</div>}
    </div>
  );
}

export function Severity({ level }: { level: "low" | "medium" | "high" }) {
  const tone: Tone =
    level === "high" ? "alert" : level === "medium" ? "warn" : "neutral";
  return <Tag tone={tone}>{level}</Tag>;
}

/** Primary action. Mint on purple is the highest-contrast pair in the palette. */
export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "info";
  size?: "sm" | "md";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const sizing = size === "sm" ? "px-3 py-2 text-sm" : "px-4 py-2.5";
  const styles = {
    primary:
      "bg-accent text-base shadow-[0_6px_20px_-8px_var(--color-accent)] hover:bg-accent-dim active:translate-y-px",
    ghost:
      "border border-border text-ink-muted hover:border-border-bright hover:text-ink",
    info: "bg-cyan/15 text-cyan ring-1 ring-cyan/40 hover:bg-cyan/25",
  }[variant];
  return (
    <button className={`${base} ${sizing} ${styles} ${className}`} {...props}>
      {children}
    </button>
  );
}

/** Segmented control — the tab pattern used across the FPL app. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex rounded-xl border border-border bg-base p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              active
                ? "bg-accent text-base"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The desk's tab rail.
 *
 * This replaces a nine-panel vertical scroll, which is the real reason it
 * exists: every one of those panels was equally loud, so the decision at the
 * top competed with the chip valuations at the bottom. One view at a time makes
 * the verdict the page and everything else a place you choose to go.
 *
 * A tab may carry a badge — the plan's gain, a chip worth playing, an analysis
 * that just landed — because the cost of hiding a panel is that you stop
 * noticing when it has something to say.
 */
export function TabRail<T extends string>({
  tabs,
  value,
  onChange,
  idPrefix,
}: {
  tabs: { value: T; label: string; badge?: ReactNode; badgeTone?: Tone }[];
  value: T;
  onChange: (v: T) => void;
  /** Ties each tab to its panel for assistive tech. */
  idPrefix: string;
}) {
  return (
    <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">
      <div
        role="tablist"
        aria-label="Evidence"
        className="flex min-w-max items-stretch gap-1 border-b border-border"
      >
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${t.value}`}
              aria-selected={active}
              aria-controls={`${idPrefix}-panel-${t.value}`}
              onClick={() => onChange(t.value)}
              className={`relative flex items-center gap-2 px-3.5 pb-3 pt-2 text-sm font-semibold transition sm:px-4 ${
                active ? "text-ink" : "text-ink-faint hover:text-ink-muted"
              }`}
            >
              {t.label}
              {t.badge !== undefined && t.badge !== null && (
                <span
                  className="numeric rounded px-1.5 py-0.5 text-[10px] font-bold"
                  style={{
                    color: TONE_VAR[t.badgeTone ?? "info"],
                    background: `color-mix(in srgb, ${TONE_VAR[t.badgeTone ?? "info"]} 16%, transparent)`,
                  }}
                >
                  {t.badge}
                </span>
              )}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-accent"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The panel a tab controls. Rises on mount, so switching tabs reads as motion. */
export function TabPanel({
  id,
  labelledBy,
  children,
}: {
  id: string;
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={id}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className="animate-rise flex flex-col gap-5 focus:outline-none"
    >
      {children}
    </div>
  );
}
