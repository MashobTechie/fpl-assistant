import type { ProjectionsResponse } from "@/lib/types";
import { Card, SectionHeading, StatTile } from "./ui";

/**
 * The answer to "should I make these moves?", in numbers, before the analyst.
 *
 * Arrives with the projections in a couple of seconds, so the manager has the
 * verdict — legal, what it costs, what it earns — while the written reasoning
 * is still coming. The net figures already carry any hit, because a draft that
 * looks like a gain before the −4 and a loss after it is the most common way
 * these decisions go wrong.
 */
export function DraftVerdict({
  draft,
  horizon,
  onBack,
  onEdit,
}: {
  draft: NonNullable<ProjectionsResponse["draft"]>;
  horizon: number;
  onBack: () => void;
  onEdit: () => void;
}) {
  const c = draft.comparison;
  const worth = c.netHorizon >= 2;
  const marginal = !worth && c.netHorizon > -0.5;
  const sign = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;

  return (
    <Card accent className="p-5 sm:p-6">
      <SectionHeading hint="not saved — nothing changes in FPL">
        Your draft
      </SectionHeading>

      <p className="mb-4 flex items-center gap-2 text-sm">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[--color-accent] text-[11px] font-bold text-[--color-base]">
          ✓
        </span>
        <span>
          You can make {draft.moves.length === 1 ? "this move" : "these moves"} in
          the real app
          {draft.hitCost > 0 ? `, for a −${draft.hitCost} hit.` : " with no hit."}
        </span>
      </p>

      <ul className="mb-4 flex flex-col gap-1.5">
        {draft.moves.map((m) => (
          <li key={m.out.playerId} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-[--color-pink]">{m.out.name}</span>
            <span className="text-[11px] text-[--color-ink-faint]">£{m.out.price.toFixed(1)}m</span>
            <span className="text-[--color-ink-faint]">→</span>
            <span className="font-semibold text-[--color-accent]">{m.in.name}</span>
            <span className="text-[11px] text-[--color-ink-faint]">
              {m.in.team} · £{m.in.price.toFixed(1)}m
            </span>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="This week"
          value={sign(c.netThisWeek)}
          sub={`${c.thisWeek.before} → ${c.thisWeek.after}`}
        />
        <StatTile
          label={`Next ${horizon} GW`}
          value={sign(c.netHorizon)}
          sub={`${c.horizon.before} → ${c.horizon.after}`}
          tone={worth ? "accent" : "default"}
        />
        <StatTile label="Hit" value={draft.hitCost ? `−${draft.hitCost}` : "0"} sub={`${draft.freeTransfers} free`} />
        <StatTile label="Bank after" value={`£${draft.bankAfter.toFixed(1)}m`} />
      </div>

      <p
        className={`mt-4 rounded-lg px-3.5 py-2.5 text-sm ${
          worth
            ? "bg-[--color-accent]/10 text-[--color-ink]"
            : marginal
              ? "bg-[--color-cyan]/10 text-[--color-ink-muted]"
              : "bg-[--color-pink]/10 text-[--color-ink]"
        }`}
      >
        {worth
          ? `Worth doing on the numbers: ${sign(c.netHorizon)} over ${horizon} gameweeks after any hit.`
          : marginal
            ? "About level. Not worth spending a transfer on — banking it keeps the option for a better move."
            : `Costs you ${Math.abs(c.netHorizon).toFixed(1)} over ${horizon} gameweeks${draft.hitCost ? " once the hit is counted" : ""}. The squad is better as it is.`}{" "}
        <span className="text-[--color-ink-faint]">Best lineup each week, before vs after.</span>
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-[--color-border] px-3.5 py-2 text-sm font-medium text-[--color-ink-muted] transition hover:border-[--color-cyan] hover:text-[--color-cyan]"
        >
          Change the moves
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-[--color-border] px-3.5 py-2 text-sm font-medium text-[--color-ink-muted] transition hover:border-[--color-border-bright] hover:text-[--color-ink]"
        >
          Back to my squad
        </button>
      </div>
    </Card>
  );
}
