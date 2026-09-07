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
export function PlanPanel({ plan }: { plan: TransferPlan }) {
  if (plan.moves.length === 0) return null;

  const worthwhile = plan.gain >= 2;
  const transfers = plan.moves.filter((m) => m.transfer !== null).length;
  const hits = plan.moves.reduce((sum, m) => sum + m.hitCost, 0);

  return (
    <Card className="p-5 sm:p-6">
      <SectionHeading
        hint={`GW${plan.moves[0].gameweek}–${plan.moves[plan.moves.length - 1].gameweek}`}
      >
        The plan
      </SectionHeading>

      <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`numeric font-[family-name:--font-display] text-3xl font-bold leading-none ${
            worthwhile ? "text-[--color-accent]" : "text-[--color-ink-muted]"
          }`}
        >
          {plan.gain >= 0 ? "+" : ""}
          {plan.gain.toFixed(1)}
        </span>
        <span className="text-sm text-[--color-ink-muted]">
          points over leaving the squad alone
          <span className="ml-1.5 text-[--color-ink-faint]">
            ({plan.totalPoints.toFixed(1)} against {plan.doNothingPoints.toFixed(1)})
          </span>
        </span>
      </div>

      {!worthwhile && (
        <p className="mb-4 rounded-lg border border-[--color-cyan]/30 bg-[--color-cyan]/10 px-3.5 py-2.5 text-sm text-[--color-ink-muted]">
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
                      ? "border border-[--color-border-bright] bg-[--color-base]"
                      : "bg-[--color-accent]"
                  }`}
                />
                {!last && <span className="w-px flex-1 bg-[--color-border]" />}
              </div>

              <div className={`flex-1 ${last ? "" : "pb-4"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="eyebrow text-[10px] text-[--color-ink-faint]">
                      GW{m.gameweek}
                    </span>
                    {banking ? (
                      <span className="text-sm text-[--color-ink-muted]">
                        Bank the transfer
                      </span>
                    ) : (
                      <span className="text-sm">
                        <span className="text-[--color-pink]">
                          {m.transfer!.outName}
                        </span>
                        <span className="mx-1.5 text-[--color-ink-faint]">→</span>
                        <span className="font-semibold text-[--color-accent]">
                          {m.transfer!.inName}
                        </span>
                      </span>
                    )}
                    {m.hitCost > 0 && (
                      <span className="eyebrow rounded bg-[--color-pink]/15 px-1.5 py-0.5 text-[9px] text-[--color-pink]">
                        −{m.hitCost} hit
                      </span>
                    )}
                  </span>
                  <span className="numeric shrink-0 text-xs text-[--color-ink-muted]">
                    {m.expectedPoints.toFixed(1)} xPts
                  </span>
                </div>
                <span className="text-[11px] text-[--color-ink-faint]">
                  {m.freeTransfers} free transfer
                  {m.freeTransfers === 1 ? "" : "s"} in hand
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 border-t border-[--color-border] pt-3 text-xs leading-relaxed text-[--color-ink-faint]">
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
