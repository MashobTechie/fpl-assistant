import type { ReactNode } from "react";

/**
 * Shared primitives.
 *
 * The colour rules the whole app follows: mint means good or actionable, pink
 * means something is wrong, cyan is information, and everything else is purple.
 * A component that needs emphasis reaches for one of those three, never a new
 * hue — which is what keeps a dense screen of numbers readable.
 */

export function Card({
  children,
  className = "",
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  /** Adds the league's gradient rule along the top edge. One per screen. */
  accent?: boolean;
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border border-[--color-border] bg-[--color-surface] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_18px_40px_-24px_rgba(0,0,0,0.8)] ${className}`}
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
}: {
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="eyebrow flex items-center gap-2.5 text-[13px] text-[--color-ink]">
        <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-[--color-accent]" />
        {children}
      </h2>
      {hint && (
        <span className="numeric text-xs font-medium text-[--color-ink-muted]">
          {hint}
        </span>
      )}
    </div>
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
        className="h-1.5 w-8 overflow-hidden rounded-full bg-[--color-surface-3]"
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
    <div className="rounded-xl border border-[--color-border] bg-[--color-surface-2] px-3.5 py-3">
      <div className="eyebrow text-[10px] text-[--color-ink-faint]">{label}</div>
      <div
        className={`numeric mt-1.5 text-2xl font-bold leading-none ${
          tone === "accent" ? "text-[--color-accent]" : "text-[--color-ink]"
        }`}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-xs text-[--color-ink-muted]">{sub}</div>
      )}
    </div>
  );
}

export function Severity({ level }: { level: "low" | "medium" | "high" }) {
  const color =
    level === "high"
      ? "var(--color-pink)"
      : level === "medium"
        ? "var(--color-warn)"
        : "var(--color-ink-faint)";
  return (
    <span
      className="eyebrow rounded px-1.5 py-1 text-[10px]"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      {level}
    </span>
  );
}

/** Primary action. Mint on purple is the highest-contrast pair in the palette. */
export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-[--color-accent] text-[--color-base] hover:bg-[--color-accent-dim] active:translate-y-px"
      : "border border-[--color-border] text-[--color-ink-muted] hover:border-[--color-border-bright] hover:text-[--color-ink]";
  return (
    <button className={`${base} ${styles} ${className}`} {...props}>
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
      className="inline-flex rounded-xl border border-[--color-border] bg-[--color-base] p-1"
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
                ? "bg-[--color-accent] text-[--color-base]"
                : "text-[--color-ink-muted] hover:text-[--color-ink]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
