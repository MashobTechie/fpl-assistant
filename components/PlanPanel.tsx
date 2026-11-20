import type { TransferPlan } from "@/lib/squad/planner";
import { Card, SectionHeading } from "./ui";

/**
 * The next several gameweeks as one plan, rather than this week's best move.
 *
 * An unused free transfer banks, so the weeks are not independent decisions and
 * a list of good moves is not a plan. The sequence is numbered because the
 * order genuinely carries information here — banking in one week is what pays
 * for a double move in the next — which is the one thing a ranked list of
 * transfers can never show.
 *
 * The comparison against leaving the squad alone is the headline, because that
 * is the decision most weeks actually turn on. A plan worth two points over
 * five gameweeks is a plan not worth making.
 */
export function PlanPanel({
  plan,
  onTry,
}: {
  plan: TransferPlan;
  /**
   * Load this week's planned move into the transfer sandbox. Absent when
   * there is nothing to load it into — a manual squad, or a locked gameweek.
   */
  onTry?: (transfer: { out: number; in: number }) => void;
}) {
  if (plan.moves.length === 0) return null;

  const worthwhile = plan.gain >= 2;
  const transfers = plan.moves.filter((m) => m.transfer !== null).length;
  const hits = plan.moves.reduce((sum, m) => sum + m.hitCost, 0);
  // Only the first week's move can be tried: a draft belongs to the deadline
  // that has not passed, and the later weeks are conditional on it anyway.
  const tryable = plan.moves[0].transfer;

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading
        hint={`GW${plan.moves[0].gameweek}–${plan.moves[plan.moves.length - 1].gameweek}`}
      >
        The plan
      </SectionHeading>

      <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`numeric font-display text-3xl font-bold leading-none ${
            worthwhile ? "text-accent" : "text-ink-muted"
          }`}
        >
          {plan.gain >= 0 ? "+" : ""}
          {plan.gain.toFixed(1)}
        </span>
        <span className="text-sm text-ink-muted">
          points over leaving the squad alone
          <span className="ml-1.5 text-ink-faint">
            ({plan.totalPoints.toFixed(1)} against {plan.doNothingPoints.toFixed(1)})
          </span>
        </span>
      </div>

      {!worthwhile && (
        <p className="mb-4 rounded-lg border border-cyan/30 bg-cyan/10 px-3.5 py-2.5 text-sm text-ink-muted">
          Barely worth the moves. A plan worth this little over five gameweeks
          is a reason to hold, not a reason to act.
        </p>
      )}

      <ol className="flex flex-col">
        {plan.moves.map((m, i) => {
          const last = i === plan.moves.length - 1;
          const banking = m.transfer === null;
          return (
            <li key={m.gameweek} className="flex gap-3.5">
              {/* A spine, because this is a sequence and not a ranking. */}
              <div className="flex flex-col items-center">
                <span
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    banking
                      ? "border border-border-bright bg-base"
                      : "bg-accent"
                  }`}
                />
                {!last && <span className="w-px flex-1 bg-border" />}
              </div>

              <div className={`flex-1 ${last ? "" : "pb-4"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="eyebrow text-[10px] text-ink-faint">
                      GW{m.gameweek}
                    </span>
                    {banking ? (
                      <span className="text-sm text-ink-muted">
                        Bank the transfer
                      </span>
                    ) : (
                      <span className="text-sm">
                        <span className="text-pink">
                          {m.transfer!.outName}
                        </span>
                        <span className="mx-1.5 text-ink-faint">→</span>
                        <span className="font-semibold text-accent">
                          {m.transfer!.inName}
                        </span>
                      </span>
                    )}
                    {m.hitCost > 0 && (
                      <span className="eyebrow rounded bg-pink/15 px-1.5 py-0.5 text-[9px] text-pink">
                        −{m.hitCost} hit
                      </span>
                    )}
                  </span>
                  <span className="numeric shrink-0 text-xs text-ink-muted">
                    {m.expectedPoints.toFixed(1)} xPts
                  </span>
                </div>
                {/* One row, because the button and the free-transfer count
                    were both inline and ran into each other: "Try this
                    move1 free transfer in hand". */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {/* The plan was already computed; making the manager re-find
                      these two names in the picker is busywork. */}
                  {i === 0 && onTry && tryable && (
                    <button
                      type="button"
                      onClick={() =>
                        onTry({ out: tryable.outId, in: tryable.inId })
                      }
                      className="rounded-lg bg-cyan/15 px-2.5 py-1 text-[11px] font-semibold text-cyan ring-1 ring-cyan/40 transition hover:bg-cyan/25"
                    >
                      Try this move
                    </button>
                  )}
                  <span className="text-[11px] text-ink-faint">
                    {m.freeTransfers} free transfer
                    {m.freeTransfers === 1 ? "" : "s"} in hand
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-ink-faint">
        {transfers} transfer{transfers === 1 ? "" : "s"} across{" "}
        {plan.moves.length} gameweeks
        {hits > 0 ? `, costing ${hits} points in hits` : ", none taking a hit"}.
        This is the best sequence the planner examined, not a proof that none is
        better — the further out a move sits, the more likely something changes
        first.
      </p>
    </Card>
  );
}
