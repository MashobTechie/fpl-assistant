import type { PlayerProjection } from "@/lib/projections/engine";
import { ConfidenceBadge, FdrPill } from "./ui";

function BasisNote({ basis }: { basis: PlayerProjection["dataBasis"] }) {
  if (basis === "current_season") return null;
  const text =
    basis === "price_prior" ? "no PL history" : "last season's numbers";
  return (
    <span className="ml-1.5 text-[11px] text-[--color-ink-faint]">({text})</span>
  );
}

function Row({
  player,
  captainId,
  viceId,
}: {
  player: PlayerProjection;
  captainId?: number;
  viceId?: number;
}) {
  const armband =
    player.playerId === captainId ? "C" : player.playerId === viceId ? "V" : null;

  return (
    <tr className="border-t border-[--color-border]">
      <td className="py-2 pr-2 text-xs font-semibold text-[--color-ink-faint]">
        {player.position}
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{player.webName}</span>
          {armband && (
            <span
              title={armband === "C" ? "Captain" : "Vice-captain"}
              className="numeric flex h-4 w-4 items-center justify-center rounded-full bg-[--color-accent] text-[10px] font-bold text-[--color-base]"
            >
              {armband}
            </span>
          )}
          {player.status !== "a" && (
            <span
              title={player.news || "Flagged"}
              className="text-[--color-danger]"
              aria-label="Flagged"
            >
              ⚠
            </span>
          )}
        </div>
        <div className="text-[11px] text-[--color-ink-faint]">
          {player.team} · £{player.cost.toFixed(1)}m
          <BasisNote basis={player.dataBasis} />
        </div>
      </td>
      <td className="numeric py-2 pr-3 text-right font-semibold">
        {player.nextGameweekPoints.toFixed(1)}
      </td>
      <td className="numeric py-2 pr-3 text-right text-[--color-ink-muted]">
        {player.totalExpectedPoints.toFixed(1)}
      </td>
      <td className="numeric hidden py-2 pr-3 text-right text-[--color-ink-muted] sm:table-cell">
        {Math.round(player.expectedMinutes)}′
      </td>
      <td className="hidden py-2 pr-3 sm:table-cell">
        <ConfidenceBadge value={player.confidence} />
      </td>
      <td className="py-2">
        <div className="flex flex-wrap gap-1">
          {player.perFixture.length === 0 ? (
            <span className="text-xs text-[--color-danger]">Blank</span>
          ) : (
            player.perFixture.map((f, i) => (
              <FdrPill
                key={`${f.gameweek}-${f.opponent}-${i}`}
                opponent={f.opponent}
                home={f.isHome}
                fdr={f.difficulty}
              />
            ))
          )}
        </div>
      </td>
    </tr>
  );
}

export function LineupTable({
  startingXI,
  bench,
  gameweek,
  horizon,
  captainId,
  viceId,
}: {
  startingXI: PlayerProjection[];
  bench: PlayerProjection[];
  gameweek: number;
  horizon: number;
  captainId?: number;
  viceId?: number;
}) {
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[38rem] text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-[--color-ink-faint]">
            <th className="pb-2 text-left font-medium">Pos</th>
            <th className="pb-2 text-left font-medium">Player</th>
            <th className="pb-2 text-right font-medium">GW{gameweek}</th>
            <th className="pb-2 text-right font-medium">{horizon}GW</th>
            <th className="hidden pb-2 text-right font-medium sm:table-cell">Mins</th>
            <th className="hidden pb-2 text-left font-medium sm:table-cell">Conf</th>
            <th className="pb-2 text-left font-medium">Fixtures</th>
          </tr>
        </thead>
        <tbody>
          {startingXI.map((p) => (
            <Row key={p.playerId} player={p} captainId={captainId} viceId={viceId} />
          ))}
          <tr className="border-t border-[--color-border]">
            <td
              colSpan={7}
              className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-[--color-ink-faint]"
            >
              Bench — in order
            </td>
          </tr>
          {bench.map((p) => (
            <Row key={p.playerId} player={p} captainId={captainId} viceId={viceId} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
