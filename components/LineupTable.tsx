import type { PlayerProjection } from "@/lib/projections/engine";
import { ConfidenceBadge, FdrPill } from "./ui";

function BasisNote({ basis }: { basis: PlayerProjection["dataBasis"] }) {
  if (basis === "current_season") return null;
  const text =
    basis === "price_prior"
      ? "no PL history"
      : basis === "blended"
        ? "mostly last season"
        : "last season's numbers";
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
    <tr className="border-t border-[--color-border] transition hover:bg-[--color-surface-2]/60">
      <td className="py-2.5 pr-2 text-xs font-semibold text-[--color-ink-faint]">
        {player.position}
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{player.webName}</span>
          {armband && (
            <span
              title={armband === "C" ? "Captain" : "Vice-captain"}
              className={`numeric flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                armband === "C"
                  ? "bg-[--color-accent] text-[--color-base]"
                  : "text-[--color-accent] ring-[1.5px] ring-inset ring-[--color-accent]"
              }`}
            >
              {armband}
            </span>
          )}
          {player.status !== "a" && (
            <span
              title={player.news || "Flagged"}
              className="text-[--color-pink]"
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
      <td className="numeric py-2.5 pr-3 text-right text-base font-bold text-[--color-accent]">
        {player.nextGameweekPoints.toFixed(1)}
      </td>
      <td className="numeric py-2.5 pr-3 text-right font-semibold text-[--color-ink-muted]">
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
            <span className="eyebrow rounded bg-[--color-pink]/15 px-2 py-1 text-[10px] text-[--color-pink]">Blank</span>
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
          <tr className="eyebrow text-[10px] text-[--color-ink-faint]">
            <th className="pb-3 text-left">Pos</th>
            <th className="pb-3 text-left">Player</th>
            <th className="pb-3 text-right">GW{gameweek}</th>
            <th className="pb-3 text-right">{horizon}GW</th>
            <th className="hidden pb-3 text-right sm:table-cell">Mins</th>
            <th className="hidden pb-3 text-left sm:table-cell">Conf</th>
            <th className="pb-3 text-left">Fixtures</th>
          </tr>
        </thead>
        <tbody>
          {startingXI.map((p) => (
            <Row key={p.playerId} player={p} captainId={captainId} viceId={viceId} />
          ))}
          <tr className="border-t border-[--color-border]">
            <td
              colSpan={7}
              className="eyebrow pt-5 pb-2 text-[10px] text-[--color-cyan]"
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
