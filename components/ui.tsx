import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[--color-border] bg-[--color-surface] ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionHeading({
  children,
  hint,
}: {
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-[--color-ink-muted]">
        {children}
      </h2>
      {hint && <span className="text-xs text-[--color-ink-faint]">{hint}</span>}
    </div>
  );
}

/** Fixture difficulty pill: opponent, venue, and FDR colour in one glyph. */
export function FdrPill({
  opponent,
  home,
  fdr,
}: {
  opponent: string;
  home: boolean;
  fdr: number;
}) {
  const background = `var(--color-fdr-${Math.min(5, Math.max(1, fdr))})`;
  return (
    <span
      title={`${opponent} ${home ? "at home" : "away"} — difficulty ${fdr}/5`}
      className="numeric inline-flex min-w-[3.25rem] items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold text-white/95"
      style={{ background }}
    >
      {opponent}
      {home ? "" : " ·a"}
    </span>
  );
}

/**
 * Confidence is central to reading these projections honestly, so it gets a
 * visual weight rather than being buried as a decimal.
 */
export function ConfidenceBadge({ value }: { value: number }) {
  const label = value >= 0.7 ? "High" : value >= 0.45 ? "Medium" : "Low";
  const color =
    value >= 0.7
      ? "var(--color-accent)"
      : value >= 0.45
        ? "var(--color-warn)"
        : "var(--color-danger)";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium"
      style={{ color }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-surface-2] px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-[--color-ink-faint]">
        {label}
      </div>
      <div className="numeric mt-0.5 text-lg font-semibold text-[--color-ink]">
        {value}
      </div>
      {sub && <div className="text-xs text-[--color-ink-muted]">{sub}</div>}
    </div>
  );
}

export function Severity({ level }: { level: "low" | "medium" | "high" }) {
  const color =
    level === "high"
      ? "var(--color-danger)"
      : level === "medium"
        ? "var(--color-warn)"
        : "var(--color-ink-muted)";
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color, border: `1px solid ${color}44` }}
    >
      {level}
    </span>
  );
}
