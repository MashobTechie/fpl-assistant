"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { PlayerProjection } from "@/lib/projections/engine";
import type { TransferChip } from "@/lib/squad/draft";
import {
  MAX_PER_CLUB,
  type PlayerListItem,
  type PlayersResponse,
  type ProjectionsResponse,
} from "@/lib/types";
import { PitchView, type PitchEditing } from "./PitchView";
import { Button } from "./ui";

/** Only what a chosen replacement needs to be shown and priced. */
export type Incoming = Pick<PlayerListItem, "id" | "name" | "team" | "cost">;

/**
 * Try transfers on your real squad before making them in FPL.
 *
 * Two questions, answered in two places on purpose. As you click, the panel
 * gives an instant estimate — money left, hits, club limits — from the selling
 * prices it was sent, so an obviously impossible move shows up before you ask.
 * The button then asks the server, which applies the same rules FPL does and is
 * the only authority: an estimate that disagrees with the real app is worse
 * than no estimate at all.
 */
export function TransferSandbox({
  projections,
  checking,
  error,
  onCheck,
  onClose,
  initialMoves,
  initialTransfers,
  initialChip,
}: {
  projections: ProjectionsResponse;
  /** Moves to start from — the draft being edited, when there is one. */
  initialMoves?: Map<number, Incoming>;
  /**
   * Moves to start from, by id — a planned transfer the manager asked to try.
   * Resolved against the player list once it loads, because a plan carries
   * names and ids but not the price and club a draft has to be checked on.
   */
  initialTransfers?: { out: number; in: number }[];
  /** The chip to start on — the draft being edited, when there is one. */
  initialChip?: TransferChip | null;
  checking: boolean;
  error: string | null;
  onCheck: (
    transfers: { out: number; in: number }[],
    chip: TransferChip | null,
  ) => void;
  onClose: () => void;
}) {
  const [players, setPlayers] = useState<PlayerListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Sold player id → chosen replacement, or null while the slot is still empty.
  const [moves, setMoves] = useState<Map<number, Incoming | null>>(
    () => new Map(initialMoves ?? []),
  );
  const [picking, setPicking] = useState<PlayerProjection | null>(null);
  // A chip is the manager's to declare, not ours to infer: FPL grants a second
  // set in the back half of the season and its public history does not say
  // which half a played chip came from, so it cannot be read off reliably.
  const [chip, setChip] = useState<TransferChip | null>(initialChip ?? null);
  const [query, setQuery] = useState("");

  // Seeded once, at mount: the panel is rendered fresh each time it opens, and
  // re-applying a seed after the manager has edited it would undo their work.
  const seed = useRef(initialTransfers);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/players")
      .then((r) => {
        if (!r.ok) throw new Error(`Player list unavailable (${r.status})`);
        return r.json() as Promise<PlayersResponse>;
      })
      .then((d) => {
        if (cancelled) return;
        setPlayers(d.players);
        const planned = seed.current;
        if (!planned?.length) return;
        const byId = new Map(d.players.map((p) => [p.id, p]));
        setMoves((current) => {
          const next = new Map(current);
          for (const t of planned) {
            const incoming = byId.get(t.in);
            if (incoming) {
              next.set(t.out, {
                id: incoming.id,
                name: incoming.name,
                team: incoming.team,
                cost: incoming.cost,
              });
            }
          }
          return next;
        });
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const { economics, transfers: budget, squad } = projections;
  const ownedIds = useMemo(() => new Set(squad.map((p) => p.playerId)), [squad]);
  const squadById = useMemo(() => new Map(squad.map((p) => [p.playerId, p])), [squad]);

  // ---- The live estimate --------------------------------------------------
  const summary = useMemo(() => {
    let bank = economics.bank;
    const clubs: Record<string, number> = { ...economics.clubCounts };
    let filled = 0;
    for (const [outId, incoming] of moves) {
      const out = squadById.get(outId);
      if (!out) continue;
      bank += economics.sellPrice[outId] ?? out.cost;
      clubs[out.team] = (clubs[out.team] ?? 0) - 1;
      if (incoming) {
        filled++;
        bank -= incoming.cost;
        clubs[incoming.team] = (clubs[incoming.team] ?? 0) + 1;
      }
    }
    const count = moves.size;
    // A Wildcard or Free Hit suspends the limit, so there is no hit to show
    // however many moves are made.
    const hit = chip ? 0 : Math.max(0, count - budget.free) * budget.hitCost;
    const overClub = Object.entries(clubs).filter(([, n]) => n > MAX_PER_CLUB);
    return {
      bank: Math.round(bank * 10) / 10,
      count,
      filled,
      hit,
      overClub,
      clubs,
    };
  }, [moves, economics, budget, squadById, chip]);

  const problems: string[] = [];
  if (summary.filled < summary.count) {
    const open = summary.count - summary.filled;
    problems.push(`Pick ${open === 1 ? "a replacement" : `${open} replacements`} for the sold ${open === 1 ? "player" : "players"}.`);
  }
  if (summary.filled === summary.count && summary.bank < -0.001) {
    problems.push(`£${Math.abs(summary.bank).toFixed(1)}m short — sell someone dearer or buy someone cheaper.`);
  }
  for (const [club, n] of summary.overClub) {
    problems.push(`${n} players from ${club} — the limit is ${MAX_PER_CLUB}.`);
  }

  const ready = summary.count > 0 && problems.length === 0;

  const editing: PitchEditing = {
    sold: new Map(
      [...moves].map(([id, p]) => [id, p ? { name: p.name, team: p.team, price: p.cost } : null]),
    ),
    onSell: (player) => {
      setMoves((m) => new Map(m).set(player.playerId, null));
      setPicking(player);
      setQuery("");
    },
    onReplace: (player) => {
      setPicking(player);
      setQuery("");
    },
    onUndo: (player) => {
      setMoves((m) => {
        const next = new Map(m);
        next.delete(player.playerId);
        return next;
      });
      if (picking?.playerId === player.playerId) setPicking(null);
    },
  };

  // ---- The picker ---------------------------------------------------------
  const alreadyBought = new Set(
    [...moves.values()].filter((p): p is Incoming => p !== null).map((p) => p.id),
  );

  const options = useMemo(() => {
    if (!players || !picking) return [];
    const q = query.trim().toLowerCase();
    return players
      .filter((p) => p.position === picking.position)
      // Buying back a player you just sold is an undo, and has its own button.
      .filter((p) => !ownedIds.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .slice(0, 50);
  }, [players, picking, query, ownedIds]);

  /** What the bank would read if this player filled the open slot. */
  function bankIfPicked(p: PlayerListItem): number {
    const current = picking ? moves.get(picking.playerId) : null;
    return summary.bank + (current?.cost ?? 0) - p.cost;
  }

  function clubFullFor(p: PlayerListItem): boolean {
    const current = picking ? moves.get(picking.playerId) : null;
    const held = (summary.clubs[p.team] ?? 0) - (current?.team === p.team ? 1 : 0);
    return held >= MAX_PER_CLUB;
  }

  function choose(p: PlayerListItem) {
    if (!picking) return;
    setMoves((m) => new Map(m).set(picking.playerId, p));
    setPicking(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-[--color-ink-muted]">
        Tap <span className="font-bold text-[--color-pink]">×</span> on a shirt to
        sell him, then pick who comes in. Nothing changes in FPL — this only
        checks whether you could make the moves, and whether they are worth it.
      </p>

      <PitchView
        startingXI={projections.optimal.startingXI}
        bench={projections.optimal.bench}
        gameweek={projections.gameweek}
        formationLabel={projections.optimal.formationLabel}
        expectedPoints={projections.optimal.expectedPoints}
        editing={editing}
      />

      {picking && (
        <div className="rounded-xl border border-[--color-border-bright] bg-[--color-surface-2] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm">
              Replacing <span className="font-semibold">{picking.webName}</span>
              <span className="ml-1.5 text-[--color-ink-faint]">
                · sells for £{(economics.sellPrice[picking.playerId] ?? picking.cost).toFixed(1)}m
              </span>
            </p>
            <button
              type="button"
              onClick={() => setPicking(null)}
              className="text-xs text-[--color-ink-muted] hover:text-[--color-ink]"
            >
              Close
            </button>
          </div>

          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${picking.position} by name or club…`}
            className="mb-2 w-full rounded-lg border border-[--color-border] bg-[--color-base] px-3 py-2 text-sm outline-none focus:border-[--color-cyan]"
          />

          {loadError && <p className="text-sm text-[--color-pink]">{loadError}</p>}
          {!players && !loadError && (
            <p className="text-sm text-[--color-ink-muted]">Loading players…</p>
          )}

          <ul className="max-h-72 divide-y divide-[--color-border] overflow-y-auto rounded-lg border border-[--color-border]">
            {options.map((p) => {
              const left = bankIfPicked(p);
              const cantAfford = left < -0.001;
              const clubFull = clubFullFor(p);
              const taken = alreadyBought.has(p.id);
              const blocked = cantAfford || clubFull || taken;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => choose(p)}
                    title={
                      taken
                        ? "Already bought in this draft"
                        : clubFull
                          ? `You would have ${MAX_PER_CLUB + 1} from ${p.team}`
                          : cantAfford
                            ? `£${Math.abs(left).toFixed(1)}m short`
                            : undefined
                    }
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-[--color-surface-3] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {p.name}
                        {p.status !== "a" && (
                          <span className="ml-1 text-[--color-pink]" title={p.risks[0]}>
                            ⚠
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-[--color-ink-faint]">
                        {p.team} · {p.minutes}′ ·{" "}
                        {cantAfford ? (
                          <span className="text-[--color-pink]">£{Math.abs(left).toFixed(1)}m short</span>
                        ) : clubFull ? (
                          <span className="text-[--color-pink]">club full</span>
                        ) : (
                          <>£{left.toFixed(1)}m left</>
                        )}
                      </span>
                    </span>
                    <span className="numeric w-14 text-right text-[--color-ink-muted]">
                      £{p.cost.toFixed(1)}m
                    </span>
                    <span
                      className="numeric w-12 text-right font-semibold text-[--color-accent]"
                      title={`Expected points over the next ${projections.horizon} gameweeks`}
                    >
                      {p.horizon.toFixed(1)}
                    </span>
                  </button>
                </li>
              );
            })}
            {players && options.length === 0 && (
              <li className="px-3 py-4 text-sm text-[--color-ink-muted]">
                No {picking.position} matches “{query}”.
              </li>
            )}
          </ul>
          <p className="mt-2 text-[11px] text-[--color-ink-faint]">
            Right-hand number: expected points over the next {projections.horizon} gameweeks.
          </p>
        </div>
      )}

      <ChipChoice chip={chip} onChange={setChip} chips={projections.chips} />

      {/* The running total. Estimates only — the check below is the authority. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tally label="Transfers" value={String(summary.count)} />
        <Tally
          label="Free"
          value={chip ? "∞" : String(budget.free)}
          sub={chip ? "chip week" : budget.inferred ? "from your history" : undefined}
        />
        <Tally
          label="Hit"
          value={summary.hit ? `−${summary.hit}` : "0"}
          tone={summary.hit ? "bad" : "default"}
        />
        <Tally
          label="Bank after"
          value={`£${summary.bank.toFixed(1)}m`}
          tone={summary.bank < -0.001 ? "bad" : "default"}
        />
      </div>

      {problems.length > 0 && summary.count > 0 && (
        <ul className="flex flex-col gap-1.5">
          {problems.map((p) => (
            <li key={p} className="text-sm text-[--color-pink]">
              {p}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-[--color-pink]/40 bg-[--color-pink]/10 px-3.5 py-2.5 text-sm text-[--color-pink]"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!ready || checking}
          onClick={() =>
            onCheck(
              [...moves].map(([out, incoming]) => ({ out, in: incoming!.id })),
              chip,
            )
          }
        >
          {checking ? "Checking…" : "Check it & analyse"}
        </Button>
        {summary.count > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setMoves(new Map());
              setChip(null);
            }}
            disabled={checking}
          >
            Reset
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} disabled={checking}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Declaring a chip alongside the moves.
 *
 * Both chips here suspend the transfer limit, which is the whole reason this
 * belongs in the sandbox: without it, a ten-move wildcard draft is costed at
 * -36 and reads as a disaster. A Free Hit also expires after one gameweek, so
 * it is only ever judged on this week's figure — stated here, because a chip
 * spent on a two-point gain is the expensive mistake this screen exists to
 * prevent.
 */
function ChipChoice({
  chip,
  onChange,
  chips,
}: {
  chip: TransferChip | null;
  onChange: (c: TransferChip | null) => void;
  chips: ProjectionsResponse["chips"];
}) {
  const options: { id: TransferChip; label: string; note: string }[] = [
    {
      id: "wildcard",
      label: "Wildcard",
      note: "Unlimited free transfers, and you keep the squad.",
    },
    {
      id: "freehit",
      label: "Free Hit",
      note: "Unlimited free transfers for this gameweek only — the squad reverts after it.",
    },
  ];
  const spent = (id: TransferChip) =>
    chips.find((c) => c.chip === id)?.available === false;

  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-base] p-3">
      <div className="eyebrow mb-2 text-[9px] text-[--color-ink-faint]">
        Playing a chip?
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            chip === null
              ? "border-[--color-cyan] text-[--color-cyan]"
              : "border-[--color-border] text-[--color-ink-muted] hover:text-[--color-ink]"
          }`}
        >
          No chip
        </button>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(chip === o.id ? null : o.id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              chip === o.id
                ? "border-[--color-accent] text-[--color-accent]"
                : "border-[--color-border] text-[--color-ink-muted] hover:text-[--color-ink]"
            }`}
          >
            {o.label}
            {spent(o.id) && (
              <span className="ml-1 text-[--color-ink-faint]">· used</span>
            )}
          </button>
        ))}
      </div>
      {chip && (
        <p className="mt-2 text-[11px] leading-relaxed text-[--color-ink-faint]">
          {options.find((o) => o.id === chip)!.note}
          {spent(chip) &&
            " Your history already shows one played this season — fine if that was your first-half chip."}
        </p>
      )}
    </div>
  );
}

function Tally({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "bad";
}) {
  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-base] px-3 py-2">
      <div className="eyebrow text-[9px] text-[--color-ink-faint]">{label}</div>
      <div
        className={`numeric mt-1 text-lg font-bold leading-none ${
          tone === "bad" ? "text-[--color-pink]" : "text-[--color-ink]"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[10px] text-[--color-ink-faint]">{sub}</div>}
    </div>
  );
}
