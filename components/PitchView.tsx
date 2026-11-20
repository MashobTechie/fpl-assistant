import type { PlayerProjection } from "@/lib/projections/engine";
import { kitFor } from "@/lib/fpl/kits";

/**
 * The squad laid out in formation, the way FPL managers already read a team.
 *
 * A table is better for comparing numbers, and the list view still exists for
 * that. But a manager checking "does my defence look right" is reading shape,
 * not rows — the pitch answers that in one glance and the table never does.
 *
 * What this adds over FPL's own pitch is the projection: every shirt carries
 * expected points for the gameweek and the fixture's difficulty colour, so the
 * lineup and the reason for it are in the same picture.
 */

function Shirt({ team, flagged }: { team: string; flagged: boolean }) {
  const kit = kitFor(team);
  return (
    <svg
      viewBox="0 0 40 38"
      className="h-9 w-9 shrink-0 drop-shadow-[0_3px_6px_rgba(0,0,0,0.45)]"
      aria-hidden
    >
      {/* Sleeves, drawn behind the body so the trim reads at small sizes. */}
      <path d="M2 9 L11 3 L11 15 L2 16 Z" fill={kit.accent} />
      <path d="M38 9 L29 3 L29 15 L38 16 Z" fill={kit.accent} />
      <path
        d="M11 3 L16 6 L24 6 L29 3 L29 36 Q20 38 11 36 Z"
        fill={kit.primary}
        stroke="rgba(0,0,0,.25)"
        strokeWidth=".5"
      />
      {/* Collar */}
      <path d="M16 6 L20 10 L24 6 Z" fill={kit.accent} />
      {flagged && <circle cx="33" cy="31" r="5.5" fill="#ff2882" stroke="#16001a" strokeWidth="1.5" />}
      {flagged && (
        <text x="33" y="34" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">
          !
        </text>
      )}
    </svg>
  );
}

/**
 * Transfer editing, when the pitch is being used to try moves.
 *
 * Kept on the pitch rather than in a separate table because that is where a
 * manager already thinks about their team — "who in my defence goes?" is a
 * question about shape, and answering it in a list loses the shape.
 */
export interface PitchEditing {
  /** Players already marked for sale, keyed to their chosen replacement. */
  sold: Map<number, { name: string; team: string; price: number } | null>;
  onSell: (player: PlayerProjection) => void;
  onReplace: (player: PlayerProjection) => void;
  onUndo: (player: PlayerProjection) => void;
}

function PlayerChip({
  player,
  captainId,
  viceId,
  gameweek,
  editing,
}: {
  player: PlayerProjection;
  captainId?: number;
  viceId?: number;
  gameweek: number;
  editing?: PitchEditing;
}) {
  if (editing?.sold.has(player.playerId)) {
    return <SoldSlot player={player} editing={editing} />;
  }
  const armband =
    player.playerId === captainId ? "C" : player.playerId === viceId ? "V" : null;
  const next = player.perFixture.find((f) => f.gameweek === gameweek) ?? player.perFixture[0];
  const fdr = next ? Math.min(5, Math.max(1, next.difficulty)) : 3;

  return (
    <div className="flex w-[4.6rem] flex-col items-center gap-1 sm:w-[5.4rem]">
      <div className="relative">
        <Shirt team={player.team} flagged={player.status !== "a"} />
        {editing && (
          <button
            type="button"
            onClick={() => editing.onSell(player)}
            title={`Sell ${player.webName}`}
            aria-label={`Sell ${player.webName}`}
            className="absolute -right-2 -top-1.5 flex h-[19px] w-[19px] items-center justify-center rounded-full bg-pink text-[11px] font-bold leading-none text-white shadow ring-2 ring-base transition hover:scale-110"
          >
            ×
          </button>
        )}
        {armband && (
          <span
            title={armband === "C" ? "Captain" : "Vice-captain"}
            className={`numeric absolute -left-1.5 -top-1 flex h-[17px] w-[17px] items-center justify-center rounded-full text-[10px] font-bold ${
              armband === "C"
                ? "bg-accent text-base"
                : "bg-base text-accent ring-[1.5px] ring-accent"
            }`}
          >
            {armband}
          </span>
        )}
      </div>

      {/* Name and fixture, stacked like an FPL shirt card. */}
      <div className="w-full overflow-hidden rounded-[5px] bg-base/85 text-center backdrop-blur-sm">
        <div className="truncate px-1 py-[3px] text-[11px] font-semibold leading-tight text-white">
          {player.webName}
        </div>
        <div
          className="numeric px-1 py-[2px] text-[10px] font-bold leading-tight"
          style={{
            background: `var(--color-fdr-${fdr})`,
            color: fdr <= 2 ? "#16001a" : "#fff",
          }}
          title={next ? `${next.opponent} ${next.isHome ? "home" : "away"} — difficulty ${fdr}/5` : "No fixture"}
        >
          {next ? `${next.opponent} (${next.isHome ? "H" : "A"})` : "BLANK"}
        </div>
      </div>

      {/* The projection. This is the part FPL's own pitch cannot show. */}
      <div className="numeric text-[13px] font-bold leading-none text-accent">
        {player.nextGameweekPoints.toFixed(1)}
      </div>
    </div>
  );
}

/**
 * A shirt that has been sold. Before a replacement is picked it is an empty
 * slot asking for one — the position is kept, because a transfer has to be
 * like for like and the slot is the clearest way to say so.
 */
function SoldSlot({
  player,
  editing,
}: {
  player: PlayerProjection;
  editing: PitchEditing;
}) {
  const incoming = editing.sold.get(player.playerId) ?? null;
  return (
    <div className="flex w-[4.6rem] flex-col items-center gap-1 sm:w-[5.4rem]">
      <div className="relative">
        {incoming ? (
          <Shirt team={incoming.team} flagged={false} />
        ) : (
          <button
            type="button"
            onClick={() => editing.onReplace(player)}
            aria-label={`Pick a ${player.position} to replace ${player.webName}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-dashed border-white/70 bg-black/25 text-lg font-bold text-white transition hover:border-accent hover:text-accent"
          >
            +
          </button>
        )}
        <button
          type="button"
          onClick={() => editing.onUndo(player)}
          title={`Keep ${player.webName}`}
          aria-label={`Undo — keep ${player.webName}`}
          className="absolute -right-2 -top-1.5 flex h-[19px] w-[19px] items-center justify-center rounded-full bg-base text-[11px] font-bold leading-none text-ink ring-2 ring-border-bright transition hover:scale-110"
        >
          ↺
        </button>
      </div>

      <button
        type="button"
        onClick={() => editing.onReplace(player)}
        className="w-full overflow-hidden rounded-[5px] bg-base/85 text-center backdrop-blur-sm transition hover:ring-1 hover:ring-accent"
      >
        <div className="truncate px-1 py-[3px] text-[11px] font-semibold leading-tight text-white">
          {incoming ? incoming.name : `Pick ${player.position}`}
        </div>
        <div className="truncate bg-pink/80 px-1 py-[2px] text-[10px] font-semibold leading-tight text-white">
          out: {player.webName}
        </div>
      </button>

      <div className="numeric text-[12px] font-bold leading-none text-cyan">
        {incoming ? `£${incoming.price.toFixed(1)}m` : "—"}
      </div>
    </div>
  );
}

function Row({
  players,
  ...rest
}: {
  players: PlayerProjection[];
  captainId?: number;
  viceId?: number;
  gameweek: number;
  editing?: PitchEditing;
}) {
  if (players.length === 0) return null;
  return (
    <div className="flex justify-center gap-1 sm:gap-3">
      {players.map((p) => (
        <PlayerChip key={p.playerId} player={p} {...rest} />
      ))}
    </div>
  );
}

export function PitchView({
  startingXI,
  bench,
  gameweek,
  formationLabel,
  expectedPoints,
  captainId,
  viceId,
  editing,
}: {
  startingXI: PlayerProjection[];
  bench: PlayerProjection[];
  gameweek: number;
  formationLabel: string;
  expectedPoints: number;
  captainId?: number;
  viceId?: number;
  /** When set, every shirt can be sold and every sold slot replaced. */
  editing?: PitchEditing;
}) {
  const byPosition = (pos: PlayerProjection["position"]) =>
    startingXI.filter((p) => p.position === pos);
  const shared = { captainId, viceId, gameweek, editing };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-panel ring-1 ring-black/40">
        {/* The pitch. Stripes, markings and the vignette are all drawn rather
            than imaged, so the whole thing stays self-contained and scales to
            any width. The turf gradient lives in globals.css as `.turf`. */}
        <div aria-hidden className="turf absolute inset-0" />
        <svg
          aria-hidden
          viewBox="0 0 100 120"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <g fill="none" stroke="rgba(255,255,255,.3)" strokeWidth=".5">
            <rect x="3" y="2" width="94" height="116" />
            {/* Far goal: box, six-yard box, penalty arc. */}
            <path d="M30 2 H70 V16 H30 Z" />
            <path d="M41 2 H59 V7 H41 Z" />
            <path d="M39 16 A 13 9 0 0 0 61 16" />
            {/* Halfway line and centre circle. */}
            <circle cx="50" cy="60" r="12" />
            <path d="M3 60 H97" />
            {/* Near goal, mirrored. */}
            <path d="M30 118 H70 V104 H30 Z" />
            <path d="M41 118 H59 V113 H41 Z" />
            <path d="M39 104 A 13 9 0 0 1 61 104" />
            {/* Corner arcs. */}
            <path d="M3 6 A 4 3 0 0 0 7 2" />
            <path d="M97 6 A 4 3 0 0 1 93 2" />
            <path d="M3 114 A 4 3 0 0 1 7 118" />
            <path d="M97 114 A 4 3 0 0 0 93 118" />
          </g>
          <g fill="rgba(255,255,255,.3)">
            <ellipse cx="50" cy="60" rx="0.7" ry="0.5" />
            <ellipse cx="50" cy="11" rx="0.7" ry="0.5" />
            <ellipse cx="50" cy="109" rx="0.7" ry="0.5" />
          </g>
        </svg>
        {/* A vignette, which is what stops a flat green rectangle from reading
            as a bad gradient. */}
        <div
          aria-hidden
          className="absolute inset-0 shadow-[inset_0_0_6rem_rgba(0,0,0,0.45)]"
        />

        <div className="relative flex flex-col justify-between gap-4 px-1.5 py-5 sm:px-3 sm:py-6">
          <Row players={byPosition("GKP")} {...shared} />
          <Row players={byPosition("DEF")} {...shared} />
          <Row players={byPosition("MID")} {...shared} />
          <Row players={byPosition("FWD")} {...shared} />
        </div>

        <div className="glass relative flex items-center justify-between gap-3 border-t border-black/30 px-3.5 py-2.5">
          <span className="eyebrow text-[10px] text-ink-muted">{formationLabel}</span>
          <span className="display text-sm text-accent">
            {expectedPoints.toFixed(1)} xPts
          </span>
        </div>
      </div>

      <div className="rounded-panel border border-border bg-surface-2 px-2 py-3">
        <p className="eyebrow mb-2.5 px-1 text-[10px] text-cyan">
          Bench — in order
        </p>
        <div className="flex justify-center gap-1 sm:gap-3">
          {bench.map((p, i) => (
            <div key={p.playerId} className="flex flex-col items-center gap-1.5">
              <PlayerChip player={p} {...shared} />
              {/* The order was implicit in the left-to-right arrangement, which
                  is exactly the thing a manager gets wrong. A keeper is not in
                  that queue at all — he only ever replaces the other keeper. */}
              <span className="eyebrow rounded bg-base px-1.5 py-1 text-[9px] text-ink-faint">
                {p.position === "GKP"
                  ? "GK"
                  : `${bench.slice(0, i).filter((b) => b.position !== "GKP").length + 1}${
                      ["st", "nd", "rd"][
                        bench.slice(0, i).filter((b) => b.position !== "GKP").length
                      ] ?? "th"
                    }`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
